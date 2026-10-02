import crypto from 'node:crypto';
import { all, get, insert, run, tx } from '../db.js';
import { canManageProject, decryptSecret, encryptSecret } from '../auth.js';
import { HttpError, badRequest, created, forbidden, idParam, logActivity, notFound, oneOf, text } from '../util.js';

/*
 * Git integration for GitHub, GitLab and Bitbucket.
 *
 * A repository is connected to a project. Branches, commits and pull/merge requests reach
 * the app three ways: webhooks (real time), "Sync" (pulls recent history over the provider's
 * REST API) and links pasted into a task by hand. Anything whose branch name, commit message
 * or PR title mentions TASK-123 (also task-123, task_123, task#123) is linked to that task
 * automatically, if the task is in the repository's project.
 */

export const PROVIDERS = ['github', 'gitlab', 'bitbucket'];
const KIND_LABEL = { branch: 'branch', commit: 'commit', pull_request: 'pull request' };
const TASK_REF = /(?:^|[^a-z0-9])task[-_#]?(\d+)(?![0-9])/gi;

const stamp = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};
const firstLine = (s) => String(s || '').split('\n')[0].trim().slice(0, 300);

export function findTaskRefs(...texts) {
  const ids = new Set();
  for (const t of texts) for (const m of String(t || '').matchAll(TASK_REF)) ids.add(Number(m[1]));
  return [...ids];
}

// ---- Repository URLs -----------------------------------------------------

/** Accepts https://host/owner/repo(.git) or git@host:owner/repo.git. */
export function parseRepoUrl(raw, providerHint) {
  let value = String(raw || '').trim();
  const ssh = /^git@([^:]+):(.+)$/.exec(value);
  if (ssh) value = `https://${ssh[1]}/${ssh[2]}`;
  let u;
  try {
    u = new URL(value);
  } catch {
    throw badRequest('Enter the repository URL, for example https://github.com/acme/web-app');
  }
  if (!/^https?:$/.test(u.protocol)) throw badRequest('Repository URL must start with https://');
  const host = u.hostname.toLowerCase();
  const provider = host === 'github.com' ? 'github' : host === 'gitlab.com' ? 'gitlab' : host === 'bitbucket.org' ? 'bitbucket' : providerHint;
  if (!PROVIDERS.includes(provider)) throw badRequest('Choose whether this is a GitHub, GitLab or Bitbucket repository');
  const name = u.pathname.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '').split('/-/')[0];
  const parts = name.split('/').filter(Boolean);
  if (parts.length < 2 || (provider !== 'gitlab' && parts.length !== 2)) throw badRequest('The URL should point at a repository, like https://host/owner/repo');
  const origin = `${u.protocol}//${u.host}`;
  const apiBase = provider === 'github'
    ? (host === 'github.com' ? 'https://api.github.com' : `${origin}/api/v3`)
    : provider === 'gitlab' ? `${origin}/api/v4` : 'https://api.bitbucket.org/2.0';
  return { provider, name: parts.join('/'), url: `${origin}/${parts.join('/')}`, apiBase };
}

/** Works out the provider, repository and item from a commit / PR / branch URL. */
function parseItemUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw badRequest('Paste the full URL of a branch, commit or pull request');
  }
  const p = decodeURIComponent(u.pathname.replace(/\/+$/, ''));
  const origin = `${u.protocol}//${u.host}`;
  let m;
  if ((m = /^\/(.+?)\/-\/(commit|merge_requests|tree)\/(.+)$/.exec(p))) {
    const kind = { commit: 'commit', merge_requests: 'pull_request', tree: 'branch' }[m[2]];
    return { provider: 'gitlab', name: m[1], kind, ref: kind === 'branch' ? m[3] : m[3].split('/')[0], origin };
  }
  if (u.hostname.includes('bitbucket') && (m = /^\/([^/]+\/[^/]+)\/(commits|pull-requests|branch|src)\/(.+)$/.exec(p))) {
    const kind = { commits: 'commit', 'pull-requests': 'pull_request', branch: 'branch', src: 'branch' }[m[2]];
    return { provider: 'bitbucket', name: m[1], kind, ref: kind === 'branch' ? m[3] : m[3].split('/')[0], origin };
  }
  if ((m = /^\/([^/]+\/[^/]+)\/(commit|pull|tree)\/(.+)$/.exec(p))) {
    const kind = { commit: 'commit', pull: 'pull_request', tree: 'branch' }[m[2]];
    return { provider: 'github', name: m[1], kind, ref: kind === 'branch' ? m[3] : m[3].split('/')[0], origin };
  }
  throw badRequest('That does not look like a branch, commit or pull request URL from GitHub, GitLab or Bitbucket');
}

const itemUrl = (repo, kind, ref) => {
  const enc = encodeURIComponent;
  if (repo.provider === 'gitlab') return `${repo.url}/-/${{ commit: 'commit', pull_request: 'merge_requests', branch: 'tree' }[kind]}/${kind === 'branch' ? ref : enc(ref)}`;
  if (repo.provider === 'bitbucket') return `${repo.url}/${{ commit: 'commits', pull_request: 'pull-requests', branch: 'branch' }[kind]}/${kind === 'branch' ? ref : enc(ref)}`;
  return `${repo.url}/${{ commit: 'commit', pull_request: 'pull', branch: 'tree' }[kind]}/${kind === 'branch' ? ref : enc(ref)}`;
};

// ---- Provider REST APIs ----------------------------------------------------

async function apiGet(repo, path) {
  const token = decryptSecret(repo.token_enc);
  const headers = { Accept: 'application/json', 'User-Agent': 'Instacall-PM' };
  if (repo.provider === 'github') headers.Accept = 'application/vnd.github+json';
  if (token) {
    if (repo.provider === 'gitlab') headers['PRIVATE-TOKEN'] = token;
    else if (repo.provider === 'bitbucket' && token.includes(':')) headers.Authorization = `Basic ${Buffer.from(token).toString('base64')}`;
    else headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${repo.api_base}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(`${repo.provider} refused the request (${res.status}). Check the access token and its permissions.`);
    if (res.status === 404) throw new Error(`Repository not found (404). If it is private, add an access token.`);
    throw new Error(`${repo.provider} API error ${res.status}`);
  }
  return res.json();
}

const prState = (s, merged) => {
  const v = String(s || '').toLowerCase();
  if (merged || v === 'merged' || v === 'fulfilled') return 'merged';
  if (['closed', 'declined', 'superseded', 'rejected'].includes(v)) return 'closed';
  return 'open';
};

/** Provider-specific paths and field mapping into one shape. */
const API = {
  github: {
    repo: (r) => `/repos/${r.name}`,
    commits: (r) => `/repos/${r.name}/commits?per_page=50`,
    pulls: (r) => `/repos/${r.name}/pulls?state=all&sort=updated&direction=desc&per_page=50`,
    branches: (r) => `/repos/${r.name}/branches?per_page=100`,
    commit: (c) => ({ kind: 'commit', ref: c.sha, title: firstLine(c.commit?.message), message: c.commit?.message, url: c.html_url, author: c.commit?.author?.name || c.author?.login, occurred_at: stamp(c.commit?.author?.date) }),
    pull: (p) => ({ kind: 'pull_request', ref: String(p.number), title: p.title, message: p.body, url: p.html_url, author: p.user?.login, state: prState(p.state, p.merged_at), branch: p.head?.ref, target_branch: p.base?.ref, occurred_at: stamp(p.created_at) }),
    branch: (b, r) => ({ kind: 'branch', ref: b.name, title: b.name, url: itemUrl(r, 'branch', b.name) }),
    list: (data) => data,
  },
  gitlab: {
    repo: (r) => `/projects/${encodeURIComponent(r.name)}`,
    commits: (r) => `/projects/${encodeURIComponent(r.name)}/repository/commits?per_page=50`,
    pulls: (r) => `/projects/${encodeURIComponent(r.name)}/merge_requests?state=all&order_by=updated_at&per_page=50`,
    branches: (r) => `/projects/${encodeURIComponent(r.name)}/repository/branches?per_page=100`,
    commit: (c) => ({ kind: 'commit', ref: c.id, title: firstLine(c.title || c.message), message: c.message, url: c.web_url, author: c.author_name, occurred_at: stamp(c.committed_date || c.created_at) }),
    pull: (p) => ({ kind: 'pull_request', ref: String(p.iid), title: p.title, message: p.description, url: p.web_url, author: p.author?.name, state: prState(p.state), branch: p.source_branch, target_branch: p.target_branch, occurred_at: stamp(p.created_at) }),
    branch: (b, r) => ({ kind: 'branch', ref: b.name, title: b.name, url: b.web_url || itemUrl(r, 'branch', b.name), occurred_at: stamp(b.commit?.committed_date) }),
    list: (data) => data,
  },
  bitbucket: {
    repo: (r) => `/repositories/${r.name}`,
    commits: (r) => `/repositories/${r.name}/commits?pagelen=50`,
    pulls: (r) => `/repositories/${r.name}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&pagelen=50`,
    branches: (r) => `/repositories/${r.name}/refs/branches?pagelen=100`,
    commit: (c) => ({ kind: 'commit', ref: c.hash, title: firstLine(c.message), message: c.message, url: c.links?.html?.href, author: c.author?.user?.display_name || c.author?.raw, occurred_at: stamp(c.date) }),
    pull: (p) => ({ kind: 'pull_request', ref: String(p.id), title: p.title, message: p.description, url: p.links?.html?.href, author: p.author?.display_name, state: prState(p.state), branch: p.source?.branch?.name, target_branch: p.destination?.branch?.name, occurred_at: stamp(p.created_on) }),
    branch: (b, r) => ({ kind: 'branch', ref: b.name, title: b.name, url: b.links?.html?.href || itemUrl(r, 'branch', b.name), occurred_at: stamp(b.target?.date) }),
    list: (data) => data.values || [],
  },
};

// ---- Storing items and linking them to tasks -------------------------------

async function upsertItem(repo, item) {
  const before = await get(
    'SELECT * FROM git_items WHERE repository_id IS NOT DISTINCT FROM ? AND kind = ? AND ref = ? FOR UPDATE',
    repo?.id ?? null, item.kind, item.ref,
  );
  if (before) {
    await run(
      `UPDATE git_items SET title = COALESCE(NULLIF(?, ''), title), url = COALESCE(?, url), author = COALESCE(?, author), state = COALESCE(?, state),
         branch = COALESCE(?, branch), target_branch = COALESCE(?, target_branch), occurred_at = COALESCE(occurred_at, ?), updated_at = now()
       WHERE id = ?`,
      item.title || '', item.url, item.author, item.state, item.branch, item.target_branch, item.occurred_at, before.id,
    );
    return { id: before.id, previousState: before.state };
  }
  const id = await insert(
    `INSERT INTO git_items (repository_id, provider, kind, ref, title, url, author, state, branch, target_branch, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    repo?.id ?? null, item.provider || repo.provider, item.kind, item.ref, item.title || '', item.url || (repo ? itemUrl(repo, item.kind, item.ref) : null),
    item.author, item.state, item.branch, item.target_branch, item.occurred_at || stamp(new Date()),
  );
  return { id, previousState: null };
}

function describe(item, verb) {
  if (item.kind === 'commit') return `${verb === 'linked' ? 'linked commit' : 'pushed commit'} ${item.ref.slice(0, 7)} "${firstLine(item.title)}"${item.branch ? ` to ${item.branch}` : ''}`;
  if (item.kind === 'branch') return `${verb === 'linked' ? 'linked branch' : 'created branch'} ${item.ref}`;
  const n = `${item.provider === 'gitlab' ? 'merge request !' : 'pull request #'}${item.ref}`;
  if (verb === 'linked') return `linked ${n} "${item.title}"`;
  return `${{ open: 'opened', merged: 'merged', closed: 'closed' }[item.state] || 'updated'} ${n} "${item.title}"`;
}

/**
 * Store an item and link it to every task it references. Activity is written for new
 * links, and for pull requests whose state changed (e.g. merged).
 */
async function ingest(repo, item, { texts = [], live = false } = {}) {
  const { id, previousState } = await upsertItem(repo, item);
  const ids = findTaskRefs(item.title, item.message, item.branch, item.kind === 'branch' ? item.ref : '', ...texts);
  if (!ids.length) return;
  const tasks = await all('SELECT id, project_id FROM tasks WHERE project_id = ? AND id = ANY(?::int[])', repo.project_id, ids);
  for (const t of tasks) {
    const { changes } = await run("INSERT INTO task_git_links (task_id, git_item_id, source) VALUES (?, ?, 'auto') ON CONFLICT DO NOTHING", t.id, id);
    const stateChanged = item.kind === 'pull_request' && previousState && item.state && previousState !== item.state;
    if (changes || stateChanged) {
      const action = changes && !live ? describe({ ...item, provider: repo.provider }, 'linked') : describe({ ...item, provider: repo.provider }, 'event');
      await logActivity({ taskId: t.id, projectId: t.project_id, actorName: item.author || repo.name, action });
    }
  }
}

export function gitLinksFor(taskId) {
  return all(
    `SELECT g.*, l.source, r.name AS repository_name, r.provider AS repository_provider
     FROM task_git_links l JOIN git_items g ON g.id = l.git_item_id LEFT JOIN repositories r ON r.id = g.repository_id
     WHERE l.task_id = ? ORDER BY COALESCE(g.occurred_at, g.updated_at) DESC`,
    taskId,
  );
}

async function syncRepository(repo) {
  const api = API[repo.provider];
  const [commits, pulls, branches] = await Promise.all([
    apiGet(repo, api.commits(repo)), apiGet(repo, api.pulls(repo)), apiGet(repo, api.branches(repo)),
  ]);
  const counts = { commits: 0, pull_requests: 0, branches: 0 };
  await tx(async () => {
    for (const b of api.list(branches)) { await ingest(repo, api.branch(b, repo)); counts.branches += 1; }
    for (const c of api.list(commits)) { await ingest(repo, api.commit(c)); counts.commits += 1; }
    for (const p of api.list(pulls)) { await ingest(repo, api.pull(p)); counts.pull_requests += 1; }
    await run('UPDATE repositories SET last_synced_at = now(), last_error = NULL WHERE id = ?', repo.id);
  });
  return counts;
}

// ---- Webhooks (public; verified with the repository's secret) ---------------

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hmac = (secret, body) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

function verifyWebhook(repo, headers, raw) {
  if (repo.provider === 'gitlab') return safeEqual(headers.get('x-gitlab-token'), repo.webhook_secret);
  const header = repo.provider === 'github' ? headers.get('x-hub-signature-256') : headers.get('x-hub-signature');
  return Boolean(raw) && safeEqual(header, hmac(repo.webhook_secret, raw));
}

/** Turn a provider's webhook payload into the items it describes. */
function webhookItems(repo, headers, b) {
  const items = [];
  const branchItem = (branch, author) => ({ kind: 'branch', ref: branch, title: branch, url: itemUrl(repo, 'branch', branch), author });
  if (repo.provider === 'github') {
    const event = headers.get('x-github-event');
    if (event === 'push' && !b.deleted) {
      const branch = String(b.ref || '').replace('refs/heads/', '');
      if (b.created && String(b.ref).startsWith('refs/heads/')) items.push(branchItem(branch, b.pusher?.name));
      for (const c of b.commits || []) {
        items.push({ kind: 'commit', ref: c.id, title: firstLine(c.message), message: c.message, url: c.url, author: c.author?.name || c.author?.username, branch, occurred_at: stamp(c.timestamp) });
      }
    } else if (event === 'create' && b.ref_type === 'branch') {
      items.push(branchItem(b.ref, b.sender?.login));
    } else if (event === 'pull_request' && b.pull_request) {
      items.push(API.github.pull(b.pull_request));
    }
  } else if (repo.provider === 'gitlab') {
    const event = headers.get('x-gitlab-event');
    if (event === 'Push Hook') {
      const branch = String(b.ref || '').replace('refs/heads/', '');
      if (/^0+$/.test(b.before || '')) items.push(branchItem(branch, b.user_name));
      for (const c of b.commits || []) {
        items.push({ kind: 'commit', ref: c.id, title: firstLine(c.title || c.message), message: c.message, url: c.url, author: c.author?.name, branch, occurred_at: stamp(c.timestamp) });
      }
    } else if (event === 'Merge Request Hook' && b.object_attributes) {
      const mr = b.object_attributes;
      items.push({
        kind: 'pull_request', ref: String(mr.iid), title: mr.title, message: mr.description, url: mr.url, author: b.user?.name,
        state: prState(mr.state), branch: mr.source_branch, target_branch: mr.target_branch, occurred_at: stamp(mr.created_at),
      });
    }
  } else {
    const event = headers.get('x-event-key') || '';
    if (event === 'repo:push') {
      for (const change of b.push?.changes || []) {
        if (change.new?.type !== 'branch') continue;
        const branch = change.new.name;
        if (!change.old) items.push(branchItem(branch, b.actor?.display_name));
        for (const c of change.commits || []) items.push({ ...API.bitbucket.commit(c), branch });
      }
    } else if (event.startsWith('pullrequest:') && b.pullrequest) {
      items.push(API.bitbucket.pull(b.pullrequest));
    }
  }
  return items;
}

/** Public webhook endpoint. The signature is checked against the exact request bytes. */
export async function webhook({ params, request }) {
  const repo = await get('SELECT * FROM repositories WHERE id = ?', idParam(params.id));
  if (!repo) throw notFound('Repository');
  const raw = await request.text();
  if (raw.length > 5 * 1024 * 1024) throw new HttpError(413, 'Payload too large');
  if (!verifyWebhook(repo, request.headers, raw)) throw new HttpError(401, 'Invalid webhook signature');
  if (request.headers.get('x-github-event') === 'ping') return { ok: true };
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw badRequest('Webhooks must be sent as JSON (choose the content type application/json)');
  }
  await tx(async () => {
    for (const item of webhookItems(repo, request.headers, payload || {})) await ingest(repo, item, { live: true });
    await run('UPDATE repositories SET last_event_at = now() WHERE id = ?', repo.id);
  });
  return Response.json({ ok: true }, { status: 202 });
}

// ---- Authenticated API -------------------------------------------------------

async function publicRepo(repo, user, project) {
  const { token_enc, webhook_secret, ...rest } = repo;
  const counts = await get(
    `SELECT COUNT(*) FILTER (WHERE kind = 'commit') AS commits, COUNT(*) FILTER (WHERE kind = 'pull_request') AS pull_requests,
       COUNT(*) FILTER (WHERE kind = 'branch') AS branches FROM git_items WHERE repository_id = ?`,
    repo.id,
  );
  const manage = canManageProject(user, project);
  return { ...rest, ...counts, has_token: Boolean(token_enc), webhook_path: `/api/webhooks/${repo.id}`, webhook_secret: manage ? webhook_secret : undefined };
}

async function projectOf(id) {
  const project = await get('SELECT * FROM projects WHERE id = ?', id);
  if (!project) throw notFound('Project');
  return project;
}

async function requireRepo(id, user) {
  const repo = await get('SELECT * FROM repositories WHERE id = ?', id);
  if (!repo) throw notFound('Repository');
  const project = await projectOf(repo.project_id);
  if (!canManageProject(user, project)) throw forbidden();
  return { repo, project };
}

const repoById = (id) => get('SELECT * FROM repositories WHERE id = ?', id);

export async function listRepositories({ user, params }) {
  const project = await projectOf(idParam(params.id));
  const repos = await all('SELECT * FROM repositories WHERE project_id = ? ORDER BY id', project.id);
  return Promise.all(repos.map((r) => publicRepo(r, user, project)));
}

export async function connectRepository({ user, params, body: b }) {
  const project = await projectOf(idParam(params.id));
  if (!canManageProject(user, project)) throw forbidden();
  const parsed = parseRepoUrl(b.url, oneOf(b.provider || undefined, PROVIDERS, 'Provider'));
  // Self-hosted GitLab / GitHub Enterprise can override the API address.
  let apiBase = parsed.apiBase;
  if (b.api_base) {
    const custom = text(b.api_base, 'API URL', { max: 300 }).replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+/i.test(custom)) throw badRequest('API URL must start with https://');
    apiBase = custom;
  }
  if (await get('SELECT id FROM repositories WHERE project_id = ? AND provider = ? AND lower(name) = lower(?)', project.id, parsed.provider, parsed.name)) {
    throw badRequest('That repository is already connected to this project');
  }
  const token = text(b.token, 'Access token', { max: 500 });
  const id = await tx(async () => {
    const repoId = await insert(
      'INSERT INTO repositories (project_id, provider, name, url, api_base, token_enc, webhook_secret, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      project.id, parsed.provider, parsed.name, parsed.url, apiBase, token ? encryptSecret(token) : null, crypto.randomBytes(20).toString('hex'), user.id,
    );
    await logActivity({ projectId: project.id, userId: user.id, action: `connected repository ${parsed.name}` });
    return repoId;
  });
  return created(await publicRepo(await repoById(id), user, project));
}

export async function updateRepository({ user, params, body: b }) {
  const { repo, project } = await requireRepo(idParam(params.id), user);
  if (b.token !== undefined) {
    const token = text(b.token, 'Access token', { max: 500 });
    await run('UPDATE repositories SET token_enc = ? WHERE id = ?', token ? encryptSecret(token) : null, repo.id);
  }
  if (b.regenerate_secret) await run('UPDATE repositories SET webhook_secret = ? WHERE id = ?', crypto.randomBytes(20).toString('hex'), repo.id);
  return publicRepo(await repoById(repo.id), user, project);
}

export async function disconnectRepository({ user, params }) {
  const { repo } = await requireRepo(idParam(params.id), user);
  await tx(async () => {
    await run('DELETE FROM repositories WHERE id = ?', repo.id);
    await logActivity({ projectId: repo.project_id, userId: user.id, action: `disconnected repository ${repo.name}` });
  });
}

export async function syncNow({ user, params }) {
  const { repo, project } = await requireRepo(idParam(params.id), user);
  try {
    const counts = await syncRepository(repo);
    return { ...counts, repository: await publicRepo(await repoById(repo.id), user, project) };
  } catch (err) {
    await run('UPDATE repositories SET last_error = ? WHERE id = ?', String(err.message).slice(0, 500), repo.id);
    throw badRequest(`Sync failed: ${err.message}`);
  }
}

/** Branches, commits or pull requests across a project's repositories, with linked tasks. */
export async function projectItems({ params, query }) {
  const project = await projectOf(idParam(params.id));
  const kind = oneOf(query.kind || 'commit', ['commit', 'pull_request', 'branch'], 'kind');
  const values = [project.id, project.id, kind];
  let repoFilter = '';
  if (query.repository_id) { repoFilter = ' AND g.repository_id = ?'; values.push(idParam(query.repository_id, 'repository_id')); }
  const items = await all(
    `SELECT g.*, r.name AS repository_name FROM git_items g LEFT JOIN repositories r ON r.id = g.repository_id
     WHERE (r.project_id = ? OR (g.repository_id IS NULL AND EXISTS (
       SELECT 1 FROM task_git_links l JOIN tasks t ON t.id = l.task_id WHERE l.git_item_id = g.id AND t.project_id = ?)))
       AND g.kind = ?${repoFilter}
     ORDER BY COALESCE(g.occurred_at, g.updated_at) DESC, g.id DESC LIMIT 200`,
    ...values,
  );
  const links = items.length ? await all(
    `SELECT l.git_item_id, t.id, t.title, t.status FROM task_git_links l JOIN tasks t ON t.id = l.task_id
     WHERE l.git_item_id = ANY(?::int[])`,
    items.map((i) => i.id),
  ) : [];
  return items.map((i) => ({ ...i, tasks: links.filter((l) => l.git_item_id === i.id).map(({ git_item_id, ...t }) => t) }));
}

/** Link a branch / commit / PR to a task by pasting its URL. */
export async function linkToTask({ user, params, body }) {
  const task = await get('SELECT * FROM tasks WHERE id = ?', idParam(params.id));
  if (!task) throw notFound('Task');
  const parsed = parseItemUrl(body.url);
  const repo = (await all('SELECT * FROM repositories WHERE project_id = ?', task.project_id))
    .find((r) => r.provider === parsed.provider && r.name.toLowerCase() === parsed.name.toLowerCase());
  let item = { kind: parsed.kind, ref: parsed.ref, provider: parsed.provider, url: String(body.url).trim() };
  item.title = parsed.kind === 'commit' ? parsed.ref.slice(0, 7) : parsed.kind === 'branch' ? parsed.ref : `#${parsed.ref}`;
  if (repo && parsed.kind !== 'branch') {
    // Best effort: fill in the title, author and state from the provider.
    try {
      const api = API[repo.provider];
      const path = parsed.kind === 'commit'
        ? { github: `/repos/${repo.name}/commits/${parsed.ref}`, gitlab: `/projects/${encodeURIComponent(repo.name)}/repository/commits/${parsed.ref}`, bitbucket: `/repositories/${repo.name}/commit/${parsed.ref}` }[repo.provider]
        : { github: `/repos/${repo.name}/pulls/${parsed.ref}`, gitlab: `/projects/${encodeURIComponent(repo.name)}/merge_requests/${parsed.ref}`, bitbucket: `/repositories/${repo.name}/pullrequests/${parsed.ref}` }[repo.provider];
      const data = await apiGet(repo, path);
      item = { ...item, ...(parsed.kind === 'commit' ? api.commit(data) : api.pull(data)) };
    } catch { /* keep the basic details */ }
  }
  const linked = await tx(async () => {
    const { id } = await upsertItem(repo || null, item);
    const { changes } = await run(
      "INSERT INTO task_git_links (task_id, git_item_id, source, created_by) VALUES (?, ?, 'manual', ?) ON CONFLICT DO NOTHING", task.id, id, user.id,
    );
    if (changes) await logActivity({ taskId: task.id, projectId: task.project_id, userId: user.id, action: describe(item, 'linked') });
    return changes;
  });
  if (!linked) throw badRequest(`That ${KIND_LABEL[parsed.kind]} is already linked to this task`);
  return created(await gitLinksFor(task.id));
}

export async function unlinkFromTask({ user, params }) {
  const task = await get('SELECT * FROM tasks WHERE id = ?', idParam(params.id));
  if (!task) throw notFound('Task');
  const item = await get('SELECT * FROM git_items WHERE id = ?', idParam(params.itemId, 'itemId'));
  if (!item) throw notFound('Link');
  await tx(async () => {
    await run('DELETE FROM task_git_links WHERE task_id = ? AND git_item_id = ?', task.id, item.id);
    await logActivity({ taskId: task.id, projectId: task.project_id, userId: user.id, action: `unlinked ${KIND_LABEL[item.kind]} ${item.kind === 'commit' ? item.ref.slice(0, 7) : item.ref}` });
    // Manually linked items from unconnected repositories have nothing else pointing at them.
    if (!item.repository_id && !await get('SELECT 1 FROM task_git_links WHERE git_item_id = ?', item.id)) await run('DELETE FROM git_items WHERE id = ?', item.id);
  });
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import Icon from '../components/Icon.jsx';
import { ConfirmButton, EmptyState, Field, Modal, Spinner, StatusDot } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { parseStamp, timeAgo } from '../utils.js';

const PROVIDERS = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' };
const KINDS = [
  { key: 'commit', label: 'Commits', icon: 'gitCommit' },
  { key: 'pull_request', label: 'Pull requests', icon: 'gitPull' },
  { key: 'branch', label: 'Branches', icon: 'gitBranch' },
];

export function ProviderMark({ provider }) {
  return <span className={`provider-mark ${provider}`} title={PROVIDERS[provider]}>{PROVIDERS[provider]?.[0] || '?'}</span>;
}

export function PrState({ state, provider }) {
  if (!state) return null;
  const label = { open: 'Open', merged: 'Merged', closed: provider === 'bitbucket' ? 'Declined' : 'Closed' }[state] || state;
  return <span className={`pr-state ${state}`}><Icon name={state === 'merged' ? 'gitMerge' : 'gitPull'} size={11} />{label}</span>;
}

function CopyField({ value, secret }) {
  const { toast } = useData();
  const [shown, setShown] = useState(!secret);
  const copy = () => navigator.clipboard?.writeText(value).then(() => toast('Copied', 'success')).catch(() => {});
  return (
    <span className="copy-field">
      <code>{shown ? value : '•'.repeat(24)}</code>
      {secret && <button type="button" className="link-btn" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>}
      <button type="button" className="icon-btn tiny" onClick={copy} aria-label="Copy"><Icon name="copy" size={13} /></button>
    </span>
  );
}

function WebhookHelp({ repo }) {
  const url = `${window.location.origin}${repo.webhook_path}`;
  const steps = {
    github: ['Repository → Settings → Webhooks → Add webhook', 'Content type: application/json', 'Events: "Pushes", "Pull requests" and "Branch or tag creation"'],
    gitlab: ['Project → Settings → Webhooks → Add new webhook', 'Paste the secret into "Secret token"', 'Triggers: "Push events" and "Merge request events"'],
    bitbucket: ['Repository settings → Webhooks → Add webhook', 'Paste the secret into "Secret"', 'Triggers: "Push" and every "Pull request" event'],
  }[repo.provider];
  return (
    <div className="webhook-help">
      <div className="kv"><span>Payload URL</span><CopyField value={url} /></div>
      {repo.webhook_secret && <div className="kv"><span>Secret</span><CopyField value={repo.webhook_secret} secret /></div>}
      <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="muted small">The app must be reachable from {PROVIDERS[repo.provider]} for webhooks to arrive. Without them, use Sync to pull in recent activity.</p>
    </div>
  );
}

function ConnectModal({ projectId, onClose, onSaved }) {
  const { toast } = useData();
  const [form, setForm] = useState({ url: '', provider: '', token: '', api_base: '' });
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const known = /github\.com|gitlab\.com|bitbucket\.org/i.test(form.url);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { url: form.url, token: form.token || undefined, provider: form.provider || undefined, api_base: form.api_base || undefined };
      const repo = await api(`/projects/${projectId}/repositories`, { method: 'POST', body });
      toast(`Connected ${repo.name}`, 'success');
      onSaved(repo);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Connect a repository" onClose={onClose} width={560}
      footer={<><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="repo-form" className="btn primary" disabled={saving || !form.url}>{saving ? 'Connecting…' : 'Connect'}</button></>}>
      <form id="repo-form" className="form" onSubmit={submit}>
        <Field label="Repository URL" hint="GitHub, GitLab or Bitbucket — for example https://github.com/acme/web-app">
          <input autoFocus required value={form.url} onChange={set('url')} placeholder="https://github.com/owner/repository" />
        </Field>
        {(!known && form.url) || advanced ? (
          <Field label="Provider" hint="Needed for self-hosted GitLab or GitHub Enterprise.">
            <select value={form.provider} onChange={set('provider')}>
              <option value="">Detect from URL</option>
              {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Access token (optional)" hint="Needed for private repositories and for Sync. Read-only access is enough. For Bitbucket app passwords use username:app_password. Tokens are stored encrypted.">
          <input type="password" autoComplete="off" value={form.token} onChange={set('token')} placeholder="ghp_… / glpat-… / repository access token" />
        </Field>
        {advanced ? (
          <Field label="API URL" hint="Leave empty to use the default for the provider.">
            <input value={form.api_base} onChange={set('api_base')} placeholder="https://git.example.com/api/v4" />
          </Field>
        ) : <button type="button" className="link-btn" onClick={() => setAdvanced(true)}>Self-hosted server settings</button>}
      </form>
    </Modal>
  );
}

function RepoCard({ repo, canManage, onChange, onRemove }) {
  const { toast } = useData();
  const [syncing, setSyncing] = useState(false);
  const [showHook, setShowHook] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api(`/repositories/${repo.id}/sync`, { method: 'POST' });
      toast(`Synced ${r.commits} commits, ${r.pull_requests} pull requests and ${r.branches} branches`, 'success');
      onChange(r.repository);
    } catch (e) {
      toast(e.message, 'error');
      onChange({ ...repo, last_error: e.message.replace(/^Sync failed: /, '') });
    } finally {
      setSyncing(false);
    }
  };
  const saveToken = async (e) => {
    e.preventDefault();
    try {
      onChange(await api(`/repositories/${repo.id}`, { method: 'PATCH', body: { token } }));
      setToken('');
      setTokenOpen(false);
      toast(token ? 'Token saved' : 'Token removed', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async () => {
    await api(`/repositories/${repo.id}`, { method: 'DELETE' });
    toast('Repository disconnected', 'success');
    onRemove(repo.id);
  };
  return (
    <div className="repo-card">
      <div className="row-between">
        <span className="row-gap">
          <ProviderMark provider={repo.provider} />
          <a href={repo.url} target="_blank" rel="noreferrer" className="repo-name">{repo.name} <Icon name="external" size={12} /></a>
        </span>
        {canManage && (
          <span className="row-gap">
            <button type="button" className="btn small" onClick={sync} disabled={syncing}><Icon name="refresh" size={13} /> {syncing ? 'Syncing…' : 'Sync'}</button>
            <ConfirmButton className="icon-btn danger-hover" onConfirm={remove} confirmText="Disconnect?"><Icon name="trash" size={14} /></ConfirmButton>
          </span>
        )}
      </div>
      <div className="repo-stats small muted">
        <span><Icon name="gitCommit" size={12} /> {repo.commits} commits</span>
        <span><Icon name="gitPull" size={12} /> {repo.pull_requests} PRs</span>
        <span><Icon name="gitBranch" size={12} /> {repo.branches} branches</span>
        <span>{repo.last_synced_at ? `Synced ${timeAgo(repo.last_synced_at)}` : 'Never synced'}</span>
        <span>{repo.last_event_at ? `Last webhook ${timeAgo(repo.last_event_at)}` : 'No webhook events yet'}</span>
        <span>{repo.has_token ? 'Token saved' : 'No token'}</span>
      </div>
      {repo.last_error && <p className="form-error small">{repo.last_error}</p>}
      {canManage && (
        <div className="row-gap">
          <button type="button" className="link-btn" onClick={() => setShowHook((s) => !s)}>{showHook ? 'Hide webhook setup' : 'Webhook setup'}</button>
          <button type="button" className="link-btn" onClick={() => setTokenOpen((s) => !s)}>{repo.has_token ? 'Change token' : 'Add token'}</button>
        </div>
      )}
      {tokenOpen && (
        <form className="time-form" onSubmit={saveToken}>
          <input className="grow" type="password" autoComplete="off" placeholder={repo.has_token ? 'New token (leave empty to remove)' : 'Access token'} value={token} onChange={(e) => setToken(e.target.value)} />
          <button type="submit" className="btn small primary">Save</button>
        </form>
      )}
      {showHook && <WebhookHelp repo={repo} />}
    </div>
  );
}

function GitItems({ projectId, kind, repoCount }) {
  const { toast, openTask, taskVersion } = useData();
  const [items, setItems] = useState(null);
  useEffect(() => {
    setItems(null);
    api(`/projects/${projectId}/git${qs({ kind })}`).then(setItems).catch((e) => toast(e.message, 'error'));
  }, [projectId, kind, repoCount, taskVersion, toast]);
  if (!items) return <div className="center-pad"><Spinner /></div>;
  if (!items.length) return <p className="muted center-pad">Nothing yet. Connect a repository, then Sync or set up a webhook.</p>;
  return (
    <div className="table-wrap card-panel flush">
      <table className="simple-table git-table">
        <tbody>
          {items.map((g) => (
            <tr key={g.id}>
              <td className="git-main">
                <span className="row-gap">
                  <Icon name={KINDS.find((k) => k.key === g.kind).icon} size={14} className="muted" />
                  <a href={g.url} target="_blank" rel="noreferrer" className="git-title">
                    {g.kind === 'commit' && <code>{g.ref.slice(0, 7)}</code>}
                    {g.kind === 'pull_request' && <span className="muted">{g.provider === 'gitlab' ? '!' : '#'}{g.ref}</span>}
                    {' '}{g.kind === 'branch' ? <code>{g.ref}</code> : g.title}
                  </a>
                  {g.kind === 'pull_request' && <PrState state={g.state} provider={g.provider} />}
                </span>
                <small className="muted block">
                  {g.author || 'Unknown'}
                  {g.repository_name && ` · ${g.repository_name}`}
                  {g.kind === 'pull_request' && g.branch && ` · ${g.branch} → ${g.target_branch || '?'}`}
                  {g.kind === 'commit' && g.branch && ` · ${g.branch}`}
                  {g.occurred_at && <span title={parseStamp(g.occurred_at).toLocaleString()}> · {timeAgo(g.occurred_at)}</span>}
                </small>
              </td>
              <td className="git-tasks">
                {g.tasks.map((t) => (
                  <button type="button" key={t.id} className="git-task" onClick={() => openTask(t.id)} title={t.title}>
                    <StatusDot status={t.status} /><span className="ellipsis">TASK-{t.id} {t.title}</span>
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Development({ project, canManage }) {
  const { toast } = useData();
  const [repos, setRepos] = useState(null);
  const [kind, setKind] = useState('commit');
  const [connecting, setConnecting] = useState(false);
  const load = useCallback(() => api(`/projects/${project.id}/repositories`).then(setRepos).catch((e) => toast(e.message, 'error')), [project.id, toast]);
  useEffect(() => { load(); }, [load]);

  if (!repos) return <div className="center-pad"><Spinner /></div>;
  return (
    <div className="development">
      <div className="section-head">
        <div>
          <h2>Repositories</h2>
          <p className="muted small">
            Mention <code>TASK-123</code> in a branch name, commit message or pull request title to link it to that task automatically.
          </p>
        </div>
        {canManage && <button type="button" className="btn primary small" onClick={() => setConnecting(true)}><Icon name="plus" size={13} /> Connect repository</button>}
      </div>
      {repos.length ? (
        <div className="repo-grid">
          {repos.map((r) => (
            <RepoCard key={r.id} repo={r} canManage={canManage}
              onChange={(next) => setRepos((list) => list.map((x) => (x.id === next.id ? next : x)))}
              onRemove={(id) => setRepos((list) => list.filter((x) => x.id !== id))} />
          ))}
        </div>
      ) : (
        <EmptyState icon="code" title="No repositories connected">
          Connect a GitHub, GitLab or Bitbucket repository to see branches, commits and pull requests here and inside tasks.
          {!canManage && ' Ask a manager or the project owner to connect one.'}
        </EmptyState>
      )}

      <div className="view-tabs underline" style={{ marginTop: 24 }}>
        {KINDS.map((k) => (
          <button type="button" key={k.key} className={kind === k.key ? 'active' : ''} onClick={() => setKind(k.key)}><Icon name={k.icon} size={14} /> {k.label}</button>
        ))}
      </div>
      <GitItems projectId={project.id} kind={kind} repoCount={repos.map((r) => `${r.id}:${r.last_synced_at}`).join()} />
      {connecting && <ConnectModal projectId={project.id} onClose={() => setConnecting(false)} onSaved={(repo) => setRepos((list) => [...list, repo])} />}
    </div>
  );
}

// Resets the database and fills it with realistic demo data.  Usage: npm run seed
// WARNING: this deletes everything in the database DATABASE_URL points at.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { TABLES, insert as insertRow, migrate, pool, run, tx } from './db.js';
import { DEFAULT_SPACES } from './bootstrap.js';
import { addDays, localDate } from './util.js';

const today = localDate();
const day = (offset) => (offset === null || offset === undefined ? null : addDays(today, offset));
const stamp = (offset) => `${addDays(today, offset)} 10:00:00`;

const USERS = [
  ['Admin', 'admin@instacall.local', 'admin', 'Administrator', '#7b68ee'],
  ['Sarah Khan', 'sarah@instacall.local', 'manager', 'Engineering Lead', '#6366f1'],
  ['Omar Farooq', 'omar@instacall.local', 'member', 'Full-stack Developer', '#0ea5e9'],
  ['Lina Chen', 'lina@instacall.local', 'member', 'Frontend Developer', '#ec4899'],
  ['David Miller', 'david@instacall.local', 'member', 'QA Engineer', '#14b8a6'],
  ['Ayesha Rahman', 'ayesha@instacall.local', 'manager', 'SEO Lead', '#10b981'],
  ['Marco Rossi', 'marco@instacall.local', 'member', 'Content Writer', '#84cc16'],
  ['Priya Nair', 'priya@instacall.local', 'manager', 'Digital Marketing Manager', '#f59e0b'],
  ['Jake Wilson', 'jake@instacall.local', 'member', 'PPC & Social Specialist', '#f97316'],
  ['Fatima Ali', 'fatima@instacall.local', 'manager', 'Operations Manager', '#3b82f6'],
];
const U = Object.fromEntries(USERS.map(([name], i) => [name.split(' ')[0].toLowerCase(), i + 1]));

const TEAMS = [
  ['Engineering', 'Developers and QA', '#6366f1', ['sarah', 'omar', 'lina', 'david']],
  ['SEO', 'Search optimisation & content', '#10b981', ['ayesha', 'marco']],
  ['Marketing', 'Paid, social and email', '#f59e0b', ['priya', 'jake', 'marco']],
  ['Operations', 'Admin, finance and people', '#3b82f6', ['fatima', 'admin']],
];

// [spaceIndex, name, color, owner, dueOffset, description]
const PROJECTS = [
  [0, 'Customer Portal v2', '#7b68ee', 'sarah', 30, 'Rebuild of the customer self-service portal with new billing and support flows.'],
  [0, 'Mobile App', '#0ea5e9', 'sarah', 60, 'iOS and Android app for call tracking and notifications.'],
  [0, 'Infrastructure & DevOps', '#64748b', 'omar', null, 'CI/CD, hosting, monitoring and security.'],
  [1, 'Technical SEO Audit', '#10b981', 'ayesha', 14, 'Full crawl, Core Web Vitals and indexation fixes.'],
  [1, 'Content & Blog Strategy', '#22c55e', 'ayesha', 45, 'Keyword-driven editorial calendar for Q4.'],
  [1, 'Link Building', '#059669', 'ayesha', 40, 'Outreach, guest posts and digital PR.'],
  [2, 'Q4 Paid Ads Campaign', '#f59e0b', 'priya', 35, 'Google Ads and Meta campaigns for the Q4 push.'],
  [2, 'Social Media Calendar', '#ec4899', 'jake', null, 'Always-on organic social content.'],
  [2, 'Email Marketing', '#f97316', 'priya', 25, 'Newsletter, nurture sequences and automation.'],
  [3, 'Hiring & Onboarding', '#3b82f6', 'fatima', 30, 'Open roles, interviews and new-joiner onboarding.'],
  [3, 'Finance & Invoicing', '#0284c7', 'fatima', null, 'Monthly invoicing, payroll and vendor payments.'],
  [3, 'Office & IT Admin', '#6366f1', 'fatima', null, 'Equipment, licences and office logistics.'],
];

// [projectIndex, title, status, priority, assignees, dueOffset, tags, estimate, createdOffset, checklist?, subtasks?]
const TASKS = [
  [0, 'Design new billing dashboard', 'review', 'high', ['lina'], 2, ['design', 'frontend'], 16, -20, ['Wireframes', 'Hi-fi mockups', 'Stakeholder sign-off']],
  [0, 'Implement Stripe subscription API', 'in_progress', 'urgent', ['omar'], 1, ['backend', 'payments'], 24, -18, null, ['Webhook handler', 'Proration logic', 'Invoice PDF generation']],
  [0, 'Support ticket submission flow', 'todo', 'normal', ['lina', 'omar'], 9, ['frontend'], 12, -10],
  [0, 'Fix session timeout on Safari', 'blocked', 'high', ['omar'], -2, ['bug'], 4, -8],
  [0, 'Write E2E tests for checkout', 'todo', 'normal', ['david'], 12, ['qa', 'testing'], 10, -6],
  [0, 'Accessibility review (WCAG 2.2)', 'todo', 'low', ['david', 'lina'], 20, ['qa', 'a11y'], 8, -4],
  [0, 'Set up user roles & permissions', 'done', 'high', ['omar'], -5, ['backend'], 14, -25],
  [1, 'Push notification service', 'in_progress', 'high', ['omar'], 6, ['mobile', 'backend'], 20, -12],
  [1, 'Call history screen', 'todo', 'normal', ['lina'], 15, ['mobile', 'frontend'], 12, -9],
  [1, 'App Store listing & screenshots', 'todo', 'low', ['jake', 'lina'], 40, ['release'], 6, -3],
  [1, 'Crash on Android 12 login', 'in_progress', 'urgent', ['omar', 'david'], 0, ['bug', 'mobile'], 6, -2],
  [2, 'Migrate CI to GitHub Actions', 'done', 'normal', ['omar'], -9, ['devops'], 8, -26],
  [2, 'Configure uptime monitoring & alerts', 'review', 'normal', ['sarah'], 3, ['devops'], 4, -7, ['Pingdom checks', 'Slack alert channel', 'On-call rota']],
  [2, 'Quarterly dependency security update', 'todo', 'high', ['omar'], 5, ['security'], 6, -1],
  [3, 'Full site crawl with Screaming Frog', 'done', 'high', ['ayesha'], -6, ['audit'], 4, -15],
  [3, 'Fix 404s and redirect chains', 'in_progress', 'high', ['ayesha', 'omar'], 2, ['technical'], 8, -10, ['Export 404 list', 'Map redirects', 'Deploy .htaccess rules', 'Re-crawl']],
  [3, 'Improve Core Web Vitals (LCP)', 'todo', 'urgent', ['lina', 'ayesha'], 7, ['technical', 'performance'], 12, -9],
  [3, 'Add schema markup to service pages', 'todo', 'normal', ['ayesha'], 10, ['technical'], 5, -5],
  [3, 'Submit updated XML sitemap', 'done', 'normal', ['ayesha'], -3, ['technical'], 1, -12],
  [4, 'Keyword research: call tracking cluster', 'done', 'high', ['ayesha'], -8, ['research'], 6, -20],
  [4, 'Blog: "10 ways to reduce missed calls"', 'review', 'normal', ['marco'], 1, ['content', 'blog'], 5, -8],
  [4, 'Blog: "Call analytics for small business"', 'in_progress', 'normal', ['marco'], 6, ['content', 'blog'], 5, -4],
  [4, 'Refresh top 10 outdated posts', 'todo', 'low', ['marco'], 18, ['content'], 10, -2],
  [5, 'Outreach list: 50 SaaS publications', 'in_progress', 'normal', ['ayesha'], 4, ['outreach'], 6, -7],
  [5, 'Guest post for industry blog', 'todo', 'normal', ['marco'], 14, ['outreach', 'content'], 6, -3],
  [5, 'Disavow toxic backlinks', 'todo', 'low', ['ayesha'], -1, ['technical'], 2, -11],
  [6, 'Q4 budget allocation', 'done', 'high', ['priya'], -10, ['planning'], 3, -21],
  [6, 'Google Ads search campaign build', 'in_progress', 'urgent', ['jake'], 1, ['ppc', 'google-ads'], 10, -9, ['Keyword list', 'Ad copy variants', 'Conversion tracking', 'Negative keywords']],
  [6, 'Meta retargeting creatives', 'review', 'high', ['jake', 'lina'], 3, ['creative', 'meta'], 8, -6],
  [6, 'Landing page A/B test', 'todo', 'normal', ['priya', 'lina'], 11, ['cro'], 6, -4],
  [6, 'Weekly ad performance report', 'todo', 'normal', ['jake'], 0, ['reporting'], 2, -1],
  [7, 'October content calendar', 'done', 'normal', ['jake'], -4, ['social'], 4, -14],
  [7, 'LinkedIn carousel: product features', 'in_progress', 'normal', ['jake', 'marco'], 2, ['social', 'linkedin'], 3, -5],
  [7, 'Customer testimonial video', 'todo', 'high', ['priya'], 16, ['video'], 12, -3],
  [8, 'Welcome nurture sequence (5 emails)', 'in_progress', 'high', ['priya', 'marco'], 5, ['email', 'automation'], 10, -9],
  [8, 'Monthly newsletter - October', 'todo', 'normal', ['marco'], 8, ['email', 'content'], 4, -2],
  [8, 'Clean up inactive subscribers', 'blocked', 'low', ['priya'], -3, ['email'], 2, -12],
  [9, 'Hire senior backend developer', 'in_progress', 'high', ['fatima', 'sarah'], 21, ['hiring'], null, -18, ['Job description', 'Post on LinkedIn', 'Screen candidates', 'Technical interview', 'Offer']],
  [9, 'Onboarding checklist for new hires', 'review', 'normal', ['fatima'], 4, ['process'], 4, -10],
  [9, 'Interview: SEO intern candidates', 'todo', 'normal', ['ayesha', 'fatima'], 3, ['hiring'], 3, -2],
  [10, 'Send September client invoices', 'done', 'urgent', ['fatima'], -5, ['invoicing'], 3, -9],
  [10, 'Process October payroll', 'todo', 'urgent', ['fatima'], 6, ['payroll'], 2, -1],
  [10, 'Review software subscriptions', 'todo', 'low', ['fatima', 'admin'], 13, ['cost'], 2, -3],
  [11, 'Laptop setup for new developer', 'todo', 'normal', ['admin'], 9, ['it'], 2, -2],
  [11, 'Renew Google Workspace licences', 'in_progress', 'high', ['admin'], -1, ['it', 'renewals'], 1, -6],
];

const COMMENTS = [
  [1, 'sarah', 'Let\'s make sure proration works for mid-cycle upgrades before we ship.'],
  [1, 'omar', 'Yes — writing tests for that now. Webhook handler is almost done.'],
  [3, 'omar', 'Blocked on Apple\'s ITP cookie changes. @Sarah can we discuss options tomorrow?'],
  [15, 'ayesha', 'Found 142 broken links, mostly from the old /resources section.'],
  [26, 'priya', 'Budget approved at $12k for the first month. Keep CPA under $45.'],
  [27, 'jake', 'Conversion tracking is live, validating with Tag Assistant.'],
  [37, 'fatima', 'Shortlisted 6 candidates. Technical interviews next week.'],
];

await migrate();
await tx(async () => {
  await run(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

  /** Insert a row given as { column: value } and return its id. */
  const insert = (table, row) => {
    const keys = Object.keys(row);
    return insertRow(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...Object.values(row));
  };

  const hash = bcrypt.hashSync('password123', 10);
  const adminHash = bcrypt.hashSync('admin123', 10);
  for (const [i, [name, email, role, title, color]] of USERS.entries()) {
    await insert('users', { name, email, password_hash: i === 0 ? adminHash : hash, role, title, color, created_at: stamp(-40) });
  }
  for (const [name, description, color, members] of TEAMS) {
    const teamId = await insert('teams', { name, description, color });
    for (const m of members) await run('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)', teamId, U[m]);
  }
  for (const [i, s] of DEFAULT_SPACES.entries()) await insert('spaces', { name: s.name, description: s.description, color: s.color, position: i + 1 });
  for (const [space, name, color, owner, due, description] of PROJECTS) {
    await insert('projects', {
      space_id: space + 1, name, description, color, owner_id: U[owner], start_date: day(-30), due_date: day(due), created_at: stamp(-30),
    });
  }

  let position = 0;
  const insertTask = async ({ project, parent = null, title, status, priority, assignees, due, tags = [], estimate = null, created }) => {
    position += 1;
    const completed = status === 'done' ? stamp(Math.min(due ?? 0, 0)) : null;
    const id = await insert('tasks', {
      project_id: project, parent_id: parent, title, status, priority, start_date: day(created + 1), due_date: day(due),
      estimate_hours: estimate, position, created_by: PROJECTS[project - 1] ? U[PROJECTS[project - 1][3]] : 1,
      created_at: stamp(created), updated_at: stamp(created), completed_at: completed,
    });
    for (const a of assignees) await run('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)', id, U[a]);
    for (const t of tags) await run('INSERT INTO task_tags (task_id, tag) VALUES (?, ?)', id, t);
    await insert('activity', { task_id: id, project_id: project, user_id: U[assignees[0]] || 1, action: parent ? 'created this subtask' : 'created this task', created_at: stamp(created) });
    if (status === 'done') {
      await insert('activity', { task_id: id, project_id: project, user_id: U[assignees[0]] || 1, action: 'changed status from In Progress to Done', created_at: completed });
    }
    return id;
  };

  const taskIds = [];
  for (const [p, title, status, priority, assignees, due, tags, estimate, created, checklist, subtasks] of TASKS) {
    const id = await insertTask({ project: p + 1, title, status, priority, assignees, due, tags, estimate, created });
    taskIds.push(id);
    await run('UPDATE tasks SET description = ? WHERE id = ?', `${title}.\n\nAcceptance criteria and notes go here.`, id);
    for (const [i, item] of (checklist || []).entries()) {
      await insert('checklist_items', { task_id: id, text: item, done: i < checklist.length / 2, position: i });
    }
    for (const [i, st] of (subtasks || []).entries()) {
      await insertTask({ project: p + 1, parent: id, title: st, status: i === 0 ? 'done' : 'todo', priority: 'normal', assignees, due: due + i, created });
    }
    if (estimate && status !== 'todo') {
      await insert('time_entries', {
        task_id: id, user_id: U[assignees[0]], hours: Math.round(estimate * 0.4 * 2) / 2 || 1, note: 'Work session', date: day(Math.max(created + 2, -3)),
      });
    }
  }
  for (const [i, [taskNum, who, body]] of COMMENTS.entries()) {
    await insert('comments', { task_id: taskIds[taskNum], user_id: U[who], body, created_at: `${day(-3)} 1${i}:00:00` });
  }

  // ---- Software development module: phases, milestones, releases, bugs, dependencies, Git ----
  await run("UPDATE projects SET type = 'software', progress_method = 'milestones' WHERE id = 1");
  await run("UPDATE projects SET type = 'software' WHERE id IN (2, 3)");

  const depend = (project, predType, predId, succType, succId, kind = 'FS') => insert('dependencies', {
    project_id: project, pred_type: predType, pred_id: predId, succ_type: succType, succ_id: succId, kind,
  });
  const setTask = (id, fields) => {
    const keys = Object.keys(fields);
    return run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(fields), id);
  };
  const addPhases = async (projectId, rows) => {
    const ids = [];
    for (const [i, [name, color, start, end, status, mode, progress, done]] of rows.entries()) {
      ids.push(await insert('phases', {
        project_id: projectId, name, color, start_date: day(start), end_date: day(end), status, progress_mode: mode, progress,
        completed_date: day(done), position: i + 1,
      }));
    }
    for (let i = 1; i < ids.length; i += 1) await depend(projectId, 'phase', ids[i - 1], 'phase', ids[i]);
    return ids;
  };

  // Customer Portal v2 (project 1)
  const P1 = 1;
  const [, ph1Dev, ph1Test, ph1Deploy] = await addPhases(P1, [
    ['Planning', '#8b5cf6', -30, -22, 'completed', 'manual', 100, -22],
    ['Development', '#3b82f6', -22, 8, 'in_progress', 'auto', 0, null],
    ['Testing', '#f59e0b', 8, 18, 'not_started', 'auto', 0, null],
    ['Deployment', '#10b981', 18, 24, 'not_started', 'manual', 0, null],
    ['Maintenance', '#64748b', 24, 30, 'not_started', 'manual', 0, null],
  ]);

  const msCore = await insert('milestones', {
    project_id: P1, phase_id: ph1Dev, name: 'Core Module Complete', description: 'Auth, roles and account settings are done and reviewed.',
    target_date: day(-6), completed_date: day(-5), owner_id: U.sarah, status: 'completed', progress_mode: 'manual', progress: 100, weight: 1,
  });
  const msBeta = await insert('milestones', {
    project_id: P1, phase_id: ph1Dev, name: 'Beta Feature Complete', description: 'Billing and support flows ready for the beta group.',
    target_date: day(8), owner_id: U.sarah, weight: 2,
  });
  const msQa = await insert('milestones', {
    project_id: P1, phase_id: ph1Test, name: 'QA Sign-off', description: 'E2E and accessibility checks passed.', target_date: day(18), owner_id: U.david, weight: 1,
  });
  const msProd = await insert('milestones', {
    project_id: P1, phase_id: ph1Deploy, name: 'Production Release', description: 'v2.0.0 live for all customers.',
    target_date: day(24), owner_id: U.sarah, progress_mode: 'manual', weight: 2,
  });
  await depend(P1, 'phase', ph1Dev, 'milestone', msCore, 'SS');
  await depend(P1, 'milestone', msCore, 'milestone', msBeta);
  await depend(P1, 'phase', ph1Test, 'milestone', msQa, 'SS');
  await depend(P1, 'phase', ph1Test, 'milestone', msProd);

  const relHotfix = await insert('releases', {
    project_id: P1, name: 'v1.9.4', description: 'Hotfix for password reset emails.', status: 'released',
    start_date: day(-16), release_date: day(-13), released_date: day(-12),
  });
  const relBeta = await insert('releases', {
    project_id: P1, name: 'v2.0.0-beta', description: 'Beta for the early-access group.', status: 'in_progress', start_date: day(-20), release_date: day(8),
  });
  const relGa = await insert('releases', {
    project_id: P1, name: 'v2.0.0', description: 'General availability of the new portal.', status: 'planned', start_date: day(8), release_date: day(24),
  });

  await setTask(taskIds[0], { type: 'feature', phase_id: ph1Dev, milestone_id: msBeta, release_id: relBeta, is_key: true });
  await setTask(taskIds[1], { type: 'feature', phase_id: ph1Dev, milestone_id: msBeta, release_id: relBeta, is_key: true });
  await setTask(taskIds[2], {
    type: 'story', phase_id: ph1Dev, milestone_id: msBeta, release_id: relGa,
    description: 'As a customer, I want to submit a support ticket from the portal so that I do not have to email support.\n\nAcceptance criteria:\n- Form validates required fields\n- Ticket appears in the support inbox',
  });
  await setTask(taskIds[3], {
    type: 'bug', severity: 'major', environment: 'Production · Safari 17 / macOS 14', affected_version: 'v1.9.3', release_id: relBeta, phase_id: ph1Dev,
    steps_to_reproduce: '1. Sign in with Safari 17\n2. Leave the tab idle for 10 minutes\n3. Click any link in the portal',
    expected_result: 'The session stays active for 60 minutes.', actual_result: 'User is signed out after ~10 minutes and loses unsaved form data.',
  });
  await setTask(taskIds[4], { phase_id: ph1Test, milestone_id: msQa, release_id: relGa, is_key: true, start_date: day(8), due_date: day(14) });
  await setTask(taskIds[5], { phase_id: ph1Test, milestone_id: msQa, release_id: relGa, start_date: day(14), due_date: day(17) });
  await setTask(taskIds[6], { type: 'feature', phase_id: ph1Dev, milestone_id: msCore, release_id: relBeta, start_date: day(-22), due_date: day(-6) });
  await depend(P1, 'task', taskIds[1], 'task', taskIds[4]);
  await depend(P1, 'task', taskIds[0], 'task', taskIds[5]);

  const BUGS = [
    ['Duplicate charge when "Pay now" is double-clicked', 'in_progress', 'urgent', 'critical', 'Production', 'v1.9.3', relBeta, 2, -4,
      '1. Open an unpaid invoice\n2. Double-click "Pay now" quickly', 'One payment is taken.', 'Two identical charges are created in Stripe.'],
    ['Invoice PDF shows the wrong currency symbol', 'todo', 'high', 'major', 'Production', 'v1.9.3', relBeta, 6, -3,
      '1. Set account currency to EUR\n2. Download any invoice PDF', 'Amounts show €.', 'Amounts show $.'],
    ['Low contrast on billing page in dark mode', 'todo', 'low', 'minor', 'Staging', 'v2.0.0-beta', relGa, 15, -2,
      '1. Turn on dark mode\n2. Open Billing', 'Text meets WCAG AA contrast.', 'Secondary text is barely readable.'],
    ['Password reset email not sent', 'done', 'urgent', 'critical', 'Production', 'v1.9.3', relHotfix, -13, -16,
      '1. Click "Forgot password"\n2. Enter a registered email', 'Reset email arrives within a minute.', 'No email is sent.'],
  ];
  for (const [title, status, priority, severity, environment, version, release, due, created, steps, expected, actual] of BUGS) {
    const id = await insertTask({ project: P1, title, status, priority, assignees: status === 'todo' ? ['omar'] : ['omar', 'david'], due, created, tags: ['bug'] });
    await setTask(id, {
      type: 'bug', severity, environment, affected_version: version, release_id: release, phase_id: ph1Dev,
      steps_to_reproduce: steps, expected_result: expected, actual_result: actual,
    });
  }

  // Mobile App (project 2)
  const P2 = 2;
  const phases2 = await addPhases(P2, [
    ['Planning', '#8b5cf6', -30, -20, 'completed', 'manual', 100, -20],
    ['Development', '#3b82f6', -20, 35, 'in_progress', 'auto', 0, null],
    ['Testing', '#f59e0b', 35, 50, 'not_started', 'auto', 0, null],
    ['Deployment', '#10b981', 50, 55, 'not_started', 'manual', 0, null],
    ['Maintenance', '#64748b', 55, 60, 'not_started', 'manual', 0, null],
  ]);
  const msStore = await insert('milestones', { project_id: P2, phase_id: phases2[3], name: 'App Store submission', target_date: day(50), owner_id: U.sarah, weight: 1 });
  await depend(P2, 'phase', phases2[2], 'milestone', msStore);
  const relMobile = await insert('releases', { project_id: P2, name: 'v1.0.0', status: 'planned', start_date: day(-20), release_date: day(55) });
  await setTask(taskIds[7], { type: 'feature', phase_id: phases2[1], release_id: relMobile, is_key: true });
  await setTask(taskIds[8], { type: 'story', phase_id: phases2[1], release_id: relMobile });
  await setTask(taskIds[9], { phase_id: phases2[3], milestone_id: msStore, release_id: relMobile });
  await setTask(taskIds[10], {
    type: 'bug', severity: 'critical', environment: 'Android 12 · Pixel 6', affected_version: 'v0.9.0-rc1', phase_id: phases2[1], release_id: relMobile,
    steps_to_reproduce: '1. Install the RC build on Android 12\n2. Sign in with email and password', expected_result: 'User lands on the call history screen.',
    actual_result: 'App crashes with a NullPointerException in AuthActivity.',
  });

  // Example GitHub activity on Customer Portal v2. The repository is a placeholder, so its
  // links and Sync won't work; connect a real repository to see live data.
  const repo = await insert('repositories', {
    project_id: P1, provider: 'github', name: 'instacall/customer-portal', url: 'https://github.com/instacall/customer-portal',
    api_base: 'https://api.github.com', webhook_secret: crypto.randomBytes(20).toString('hex'), created_by: U.sarah,
  });
  const gh = 'https://github.com/instacall/customer-portal';
  const gitItem = async (taskId, offset, action, item) => {
    const id = await insert('git_items', { repository_id: repo, provider: 'github', occurred_at: stamp(offset), ...item });
    await run("INSERT INTO task_git_links (task_id, git_item_id, source) VALUES (?, ?, 'auto')", taskId, id);
    await insert('activity', { task_id: taskId, project_id: P1, actor_name: item.author, action, created_at: stamp(offset) });
  };
  const stripe = taskIds[1];
  const roles = taskIds[6];
  const branch = `feature/task-${stripe}-stripe-subscriptions`;
  await gitItem(stripe, -10, `created branch ${branch}`, { kind: 'branch', ref: branch, title: branch, url: `${gh}/tree/${branch}`, author: 'omar-farooq' });
  await gitItem(stripe, -6, `pushed commit 9f2c4e1 "TASK-${stripe}: add subscription webhook handler" to ${branch}`, {
    kind: 'commit', ref: '9f2c4e1a7b3d5f60e8a1c2b3d4e5f6a7b8c9d0e1', title: `TASK-${stripe}: add subscription webhook handler`,
    url: `${gh}/commit/9f2c4e1a7b3d5f60e8a1c2b3d4e5f6a7b8c9d0e1`, author: 'Omar Farooq', branch,
  });
  await gitItem(stripe, -2, `pushed commit 3a7d9c2 "TASK-${stripe}: proration for mid-cycle upgrades" to ${branch}`, {
    kind: 'commit', ref: '3a7d9c2b1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b', title: `TASK-${stripe}: proration for mid-cycle upgrades`,
    url: `${gh}/commit/3a7d9c2b1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b`, author: 'Omar Farooq', branch,
  });
  await gitItem(stripe, -1, `opened pull request #42 "TASK-${stripe} Stripe subscription API"`, {
    kind: 'pull_request', ref: '42', title: `TASK-${stripe} Stripe subscription API`, url: `${gh}/pull/42`, author: 'omar-farooq',
    state: 'open', branch, target_branch: 'main',
  });
  await gitItem(roles, -5, `merged pull request #38 "TASK-${roles} Role-based permissions"`, {
    kind: 'pull_request', ref: '38', title: `TASK-${roles} Role-based permissions`, url: `${gh}/pull/38`, author: 'omar-farooq',
    state: 'merged', branch: `feature/task-${roles}-roles`, target_branch: 'main',
  });

  await insert('notifications', { user_id: 1, actor_id: U.fatima, task_id: taskIds[42], message: 'Fatima Ali assigned you to "Review software subscriptions"', event: 'assigned' });
  await insert('notifications', { user_id: 1, actor_id: U.fatima, task_id: taskIds[44], message: 'Fatima Ali commented on "Renew Google Workspace licences"', event: 'commented' });
});
await pool.end();

console.log(`Seeded ${USERS.length} users, ${PROJECTS.length} projects and ${TASKS.length} tasks.`);
console.log('Sign in as admin@instacall.local / admin123 (other demo users use password123).');

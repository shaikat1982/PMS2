'use client';

import { useEffect, useState } from 'react';
import { Link } from '../router.js';
import { api, qs } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Avatar, AvatarStack, EmptyState, PriorityFlag, ProgressBar, Spinner, StateBadge, StatusDot } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { PRIORITIES, STATUSES, fmtDate, parseDate, pct, stateOf, timeAgo } from '../utils.js';

function Kpi({ label, value, icon, tone, sub }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-icon"><Icon name={icon} size={18} /></div>
      <div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Card({ title, action, children, className = '' }) {
  return (
    <section className={`card-panel ${className}`}>
      <header><h3>{title}</h3>{action}</header>
      <div className="card-panel-body">{children}</div>
    </section>
  );
}

function StatusBreakdown({ byStatus, total }) {
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s.count]));
  return (
    <div>
      <div className="stacked-bar">
        {STATUSES.map((s) => counts[s.key] ? (
          <div key={s.key} style={{ flex: counts[s.key], background: s.color }} title={`${s.label}: ${counts[s.key]}`} />
        ) : null)}
      </div>
      <div className="legend">
        {STATUSES.map((s) => (
          <div key={s.key} className="legend-item">
            <span className="dot" style={{ background: s.color }} />
            <span className="grow">{s.label}</span>
            <b>{counts[s.key] || 0}</b>
            <span className="muted small legend-pct">{pct(counts[s.key] || 0, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriorityBars({ byPriority }) {
  const counts = Object.fromEntries(byPriority.map((p) => [p.priority, p.count]));
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="hbars">
      {PRIORITIES.map((p) => (
        <div key={p.key} className="hbar-row">
          <span className="hbar-label"><PriorityFlag priority={p.key} showLabel /></span>
          <div className="hbar-track"><div style={{ width: `${((counts[p.key] || 0) / max) * 100}%`, background: p.color }} /></div>
          <b className="hbar-value">{counts[p.key] || 0}</b>
        </div>
      ))}
    </div>
  );
}

function Trend({ trend }) {
  const max = Math.max(1, ...trend.flatMap((d) => [d.created, d.completed]));
  return (
    <div>
      <div className="trend">
        {trend.map((d) => (
          <div key={d.date} className="trend-col" title={`${fmtDate(d.date, { relative: false })}: ${d.created} created, ${d.completed} completed`}>
            <div className="trend-bars">
              <div className="bar created" style={{ height: `${(d.created / max) * 100}%` }} />
              <div className="bar completed" style={{ height: `${(d.completed / max) * 100}%` }} />
            </div>
            <span className="trend-label">{parseDate(d.date).getDate()}</span>
          </div>
        ))}
      </div>
      <div className="legend inline">
        <span className="legend-item"><span className="dot" style={{ background: 'var(--accent-soft-strong)' }} />Created</span>
        <span className="legend-item"><span className="dot" style={{ background: 'var(--green)' }} />Completed</span>
      </div>
    </div>
  );
}

function TaskRows({ tasks, empty }) {
  const { openTask } = useData();
  if (!tasks.length) return <p className="muted small pad">{empty}</p>;
  return (
    <div className="mini-tasks">
      {tasks.map((t) => (
        <button type="button" key={t.id} className="mini-task" onClick={() => openTask(t.id)}>
          <StatusDot status={t.status} />
          <span className="grow ellipsis">
            {t.title}
            <small className="muted block ellipsis"><span className="dot" style={{ background: t.project_color }} /> {t.project_name}</small>
          </span>
          <AvatarStack users={t.assignees} size={20} max={2} />
          <span className={`date-cell ${t.due_date && t.due_date < new Date().toISOString().slice(0, 10) ? 'overdue' : ''}`}>{fmtDate(t.due_date)}</span>
          <PriorityFlag priority={t.priority} />
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { me, spaces, taskVersion, toast } = useData();
  const [spaceId, setSpaceId] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/dashboard${qs({ space_id: spaceId })}`).then(setData).catch((e) => toast(e.message, 'error'));
  }, [spaceId, taskVersion, toast]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greeting}, {me.name.split(' ')[0]}</h1>
          <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · Here is how work is tracking.</p>
        </div>
        <select className="filter-select" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          <option value="">All spaces</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {!data ? <div className="center-pad"><Spinner /></div> : (
        <>
          <div className="kpis">
            <Kpi label="Open tasks" value={data.totals.total - data.totals.done} icon="layers" sub={`${data.totals.total} total`} />
            <Kpi label="In progress" value={data.totals.in_progress} icon="play" tone="blue" sub={`${data.totals.blocked} blocked`} />
            <Kpi label="Overdue" value={data.totals.overdue} icon="alert" tone={data.totals.overdue ? 'red' : ''} />
            <Kpi label="Due in 7 days" value={data.totals.due_this_week} icon="calendar" tone="amber" />
            <Kpi label="Completed (7 days)" value={data.totals.completed_this_week} icon="circleCheck" tone="green" sub={`${pct(data.totals.done, data.totals.total)}% of all tasks done`} />
          </div>

          <div className="dash-grid">
            <Card title="My open tasks" action={<Link to="/my-tasks" className="link-btn">View all</Link>} className="span-2">
              <TaskRows tasks={data.mine} empty="Nothing assigned to you. Nice!" />
            </Card>
            <Card title="Tasks by status"><StatusBreakdown byStatus={data.byStatus} total={data.totals.total} /></Card>

            <Card title="Overdue" className={data.overdue.length ? 'danger-edge' : ''}>
              <TaskRows tasks={data.overdue} empty="No overdue tasks." />
            </Card>
            <Card title="Upcoming deadlines"><TaskRows tasks={data.upcoming} empty="No upcoming deadlines." /></Card>
            <Card title="Open tasks by priority"><PriorityBars byPriority={data.byPriority} /></Card>

            <Card title="Created vs completed (14 days)" className="span-2"><Trend trend={data.trend} /></Card>
            <Card title="Spaces">
              <div className="space-progress">
                {data.bySpace.map((s) => (
                  <Link key={s.id} to={`/spaces/${s.id}`} className="space-progress-row">
                    <span className="space-icon" style={{ background: s.color }}>{s.name[0]}</span>
                    <span className="grow">
                      <span className="row-between"><b>{s.name}</b><span className="muted small">{s.done}/{s.total}</span></span>
                      <ProgressBar value={pct(s.done, s.total)} color={s.color} />
                      {s.overdue > 0 && <small className="text-red">{s.overdue} overdue</small>}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="Team workload" action={<Link to="/team?tab=workload" className="link-btn">Details</Link>} className="span-2">
              <div className="workload">
                {data.workload.map((u) => {
                  const max = Math.max(1, ...data.workload.map((w) => w.open));
                  return (
                    <Link key={u.id} to={`/tasks?assignee=${u.id}`} className="workload-row">
                      <Avatar user={u} size={28} />
                      <span className="workload-name"><b>{u.name}</b><small className="muted block">{u.title}</small></span>
                      <div className="hbar-track">
                        <div style={{ width: `${((u.open - u.overdue) / max) * 100}%`, background: 'var(--accent)' }} />
                        <div style={{ width: `${(u.overdue / max) * 100}%`, background: 'var(--red)' }} />
                      </div>
                      <span className="workload-stats">
                        <b>{u.open}</b> open
                        {u.overdue > 0 && <span className="text-red"> · {u.overdue} late</span>}
                        {u.estimate_hours > 0 && <span className="muted"> · {Math.round(u.estimate_hours)}h</span>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Card>
            <Card title="Recent activity">
              <div className="activity-feed">
                {data.activity.map((a) => (
                  <div key={a.id} className="activity-item">
                    <Avatar user={{ name: a.user_name || '?', color: a.user_color }} size={22} />
                    <span className="grow">
                      <b>{a.user_name || 'Someone'}</b> {a.action}
                      {a.task_title && <> on <ActivityTask id={a.task_id} title={a.task_title} /></>}
                      <small className="muted block">{a.project_name} · {timeAgo(a.created_at)}</small>
                    </span>
                  </div>
                ))}
                {!data.activity.length && <p className="muted small">No activity yet.</p>}
              </div>
            </Card>

            <Card title="Active projects" className="span-3">
              {data.projects.length ? (
                <div className="table-wrap">
                  <table className="simple-table">
                    <thead><tr><th>Project</th><th>Space</th><th>Progress</th><th>Tasks</th><th>Overdue</th><th>Due</th></tr></thead>
                    <tbody>
                      {data.projects.map((p) => (
                        <tr key={p.id}>
                          <td><Link to={`/projects/${p.id}`} className="project-chip"><span className="dot" style={{ background: p.color }} />{p.name}</Link></td>
                          <td className="muted">{p.space_name}</td>
                          <td style={{ minWidth: 140 }}><div className="row-gap"><ProgressBar value={pct(p.done, p.total)} color={p.color} /><span className="small">{pct(p.done, p.total)}%</span></div></td>
                          <td>{p.done}/{p.total}</td>
                          <td className={p.overdue ? 'text-red' : 'muted'}>{p.overdue}</td>
                          <td className="muted">{p.due_date ? fmtDate(p.due_date) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon="folder" title="No active projects" />}
            </Card>

            {data.milestones.length > 0 && (
              <Card title="Milestones" className="span-3">
                <div className="table-wrap">
                  <table className="simple-table">
                    <thead><tr><th>Milestone</th><th>Project</th><th>Target</th><th>Owner</th><th>Progress</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.milestones.map((m) => (
                        <tr key={m.id}>
                          <td><Link to={`/projects/${m.project_id}?tab=planning&item=${m.ref}`} className="row-gap"><span className="ms-diamond" style={{ '--c': stateOf(m.state).color }} />{m.name}</Link></td>
                          <td><Link to={`/projects/${m.project_id}?tab=overview`} className="project-chip"><span className="dot" style={{ background: m.project_color }} />{m.project_name}</Link></td>
                          <td className={m.state === 'delayed' ? 'text-red' : 'muted'}>{fmtDate(m.target_date)}</td>
                          <td>{m.owner_name ? <span className="row-gap"><Avatar user={{ name: m.owner_name, color: m.owner_color }} size={20} />{m.owner_name}</span> : <span className="muted">—</span>}</td>
                          <td style={{ minWidth: 140 }}><div className="row-gap"><ProgressBar value={m.progress} color={stateOf(m.state).color} /><span className="small">{m.progress}%</span></div></td>
                          <td><StateBadge state={m.state} small /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ActivityTask({ id, title }) {
  const { openTask } = useData();
  return <button type="button" className="inline-link" onClick={() => openTask(id)}>{title}</button>;
}

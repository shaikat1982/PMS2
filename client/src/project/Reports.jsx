import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Avatar, EmptyState, ProgressBar, RefChip, Spinner, StateBadge, StatusDot, TypeIcon } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { PRIORITIES, SEVERITIES, STATUSES, fmtDate, fmtHours, fmtVariance, parseDate, pct, priorityOf, stateOf } from '../utils.js';
import { DateSpan, KindIcon } from './common.jsx';

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Card({ title, children, className = '', action }) {
  return (
    <section className={`card-panel ${className}`}>
      <header><h3>{title}</h3>{action}</header>
      <div className="card-panel-body">{children}</div>
    </section>
  );
}

const Variance = ({ days }) => (days === null || days === undefined
  ? <span className="muted">—</span>
  : <span className={days > 0 ? 'text-red' : 'text-green'}>{fmtVariance(days)}</span>);

/** Horizontal bars, one per category; labels and values are always printed beside the bar. */
function Bars({ rows, colorOf, labelOf }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="muted small">No data.</p>;
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.key} className="hbar-row" title={`${labelOf(r.key)}: ${r.count}`}>
          <span className="hbar-label wide ellipsis">{labelOf(r.key)}</span>
          <div className="hbar-track"><div style={{ width: `${(r.count / max) * 100}%`, background: colorOf(r.key) }} /></div>
          <b className="hbar-value">{r.count}</b>
        </div>
      ))}
    </div>
  );
}

function ProgressReport({ data, openItem }) {
  const p = data.progress;
  const msDone = p.milestones.filter((m) => m.state === 'completed').length;
  const relDone = p.releases.filter((r) => r.state === 'completed').length;
  return (
    <>
      <div className="kpis">
        <Kpi label="Overall completion" value={`${p.overall}%`} sub={p.method === 'milestones' ? 'Weighted by milestones' : 'Share of tasks done'} />
        <Kpi label="Tasks done" value={`${p.tasks.done}/${p.tasks.total}`} sub={`${p.tasks.in_progress} in progress · ${p.tasks.blocked} blocked`} />
        <Kpi label="Milestones completed" value={`${msDone}/${p.milestones.length}`} />
        <Kpi label="Releases shipped" value={`${relDone}/${p.releases.length}`} />
        <Kpi label="Overdue items" value={p.overdue_items.length} tone={p.overdue_items.length ? 'red' : ''} />
      </div>
      <div className="report-grid">
        <Card title="Overall completion" className="span-2">
          <div className="ov-big"><span className="ov-pct">{p.overall}%</span><div className="grow"><ProgressBar value={p.overall} height={12} /></div></div>
          {p.phases.length > 0 && (
            <div className="phase-bars">
              {p.phases.map((ph) => (
                <button type="button" key={ph.id} className="hbar-row plain" onClick={() => openItem(ph.ref)} title={`${ph.name}: ${ph.progress}% · ${stateOf(ph.state).label}`}>
                  <span className="hbar-label wide ellipsis"><span className="phase-swatch" style={{ background: ph.color }} /> {ph.name}</span>
                  <div className="hbar-track"><div style={{ width: `${ph.progress}%`, background: stateOf(ph.state).color }} /></div>
                  <b className="hbar-value">{ph.progress}%</b>
                  <StateBadge state={ph.state} small />
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card title="Overdue items" className={p.overdue_items.length ? 'danger-edge' : ''}>
          {p.overdue_items.length ? (
            <div className="ov-list">
              {p.overdue_items.slice(0, 12).map((it) => (
                <button type="button" key={it.ref} className="ov-item" onClick={() => openItem(it.ref)}>
                  {it.kind === 'task' ? <TypeIcon type={it.type} /> : <KindIcon type={it.kind} item={{ state: 'delayed' }} />}
                  <span className="grow ellipsis">{it.name}</span>
                  <RefChip refKey={it.ref} />
                  <span className="text-red small nowrap">{it.days_late}d late</span>
                </button>
              ))}
            </div>
          ) : <p className="muted small">Nothing is overdue.</p>}
        </Card>
      </div>

      <h3 className="report-h">Planned vs actual</h3>
      <div className="table-wrap card-panel flush">
        <table className="simple-table clickable">
          <thead><tr><th>Item</th><th>Planned</th><th>Actual finish</th><th>Variance</th><th>Progress</th><th>Status</th></tr></thead>
          <tbody>
            {[
              ...p.phases.map((x) => ({ ...x, kind: 'phase', planned: <DateSpan start={x.start_date} end={x.end_date} />, actual: x.completed_date })),
              ...p.milestones.map((x) => ({ ...x, kind: 'milestone', planned: x.target_date ? fmtDate(x.target_date, { relative: false }) : '—', actual: x.completed_date })),
              ...p.releases.map((x) => ({ ...x, kind: 'release', planned: <DateSpan start={x.start_date} end={x.release_date} />, actual: x.released_date })),
            ].map((x) => (
              <tr key={x.ref} onClick={() => openItem(x.ref)}>
                <td><span className="row-gap"><KindIcon type={x.kind} item={x} /> {x.name} <RefChip refKey={x.ref} /></span></td>
                <td>{x.planned}</td>
                <td>{x.actual ? fmtDate(x.actual, { relative: false }) : <span className="muted">—</span>}</td>
                <td><Variance days={x.variance_days} /></td>
                <td style={{ minWidth: 120 }}><div className="row-gap"><ProgressBar value={x.progress} color={stateOf(x.state).color} height={5} /><span className="small">{x.progress}%</span></div></td>
                <td><StateBadge state={x.state} small /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!p.phases.length && !p.milestones.length && !p.releases.length && <p className="muted small pad">Add phases, milestones or releases to compare planned and actual dates.</p>}

      {p.releases.length > 0 && (
        <>
          <h3 className="report-h">Release progress</h3>
          <div className="release-cards">
            {p.releases.map((r) => (
              <button type="button" key={r.id} className="release-card" onClick={() => openItem(r.ref)}>
                <span className="row-between"><b>{r.name}</b><StateBadge state={r.state} small /></span>
                <ProgressBar value={r.progress} color={stateOf(r.state).color} height={8} />
                <span className="row-between small muted">
                  <span>{r.task_done}/{r.task_count} tasks · {r.open_bugs} open bugs</span>
                  <span>{r.release_date ? fmtDate(r.release_date) : 'No date'}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function BugTrend({ trend }) {
  const max = Math.max(1, ...trend.flatMap((d) => [d.opened, d.resolved]));
  return (
    <div>
      <div className="trend">
        {trend.map((d) => (
          <div key={d.date} className="trend-col" title={`${fmtDate(d.date, { relative: false })}: ${d.opened} opened, ${d.resolved} resolved`}>
            <div className="trend-bars">
              <div className="bar" style={{ height: `${(d.opened / max) * 100}%`, background: 'var(--accent)' }} />
              <div className="bar" style={{ height: `${(d.resolved / max) * 100}%`, background: 'var(--green)' }} />
            </div>
            <span className="trend-label">{parseDate(d.date).getDate() % 5 === 0 ? parseDate(d.date).getDate() : ''}</span>
          </div>
        ))}
      </div>
      <div className="legend inline">
        <span className="legend-item"><span className="dot" style={{ background: 'var(--accent)' }} />Opened</span>
        <span className="legend-item"><span className="dot" style={{ background: 'var(--green)' }} />Resolved</span>
      </div>
    </div>
  );
}

function BugReport({ data }) {
  const { openTask } = useData();
  const b = data.bugs;
  const t = b.totals;
  if (!t.total) return <EmptyState icon="bug" title="No bugs reported">Create a task with the type "Bug" to start tracking defects.</EmptyState>;
  const sev = (k) => SEVERITIES.find((s) => s.key === k);
  // Ordinal categories keep their natural order (Critical → Trivial) rather than sorting by count.
  const inOrder = (rows, list) => [...rows].sort((a, b) => {
    const ia = list.findIndex((x) => x.key === a.key);
    const ib = list.findIndex((x) => x.key === b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const statusCounts = Object.fromEntries(b.by_status.map((s) => [s.key, s.count]));
  return (
    <>
      <div className="kpis">
        <Kpi label="Open bugs" value={t.open} tone={t.open ? 'amber' : ''} sub={`${t.total} reported`} />
        <Kpi label="Critical open" value={t.open_critical} tone={t.open_critical ? 'red' : ''} />
        <Kpi label="Closed" value={t.closed} tone="green" sub={`${pct(t.closed, t.total)}% of all bugs`} />
        <Kpi label="Avg. time to fix" value={t.avg_resolution_days === null ? '—' : `${t.avg_resolution_days}d`} />
        <Kpi label="Overdue bugs" value={t.overdue} tone={t.overdue ? 'red' : ''} />
      </div>
      <div className="report-grid">
        <Card title="Open bugs by severity">
          <Bars rows={inOrder(b.by_severity, SEVERITIES)} colorOf={(k) => sev(k)?.color || '#94a3b8'} labelOf={(k) => sev(k)?.label || 'Not set'} />
        </Card>
        <Card title="All bugs by status">
          <div className="stacked-bar">
            {STATUSES.map((s) => (statusCounts[s.key] ? <div key={s.key} style={{ flex: statusCounts[s.key], background: s.color }} title={`${s.label}: ${statusCounts[s.key]}`} /> : null))}
          </div>
          <div className="legend">
            {STATUSES.map((s) => (
              <div key={s.key} className="legend-item"><span className="dot" style={{ background: s.color }} /><span className="grow">{s.label}</span><b>{statusCounts[s.key] || 0}</b></div>
            ))}
          </div>
        </Card>
        <Card title="Open bugs by priority">
          <Bars rows={inOrder(b.by_priority, PRIORITIES)} colorOf={(k) => priorityOf(k).color} labelOf={(k) => PRIORITIES.find((p) => p.key === k)?.label || k} />
        </Card>
        <Card title="Opened vs resolved (30 days)" className="span-2"><BugTrend trend={b.trend} /></Card>
        <Card title="Open bugs by environment">
          <Bars rows={b.by_environment} colorOf={() => 'var(--accent)'} labelOf={(k) => k || 'Not set'} />
        </Card>
        <Card title="Open bugs by affected version">
          <Bars rows={b.by_version} colorOf={() => 'var(--accent)'} labelOf={(k) => k || 'Not set'} />
        </Card>
        <Card title="Bugs by fix release" className="span-2">
          {b.by_release.length ? (
            <div className="hbars">
              {b.by_release.map((r) => (
                <div key={r.id} className="hbar-row" title={`${r.name}: ${r.open} open of ${r.total}`}>
                  <span className="hbar-label wide ellipsis">{r.name}</span>
                  <div className="hbar-track">
                    <div style={{ width: `${pct(r.total - r.open, Math.max(1, ...b.by_release.map((x) => x.total)))}%`, background: 'var(--green)' }} />
                    <div style={{ width: `${pct(r.open, Math.max(1, ...b.by_release.map((x) => x.total)))}%`, background: 'var(--accent)' }} />
                  </div>
                  <span className="small nowrap">{r.open} open / {r.total}</span>
                </div>
              ))}
              <div className="legend inline">
                <span className="legend-item"><span className="dot" style={{ background: 'var(--green)' }} />Fixed</span>
                <span className="legend-item"><span className="dot" style={{ background: 'var(--accent)' }} />Open</span>
              </div>
            </div>
          ) : <p className="muted small">No releases yet.</p>}
        </Card>
      </div>

      <h3 className="report-h">Open bugs</h3>
      <div className="table-wrap card-panel flush">
        <table className="simple-table clickable">
          <thead><tr><th>Bug</th><th>Severity</th><th>Priority</th><th>Status</th><th>Environment</th><th>Affected</th><th>Fix release</th><th>Age</th></tr></thead>
          <tbody>
            {b.open.map((x) => (
              <tr key={x.id} onClick={() => openTask(x.id)}>
                <td><span className="row-gap"><RefChip refKey={x.ref} />{x.title}</span></td>
                <td>{x.severity ? <span className={`sev-badge ${x.severity}`}>{x.severity}</span> : <span className="muted">—</span>}</td>
                <td>{priorityOf(x.priority).label}</td>
                <td><span className="row-gap"><StatusDot status={x.status} />{STATUSES.find((s) => s.key === x.status)?.label}</span></td>
                <td className="muted">{x.environment || '—'}</td>
                <td className="muted">{x.affected_version || '—'}</td>
                <td className="muted">{x.release_name || '—'}</td>
                <td className={x.state === 'delayed' ? 'text-red' : 'muted'}>{x.age_days}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TeamReport({ data }) {
  const team = data.team;
  if (!team.length) return <EmptyState icon="users" title="Nobody is assigned yet">Assign tasks in this project to see each person's workload.</EmptyState>;
  const max = Math.max(1, ...team.map((u) => u.open));
  return (
    <div className="table-wrap card-panel flush">
      <table className="simple-table">
        <thead><tr><th>Member</th><th style={{ width: '28%' }}>Open work</th><th>Open</th><th>Done</th><th>Overdue</th><th>Open bugs</th><th>Estimate (open)</th><th>Logged</th></tr></thead>
        <tbody>
          {team.map((u) => (
            <tr key={u.id}>
              <td><span className="row-gap"><Avatar user={u} size={26} /><span><b>{u.name}</b><small className="muted block">{u.title}</small></span></span></td>
              <td>
                <div className="hbar-track" title={`${u.open} open, ${u.overdue} overdue`}>
                  <div style={{ width: `${((u.open - u.overdue) / max) * 100}%`, background: 'var(--accent)' }} />
                  <div style={{ width: `${(u.overdue / max) * 100}%`, background: 'var(--red)' }} />
                </div>
              </td>
              <td><b>{u.open}</b></td>
              <td className="muted">{u.done} <span className="small">({pct(u.done, u.assigned)}%)</span></td>
              <td className={u.overdue ? 'text-red' : 'muted'}>{u.overdue}</td>
              <td className={u.open_bugs ? 'text-amber' : 'muted'}>{u.open_bugs}</td>
              <td className="muted">{fmtHours(u.open_estimate)}</td>
              <td className="muted">{fmtHours(u.logged_hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="legend inline pad">
        <span className="legend-item"><span className="dot" style={{ background: 'var(--accent)' }} />Open, on time</span>
        <span className="legend-item"><span className="dot" style={{ background: 'var(--red)' }} />Overdue</span>
      </div>
    </div>
  );
}

export default function Reports({ project, software, openItem }) {
  const { toast, taskVersion } = useData();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const tabs = [
    { key: 'progress', label: 'Progress', icon: 'trend' },
    ...(software ? [{ key: 'bugs', label: 'Bugs', icon: 'bug' }] : []),
    { key: 'team', label: 'Team', icon: 'users' },
  ];
  const report = tabs.some((t) => t.key === params.get('report')) ? params.get('report') : 'progress';
  useEffect(() => {
    api(`/projects/${project.id}/reports`).then(setData).catch((e) => toast(e.message, 'error'));
  }, [project.id, taskVersion, toast]);

  return (
    <div className="reports">
      <div className="row-between">
        <div className="segmented">
          {tabs.map((t) => (
            <button type="button" key={t.key} className={report === t.key ? 'active' : ''}
              onClick={() => { const n = new URLSearchParams(params); n.set('report', t.key); setParams(n); }}>
              <Icon name={t.icon} size={13} /> {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn small hide-print" onClick={() => window.print()}><Icon name="download" size={13} /> Print / PDF</button>
      </div>
      {!data ? <div className="center-pad"><Spinner /></div> : (
        <div className="report-body">
          {report === 'progress' && <ProgressReport data={data} openItem={openItem} />}
          {report === 'bugs' && <BugReport data={data} />}
          {report === 'team' && <TeamReport data={data} />}
        </div>
      )}
    </div>
  );
}

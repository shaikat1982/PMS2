'use client';

import Icon from '../components/Icon.jsx';
import { Avatar, EmptyState, ProgressBar, RefChip, StateBadge, TypeIcon } from '../components/ui.jsx';
import { fmtDate, stateOf } from '../utils.js';
import { DateSpan, KindIcon } from './common.jsx';

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`ov-stat ${tone || ''}`}>
      <div className="ov-stat-value">{value}</div>
      <div className="ov-stat-label">{label}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

/** Project dashboard: overall and phase progress, milestones, releases and what is late. */
export default function Overview({ plan, openItem, software, onTab }) {
  const { project, phases, milestones, releases, tasks } = plan;
  const msDone = milestones.filter((m) => m.state === 'completed').length;
  const late = [
    ...phases.filter((p) => p.state === 'delayed'),
    ...milestones.filter((m) => m.state === 'delayed'),
    ...releases.filter((r) => r.state === 'delayed'),
    ...tasks.filter((t) => t.state === 'delayed'),
  ];
  const openBugs = tasks.filter((t) => t.type === 'bug' && t.status !== 'done');
  const upcoming = milestones.filter((m) => m.state !== 'completed').slice(0, 6);
  const method = project.progress_method === 'milestones' ? 'weighted milestone progress' : 'completed tasks';

  return (
    <div className="overview">
      <section className="card-panel ov-hero">
        <div className="ov-hero-main">
          <div className="row-between">
            <h3>Overall progress</h3>
            <span className="muted small">Based on {method}</span>
          </div>
          <div className="ov-big">
            <span className="ov-pct">{project.progress}%</span>
            <div className="grow"><ProgressBar value={project.progress} color="var(--accent)" height={12} /></div>
          </div>
          <div className="muted small">
            <DateSpan start={project.start_date} end={project.due_date} />
            {project.due_date && project.due_date < plan.today && project.progress < 100 && <span className="text-red"> · past due date</span>}
          </div>
        </div>
        <div className="ov-stats">
          <Stat label="Tasks done" value={`${project.done_count}/${project.task_count}`} />
          <Stat label="Milestones" value={`${msDone}/${milestones.length}`} sub="completed" />
          <Stat label="Overdue items" value={late.length} tone={late.length ? 'red' : ''} />
          {software && <Stat label="Open bugs" value={openBugs.length} tone={openBugs.some((b) => b.severity === 'critical') ? 'red' : ''} sub={openBugs.some((b) => b.severity === 'critical') ? `${openBugs.filter((b) => b.severity === 'critical').length} critical` : ''} />}
        </div>
      </section>

      <div className="ov-grid">
        <section className="card-panel">
          <header><h3>Phases</h3><button type="button" className="link-btn" onClick={() => onTab('timeline')}>Timeline</button></header>
          <div className="card-panel-body">
            {phases.length ? (
              <div className="ov-phases">
                {phases.map((p) => (
                  <button type="button" key={p.id} className="ov-phase" onClick={() => openItem(p.ref)}>
                    <span className="row-between">
                      <span className="row-gap"><span className="phase-swatch" style={{ background: p.color }} /><b>{p.name}</b><RefChip refKey={p.ref} /></span>
                      <StateBadge state={p.state} small />
                    </span>
                    <ProgressBar value={p.progress} color={stateOf(p.state).color} height={8} />
                    <span className="row-between small muted">
                      <DateSpan start={p.start_date} end={p.end_date} />
                      <span>{p.progress}%{p.task_count ? ` · ${p.task_done}/${p.task_count} tasks` : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : <p className="muted small">No phases. Add them on the Planning tab.</p>}
          </div>
        </section>

        <section className="card-panel">
          <header><h3>Milestones</h3><button type="button" className="link-btn" onClick={() => onTab('planning')}>All</button></header>
          <div className="card-panel-body">
            {milestones.length ? (
              <div className="ov-list">
                {(upcoming.length ? upcoming : milestones.slice(-4)).map((m) => (
                  <button type="button" key={m.id} className="ov-item" onClick={() => openItem(m.ref)}>
                    <KindIcon type="milestone" item={m} />
                    <span className="grow">
                      <span className="ellipsis block">{m.name}</span>
                      <small className="muted">
                        {m.target_date ? `Target ${fmtDate(m.target_date)}` : 'No target date'}
                        {m.state === 'delayed' && <span className="text-red"> · overdue</span>}
                      </small>
                    </span>
                    {m.owner_name && <Avatar user={{ name: m.owner_name, color: m.owner_color }} size={20} />}
                    <span className="small nowrap">{m.progress}%</span>
                    <StateBadge state={m.state} small />
                  </button>
                ))}
                {!upcoming.length && <p className="muted small pad">All milestones are completed.</p>}
              </div>
            ) : <p className="muted small">No milestones yet.</p>}
          </div>
        </section>

        {software && (
          <section className="card-panel">
            <header><h3>Releases</h3><button type="button" className="link-btn" onClick={() => onTab('planning')}>All</button></header>
            <div className="card-panel-body">
              {releases.length ? (
                <div className="ov-list">
                  {releases.map((r) => (
                    <button type="button" key={r.id} className="ov-item" onClick={() => openItem(r.ref)}>
                      <KindIcon type="release" item={r} />
                      <span className="grow">
                        <span className="row-gap"><b>{r.name}</b><StateBadge state={r.state} small /></span>
                        <ProgressBar value={r.progress} color={stateOf(r.state).color} height={5} />
                        <small className="muted">
                          {r.status === 'released' ? `Released ${fmtDate(r.released_date || r.release_date)}` : r.release_date ? `Target ${fmtDate(r.release_date)}` : 'No date'}
                          {' · '}{r.task_done}/{r.task_count} tasks{r.open_bugs ? ` · ${r.open_bugs} open bug${r.open_bugs === 1 ? '' : 's'}` : ''}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : <p className="muted small">No releases yet.</p>}
            </div>
          </section>
        )}

        <section className={`card-panel${late.length ? ' danger-edge' : ''}`}>
          <header><h3>Overdue & delayed</h3><button type="button" className="link-btn" onClick={() => onTab('reports')}>Report</button></header>
          <div className="card-panel-body">
            {late.length ? (
              <div className="ov-list">
                {late.slice(0, 8).map((it) => {
                  const isTask = it.ref.startsWith('TASK');
                  const type = isTask ? 'task' : it.ref.startsWith('PH') ? 'phase' : it.ref.startsWith('MS') ? 'milestone' : 'release';
                  const due = it.due_date || it.end_date || it.target_date || it.release_date;
                  return (
                    <button type="button" key={it.ref} className="ov-item" onClick={() => openItem(it.ref)}>
                      {isTask ? <TypeIcon type={it.type} /> : <KindIcon type={type} item={it} />}
                      <span className="grow ellipsis">{it.title || it.name}</span>
                      <RefChip refKey={it.ref} />
                      <span className="text-red small nowrap">{fmtDate(due)}</span>
                    </button>
                  );
                })}
                {late.length > 8 && <p className="muted small pad">+{late.length - 8} more on the Reports tab</p>}
              </div>
            ) : (
              <EmptyState icon="circleCheck" title="Nothing is late">Every phase, milestone and task is on schedule.</EmptyState>
            )}
          </div>
        </section>

        {software && openBugs.length > 0 && (
          <section className="card-panel">
            <header><h3>Open bugs</h3><span className="muted small">{openBugs.length}</span></header>
            <div className="card-panel-body ov-list">
              {openBugs.slice(0, 6).map((b) => (
                <button type="button" key={b.id} className="ov-item" onClick={() => openItem(b.ref)}>
                  <Icon name="bug" size={14} className="text-red" />
                  <span className="grow ellipsis">{b.title}</span>
                  {b.severity && <span className={`sev-badge ${b.severity}`}>{b.severity}</span>}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

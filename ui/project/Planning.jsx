'use client';

import Icon from '../components/Icon.jsx';
import { Avatar, EmptyState, RefChip, StateBadge } from '../components/ui.jsx';
import { RELEASE_STATUSES, fmtDate, fmtVariance, daysBetween } from '../utils.js';
import { DateSpan, KindIcon, ProgressCell } from './common.jsx';

function Section({ title, count, hint, onAdd, children }) {
  return (
    <section className="plan-section">
      <div className="section-head">
        <div>
          <h2>{title} <span className="muted small">{count}</span></h2>
          <p className="muted small">{hint}</p>
        </div>
        {onAdd && <button type="button" className="btn small" onClick={onAdd}><Icon name="plus" size={13} /> Add</button>}
      </div>
      {children}
    </section>
  );
}

/** Late/early against the plan, for completed items or ones already past their date. */
function Variance({ planned, actual, today, done }) {
  if (!planned) return <span className="muted">—</span>;
  const days = done ? (actual ? daysBetween(planned, actual) : null) : planned < today ? daysBetween(planned, today) : null;
  if (days === null) return <span className="muted">—</span>;
  return <span className={days > 0 ? 'text-red' : 'text-green'}>{fmtVariance(days)}</span>;
}

export default function Planning({ plan, openItem, onAdd, software }) {
  const { phases, milestones, releases, can_manage: canManage, today } = plan;
  const add = (type) => (canManage ? () => onAdd(type) : null);

  return (
    <div className="planning">
      <Section title="Phases" count={phases.length} onAdd={add('phase')}
        hint="Stages of the project, used instead of sprints — for example Planning → Development → Testing → Deployment → Maintenance.">
        {phases.length ? (
          <div className="table-wrap card-panel flush">
            <table className="simple-table clickable">
              <thead><tr><th>Phase</th><th>Planned dates</th><th>Progress</th><th>Status</th><th>Completed</th><th>Tasks</th></tr></thead>
              <tbody>
                {phases.map((p) => (
                  <tr key={p.id} onClick={() => openItem(p.ref)}>
                    <td><span className="row-gap"><span className="phase-swatch" style={{ background: p.color }} /><b>{p.name}</b><RefChip refKey={p.ref} /></span></td>
                    <td><DateSpan start={p.start_date} end={p.end_date} /></td>
                    <td style={{ minWidth: 140 }}><ProgressCell value={p.progress} state={p.state} /></td>
                    <td><StateBadge state={p.state} small /></td>
                    <td>{p.completed_date ? <>{fmtDate(p.completed_date, { relative: false })} <Variance planned={p.end_date} actual={p.completed_date} today={today} done /></> : <Variance planned={p.end_date} today={today} />}</td>
                    <td className="muted">{p.task_count ? `${p.task_done}/${p.task_count}` : '—'}{p.progress_mode === 'manual' && <span title="Progress set manually"> · manual</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="layers" title="No phases">{canManage ? 'Add phases to structure the project timeline.' : 'A manager can add phases.'}</EmptyState>}
      </Section>

      <Section title="Milestones" count={milestones.length} onAdd={add('milestone')}
        hint="Checkpoints that measure progress. Overdue milestones are flagged and their owners notified.">
        {milestones.length ? (
          <div className="table-wrap card-panel flush">
            <table className="simple-table clickable">
              <thead><tr><th>Milestone</th><th>Target</th><th>Owner</th><th>Progress</th><th>Status</th><th>Completed</th><th>Weight</th></tr></thead>
              <tbody>
                {milestones.map((m) => (
                  <tr key={m.id} onClick={() => openItem(m.ref)}>
                    <td>
                      <span className="row-gap"><KindIcon type="milestone" item={m} /><b>{m.name}</b><RefChip refKey={m.ref} /></span>
                      {m.phase_id && <small className="muted block">{phases.find((p) => p.id === m.phase_id)?.name}</small>}
                    </td>
                    <td className={m.state === 'delayed' ? 'text-red' : ''}>{m.target_date ? fmtDate(m.target_date, { relative: false }) : '—'}</td>
                    <td>{m.owner_name ? <span className="row-gap"><Avatar user={{ name: m.owner_name, color: m.owner_color }} size={20} />{m.owner_name}</span> : <span className="muted">—</span>}</td>
                    <td style={{ minWidth: 140 }}><ProgressCell value={m.progress} state={m.state} /></td>
                    <td><StateBadge state={m.state} small /></td>
                    <td>{m.completed_date ? <>{fmtDate(m.completed_date, { relative: false })} <Variance planned={m.target_date} actual={m.completed_date} today={today} done /></> : <Variance planned={m.target_date} today={today} />}</td>
                    <td className="muted">{m.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="diamond" title="No milestones">{canManage ? 'Add milestones such as "Core module complete" or "Production release".' : 'A manager can add milestones.'}</EmptyState>}
      </Section>

      {software && (
        <Section title="Releases" count={releases.length} onAdd={add('release')}
          hint="Versions that group features and bug fixes. Link tasks and bugs to a release from the task's details.">
          {releases.length ? (
            <div className="table-wrap card-panel flush">
              <table className="simple-table clickable">
                <thead><tr><th>Release</th><th>Dates</th><th>Status</th><th>Progress</th><th>Tasks</th><th>Bugs</th><th>Released</th></tr></thead>
                <tbody>
                  {releases.map((r) => (
                    <tr key={r.id} onClick={() => openItem(r.ref)}>
                      <td>
                        <span className="row-gap"><KindIcon type="release" item={r} /><b>{r.name}</b><RefChip refKey={r.ref} /></span>
                        {r.description && <small className="muted block ellipsis" style={{ maxWidth: 280 }}>{r.description}</small>}
                      </td>
                      <td><DateSpan start={r.start_date} end={r.release_date} /></td>
                      <td><span className="muted small">{RELEASE_STATUSES.find((s) => s.key === r.status)?.label}</span> <StateBadge state={r.state} small /></td>
                      <td style={{ minWidth: 140 }}><ProgressCell value={r.progress} state={r.state} /></td>
                      <td className="muted">{r.task_done}/{r.task_count}</td>
                      <td>{r.bug_count ? <span className={r.open_bugs ? 'text-red' : 'muted'}>{r.open_bugs} open / {r.bug_count}</span> : <span className="muted">—</span>}</td>
                      <td>{r.released_date ? <>{fmtDate(r.released_date, { relative: false })} <Variance planned={r.release_date} actual={r.released_date} today={today} done /></> : <Variance planned={r.release_date} today={today} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon="package" title="No releases">{canManage ? 'Add a release such as v1.0.0 and link tasks and bugs to it.' : 'A manager can add releases.'}</EmptyState>}
        </Section>
      )}
    </div>
  );
}

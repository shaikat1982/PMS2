import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { usePersisted } from '../components/TaskWorkspace.jsx';
import { EmptyState, RefChip, StateBadge } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { PLAN_STATES, addDays, daysBetween, fmtDate, parseDate, stateOf, toDateStr } from '../utils.js';
import { KindIcon, usePlanIndex } from './common.jsx';

const ZOOMS = [
  { key: 'day', label: 'Day', ppd: 36 },
  { key: 'week', label: 'Week', ppd: 16 },
  { key: 'month', label: 'Month', ppd: 5 },
  { key: 'quarter', label: 'Quarter', ppd: 2 },
];
const ROW = 34;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (d) => (d ? fmtDate(d, { relative: false }) : '—');
const byStart = (index) => (a, b) => (index.get(a)?.start || '9999').localeCompare(index.get(b)?.start || '9999');

/** Rows: each phase followed by its milestones and visible tasks, then unphased items, then releases. */
function buildRows(plan, index, taskMode, collapsed) {
  const rows = [];
  const showTask = (t) => (taskMode === 'all' || (taskMode === 'key' && t.is_key)) && (t.start_date || t.due_date);
  const childrenOf = (phaseId) => [
    ...plan.milestones.filter((m) => (m.phase_id || null) === phaseId).map((m) => m.ref),
    ...plan.tasks.filter((t) => (t.phase_id || null) === phaseId && showTask(t)).map((t) => t.ref),
  ].sort(byStart(index));

  for (const p of plan.phases) {
    const children = childrenOf(p.id);
    rows.push({ key: p.ref, ref: p.ref, depth: 0, childCount: children.length });
    if (!collapsed[p.ref]) children.forEach((ref) => rows.push({ key: ref, ref, depth: 1 }));
  }
  const loose = childrenOf(null);
  if (loose.length) {
    if (plan.phases.length) rows.push({ key: 'g-none', group: 'Not in a phase' });
    loose.forEach((ref) => rows.push({ key: ref, ref, depth: plan.phases.length ? 1 : 0 }));
  }
  if (plan.releases.length) {
    rows.push({ key: 'g-rel', group: 'Releases' });
    plan.releases.forEach((r) => rows.push({ key: r.ref, ref: r.ref, depth: 1 }));
  }
  return rows;
}

function computeRange(plan, index, rows, zoom) {
  const dates = [plan.today, plan.project.start_date, plan.project.due_date];
  for (const r of rows) {
    const it = r.ref && index.get(r.ref);
    if (it) dates.push(it.start, it.end, it.completed_date, it.released_date);
  }
  const list = dates.filter(Boolean).sort();
  let start = addDays(list[0], -7);
  const end = addDays(list[list.length - 1], zoom === 'day' ? 14 : 30);
  const d = parseDate(start);
  if (zoom === 'day' || zoom === 'week') start = addDays(start, -((d.getDay() + 6) % 7)); // back to Monday
  else start = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
  return { start, end, days: daysBetween(start, end) + 1 };
}

export default function Timeline({ plan, reload, openItem, onAdd, software }) {
  const { toast, bumpTasks } = useData();
  const index = usePlanIndex(plan);
  const [zoomKey, setZoomKey] = usePersisted('gantt:zoom', 'week');
  const [taskMode, setTaskMode] = usePersisted('gantt:tasks', 'key');
  const [showDeps, setShowDeps] = usePersisted('gantt:deps', true);
  const [details, setDetails] = usePersisted('gantt:details', true);
  const [collapsed, setCollapsed] = useState({});
  const [drag, setDrag] = useState(null);
  const [pending, setPending] = useState({});
  const dragRef = useRef(null);
  const scrollRef = useRef(null);
  // On phones the detail columns would cover the whole chart, so only the name column shows.
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const showDetails = details && !narrow;

  const zoom = ZOOMS.find((z) => z.key === zoomKey) || ZOOMS[1];
  const ppd = zoom.ppd;
  const rows = useMemo(() => buildRows(plan, index, taskMode, collapsed), [plan, index, taskMode, collapsed]);
  const range = useMemo(() => computeRange(plan, index, rows, zoom.key), [plan, index, rows, zoom.key]);
  const width = range.days * ppd;
  const LEFT = narrow ? 160 : showDetails ? 640 : 300;
  const x = (date) => daysBetween(range.start, date) * ppd;
  const todayX = x(plan.today);
  const undatedTasks = plan.tasks.filter((t) => !t.start_date && !t.due_date && (taskMode === 'all' || (taskMode === 'key' && t.is_key))).length;

  // Open scrolled so today sits about a third of the way in.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayX - (el.clientWidth - LEFT) / 3);
  }, [zoom.key, LEFT]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Item span with any in-flight drag or unsaved change applied. */
  const spanOf = (it) => {
    let { start, end } = pending[it.ref] || it;
    if (drag?.ref === it.ref && start) {
      if (drag.mode !== 'end') start = addDays(start, drag.delta);
      if (drag.mode !== 'start') end = addDays(end, drag.delta);
      if (start > end) [start, end] = drag.mode === 'start' ? [end, end] : [start, start];
    }
    return { start, end };
  };
  const editable = (it) => it.type === 'task' || plan.can_manage;

  const save = async (it, start, end) => {
    let path;
    let body;
    if (it.type === 'phase') { path = `/phases/${it.id}`; body = { start_date: start, end_date: end }; }
    else if (it.type === 'milestone') { path = `/milestones/${it.id}`; body = { target_date: start }; }
    else if (it.type === 'release') { path = `/releases/${it.id}`; body = { release_date: end, ...(it.start_date || start !== end ? { start_date: start } : {}) }; }
    else { path = `/tasks/${it.id}`; body = { due_date: end, ...(it.start_date || start !== end ? { start_date: start } : {}) }; }
    setPending((p) => ({ ...p, [it.ref]: { start, end } }));
    try {
      const res = await api(path, { method: 'PATCH', body });
      if (res.rescheduled?.length) toast(`Moved ${res.rescheduled.length} dependent item${res.rescheduled.length === 1 ? '' : 's'} later: ${res.rescheduled.join(', ')}`, 'info');
      await reload();
      bumpTasks();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPending((p) => { const n = { ...p }; delete n[it.ref]; return n; });
    }
  };

  const pointerDown = (e, it, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!editable(it)) { dragRef.current = { ref: it.ref, it, x0: e.clientX, readOnly: true }; return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { ref: it.ref, it, mode, x0: e.clientX, delta: 0, moved: false };
    setDrag({ ref: it.ref, mode, delta: 0 });
  };
  const pointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.readOnly) return;
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    const delta = Math.round((e.clientX - d.x0) / ppd);
    if (delta !== d.delta) { d.delta = delta; setDrag({ ref: d.ref, mode: d.mode, delta }); }
  };
  const pointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.readOnly || !d.moved) { setDrag(null); openItem(d.ref); return; }
    const { start, end } = spanOf(d.it);
    setDrag(null);
    if (d.delta) save(d.it, start, end);
  };
  const handlers = (it, mode = 'move') => ({
    onPointerDown: (e) => pointerDown(e, it, mode), onPointerMove: pointerMove, onPointerUp: pointerUp,
    onPointerCancel: () => { dragRef.current = null; setDrag(null); },
  });

  // ---- Header ticks -------------------------------------------------------
  const months = [];
  for (let d = parseDate(range.start); toDateStr(d) <= range.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const first = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
    const next = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1));
    const left = Math.max(0, x(first));
    const w = Math.min(width, x(next)) - left;
    months.push({ key: first, left, w, label: w > 90 ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : w > 30 ? MONTHS[d.getMonth()] : '' });
  }
  const ticks = [];
  if (zoom.key === 'day' || zoom.key === 'week') {
    for (let i = 0; i < range.days; i += 1) {
      const date = addDays(range.start, i);
      const dow = parseDate(date).getDay();
      if (zoom.key === 'day') ticks.push({ key: date, left: i * ppd, label: parseDate(date).getDate(), weekend: dow === 0 || dow === 6, line: true });
      else ticks.push({ key: date, left: i * ppd, label: dow === 1 ? `${parseDate(date).getDate()}` : '', weekend: dow === 0 || dow === 6, line: dow === 1 });
    }
  }

  // ---- Geometry -----------------------------------------------------------
  const rowOf = new Map(rows.map((r, i) => [r.ref, i]));
  const geom = (it) => {
    const { start, end } = spanOf(it);
    if (!start) return null;
    const left = x(start);
    const right = x(end) + ppd;
    const point = it.type === 'milestone' || (it.type === 'release' && start === end);
    return { start, end, left, right, center: left + ppd / 2, point };
  };

  const depPaths = !showDeps ? [] : plan.dependencies.map((d) => {
    const pi = rowOf.get(d.pred_ref);
    const si = rowOf.get(d.succ_ref);
    const pred = index.get(d.pred_ref);
    const succ = index.get(d.succ_ref);
    if (pi === undefined || si === undefined || !pred || !succ) return null;
    const pg = geom(pred);
    const sg = geom(succ);
    if (!pg || !sg) return null;
    const x1 = d.kind === 'SS' ? (pg.point ? pg.center - 7 : pg.left) : (pg.point ? pg.center + 7 : pg.right);
    const x2 = sg.point ? sg.center - 8 : sg.left;
    const y1 = pi * ROW + ROW / 2;
    const y2 = si * ROW + ROW / 2;
    const required = d.kind === 'SS' ? pg.start : pg.end;
    const conflict = sg.start < required;
    const g = 8;
    const path = x2 - g >= x1 + g || d.kind === 'SS'
      ? `M${x1},${y1} H${Math.min(x1 + g, x2 - g)} V${y2} H${x2}`
      : `M${x1},${y1} H${x1 + g} V${(y1 + y2) / 2 + (y2 > y1 ? -ROW / 2 + 4 : ROW / 2 - 4)} H${x2 - g} V${y2} H${x2}`;
    return { id: d.id, path, conflict, title: `${d.pred_ref} → ${d.succ_ref}${conflict ? ' — starts before its dependency allows' : ''}` };
  }).filter(Boolean);

  if (!plan.phases.length && !plan.milestones.length && !plan.releases.length && !plan.tasks.some((t) => t.start_date || t.due_date)) {
    return (
      <EmptyState icon="gantt" title="Nothing on the timeline yet">
        Add phases, milestones{software ? ', releases' : ''} or give tasks start and due dates to see them here.
        {plan.can_manage && (
          <span className="row-gap" style={{ marginTop: 12 }}>
            <button type="button" className="btn small" onClick={() => onAdd('phase')}><Icon name="plus" size={13} /> Phase</button>
            <button type="button" className="btn small" onClick={() => onAdd('milestone')}><Icon name="plus" size={13} /> Milestone</button>
          </span>
        )}
      </EmptyState>
    );
  }

  const preds = (ref) => plan.dependencies.filter((d) => d.succ_ref === ref).map((d) => d.pred_ref);

  const renderBar = (it) => {
    const g = geom(it);
    if (!g) return <span className="gantt-unscheduled" style={{ left: Math.max(8, todayX - 40) }}>Not scheduled</span>;
    const st = stateOf(it.state);
    const tip = `${it.ref} · ${it.name}\n${short(g.start)}${g.start !== g.end ? ` → ${short(g.end)}` : ''}\n${st.label} · ${it.progress ?? 0}%`;
    const dragging = drag?.ref === it.ref;
    const canEdit = editable(it);
    const tail = it.state === 'delayed' && x(plan.today) > g.right - ppd
      ? <div className="gantt-tail" style={{ left: g.point ? g.center : g.right, width: x(plan.today) + ppd - (g.point ? g.center : g.right) }} title="Overdue — planned end has passed" />
      : null;

    if (it.type === 'milestone') {
      const actual = it.completed_date && it.completed_date !== g.start ? x(it.completed_date) + ppd / 2 : null;
      return (
        <>
          {tail}
          {actual !== null && <span className="gantt-actual" style={{ left: actual - 4 }} title={`Completed ${short(it.completed_date)}`} />}
          <div className={`gantt-milestone${it.state === 'completed' ? ' done' : ''}${dragging ? ' dragging' : ''}${canEdit ? ' editable' : ''}`}
            style={{ left: g.center - 8, '--c': st.color }} title={tip} {...handlers(it)} />
          <span className="gantt-label" style={{ left: Math.max(g.center + 12, actual === null ? 0 : actual + 8) }}>{it.name}</span>
        </>
      );
    }
    if (g.point) {
      return (
        <>
          {tail}
          <div className={`gantt-release-point${dragging ? ' dragging' : ''}${canEdit ? ' editable' : ''}`} style={{ left: g.center - 9, '--c': st.color }} title={tip} {...handlers(it)}>
            <Icon name="package" size={12} />
          </div>
          <span className="gantt-label" style={{ left: g.center + 14 }}>{it.name}</span>
        </>
      );
    }
    return (
      <>
        {tail}
        <div
          className={`gantt-bar ${it.type}${dragging ? ' dragging' : ''}${canEdit ? ' editable' : ''}`}
          style={{ left: g.left, width: Math.max(g.right - g.left, 6), '--c': st.color }}
          title={tip}
          {...handlers(it)}
        >
          <div className="gantt-fill" style={{ width: `${it.progress ?? 0}%` }} />
          {canEdit && <span className="gantt-handle l" {...handlers(it, 'start')} />}
          {canEdit && <span className="gantt-handle r" {...handlers(it, 'end')} />}
        </div>
        <span className="gantt-label" style={{ left: g.right + 6 }}>
          {it.type === 'release' && <Icon name="package" size={11} />} {it.type === 'release' ? it.name : `${it.progress ?? 0}%`}
        </span>
      </>
    );
  };

  return (
    <div className="timeline">
      <div className="toolbar">
        <div className="segmented">
          {ZOOMS.map((z) => <button type="button" key={z.key} className={zoom.key === z.key ? 'active' : ''} onClick={() => setZoomKey(z.key)}>{z.label}</button>)}
        </div>
        <button type="button" className="btn small" onClick={() => { const el = scrollRef.current; if (el) el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - LEFT) / 3), behavior: 'smooth' }); }}>Today</button>
        <select className="filter-select" value={taskMode} onChange={(e) => setTaskMode(e.target.value)} title="Which tasks to show">
          <option value="key">Key tasks</option>
          <option value="all">All scheduled tasks</option>
          <option value="none">No tasks</option>
        </select>
        <label className="toggle"><input type="checkbox" checked={showDeps} onChange={(e) => setShowDeps(e.target.checked)} /> Dependencies</label>
        {!narrow && <label className="toggle"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Details</label>}
        <span className="grow" />
        {plan.can_manage && (
          <>
            <button type="button" className="btn small" onClick={() => onAdd('phase')}><Icon name="plus" size={13} /> Phase</button>
            <button type="button" className="btn small" onClick={() => onAdd('milestone')}><Icon name="plus" size={13} /> Milestone</button>
            {software && <button type="button" className="btn small" onClick={() => onAdd('release')}><Icon name="plus" size={13} /> Release</button>}
          </>
        )}
      </div>

      <div className="gantt-scroll" ref={scrollRef}>
        <div className="gantt-inner" style={{ width: LEFT + width, '--left': `${LEFT}px`, '--row': `${ROW}px` }}>
          <div className="gantt-head">
            <div className={`gantt-corner gantt-cols${showDetails ? ' details' : ''}`}>
              <span className="gc-name">Work item</span>
              {showDetails && <><span className="gc-date">Start</span><span className="gc-date">End</span><span className="gc-num">Progress</span><span className="gc-state">Status</span><span className="gc-deps">Depends on</span></>}
            </div>
            <div className={`gantt-scale${ticks.length ? '' : ' single'}`} style={{ width }}>
              <div className="gantt-months">
                {months.map((m) => <span key={m.key} style={{ left: m.left, width: m.w }}>{m.label}</span>)}
              </div>
              {ticks.length > 0 && (
                <div className="gantt-days">
                  {ticks.filter((t) => t.label !== '').map((t) => <span key={t.key} className={t.weekend ? 'weekend' : ''} style={{ left: t.left, width: zoom.key === 'day' ? ppd : ppd * 7 }}>{t.label}</span>)}
                </div>
              )}
              <span className="gantt-today-flag" style={{ left: todayX + ppd / 2 }}>Today</span>
            </div>
          </div>

          <div className="gantt-body" style={{ height: rows.length * ROW }}>
            <div className="gantt-grid" style={{ width }}>
              {ticks.filter((t) => t.weekend && zoom.key !== 'quarter').map((t) => <span key={`w${t.key}`} className="gantt-weekend" style={{ left: t.left, width: ppd }} />)}
              {ticks.filter((t) => t.line).map((t) => <span key={`l${t.key}`} className="gantt-line" style={{ left: t.left }} />)}
              {!ticks.length && months.map((m) => <span key={`m${m.key}`} className="gantt-line" style={{ left: m.left }} />)}
              <span className="gantt-today" style={{ left: todayX + ppd / 2 }} />
            </div>
            {depPaths.length > 0 && (
              <svg className="gantt-deps" width={width} height={rows.length * ROW}>
                <defs>
                  <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--gantt-dep)" /></marker>
                  <marker id="gantt-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--red)" /></marker>
                </defs>
                {depPaths.map((p) => (
                  <path key={p.id} d={p.path} className={p.conflict ? 'conflict' : ''} markerEnd={`url(#${p.conflict ? 'gantt-arrow-bad' : 'gantt-arrow'})`}><title>{p.title}</title></path>
                ))}
              </svg>
            )}

            {rows.map((r) => {
              if (r.group) {
                return (
                  <div key={r.key} className="gantt-row group">
                    <div className="gantt-cells"><span className="gantt-group">{r.group}</span></div>
                    <div className="gantt-track" style={{ width }} />
                  </div>
                );
              }
              const it = index.get(r.ref);
              if (!it) return null;
              const deps = preds(it.ref);
              return (
                <div key={r.key} className={`gantt-row ${it.type}${it.state === 'delayed' ? ' is-delayed' : ''}`}>
                  <div className={`gantt-cells gantt-cols${showDetails ? ' details' : ''}`}>
                    <span className="gc-name" style={{ paddingLeft: 6 + r.depth * 18 }}>
                      {r.childCount !== undefined ? (
                        <button type="button" className="icon-btn tiny" disabled={!r.childCount} onClick={() => setCollapsed((c) => ({ ...c, [r.ref]: !c[r.ref] }))} aria-label="Toggle phase">
                          <Icon name={collapsed[r.ref] || !r.childCount ? 'chevronRight' : 'chevronDown'} size={13} />
                        </button>
                      ) : null}
                      {it.type === 'phase' && <span className="phase-swatch" style={{ background: it.color }} />}
                      <KindIcon type={it.type} item={it} size={13} />
                      <button type="button" className="gantt-name" onClick={() => openItem(it.ref)} title={it.name}>{it.name}</button>
                      {it.is_key && <Icon name="star" size={12} className="key-star" fill="currentColor" />}
                      <RefChip refKey={it.ref} />
                    </span>
                    {showDetails && (
                      <>
                        <span className="gc-date">{short(it.start)}</span>
                        <span className="gc-date">{short(it.end)}</span>
                        <span className="gc-num">{it.progress ?? 0}%</span>
                        <span className="gc-state"><StateBadge state={it.state} small /></span>
                        <span className="gc-deps" title={deps.join(', ')}>{deps.length ? deps.join(', ') : '—'}</span>
                      </>
                    )}
                  </div>
                  <div className="gantt-track" style={{ width }}>{renderBar(it)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="gantt-legend">
        {PLAN_STATES.filter((s) => s.key !== 'cancelled').map((s) => (
          <span key={s.key} className="legend-item"><span className="legend-bar" style={{ '--c': s.color }} />{s.label}</span>
        ))}
        <span className="legend-item"><span className="legend-diamond" /> Milestone</span>
        <span className="legend-item"><span className="legend-tail" /> Overdue</span>
        <span className="legend-item"><span className="legend-dep" /> Dependency</span>
        <span className="legend-item"><span className="legend-dep bad" /> Conflict</span>
        <span className="legend-item"><span className="legend-today" /> Today</span>
        {undatedTasks > 0 && <span className="muted small">{undatedTasks} task{undatedTasks === 1 ? '' : 's'} without dates not shown</span>}
        <span className="grow" />
        <span className="muted small">Drag bars to reschedule · drag the ends to resize · click to open</span>
      </div>
    </div>
  );
}

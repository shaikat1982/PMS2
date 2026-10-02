'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '../router.js';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Avatar, ColorPicker, ConfirmButton, Field, Modal, ProgressBar, RefChip, StateBadge, StatusDot, TypeIcon } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { PLAN_KINDS, PLAN_STATUSES, RELEASE_STATUSES, fmtDate, parseRef, stateOf } from '../utils.js';

/** Loads /projects/:id/plan and reloads whenever tasks change anywhere in the app. */
export function usePlan(projectId) {
  const { taskVersion, toast } = useData();
  const [plan, setPlan] = useState(null);
  const reload = useCallback(
    () => api(`/projects/${projectId}/plan`).then(setPlan).catch((e) => toast(e.message, 'error')),
    [projectId, toast],
  );
  useEffect(() => { reload(); }, [reload, taskVersion]);
  return { plan, reload };
}

/** Every timeline item by ref ("PH-1", "MS-2", "REL-3", "TASK-4") with a uniform start/end. */
export function usePlanIndex(plan) {
  return useMemo(() => {
    const map = new Map();
    if (!plan) return map;
    const add = (type, item, name, start, end) => {
      const s = start || end || null;
      const e = end || start || null;
      map.set(item.ref, { ...item, type, name, start: s && e && s > e ? e : s, end: s && e && s > e ? s : e });
    };
    for (const p of plan.phases) add('phase', p, p.name, p.start_date, p.end_date);
    for (const m of plan.milestones) add('milestone', m, m.name, m.target_date, m.target_date);
    for (const r of plan.releases) add('release', r, r.name, r.start_date, r.release_date);
    for (const t of plan.tasks) add('task', t, t.title, t.start_date, t.due_date);
    return map;
  }, [plan]);
}

/** Opens a phase / milestone / release in the item modal, or a task in the task modal. */
export function useOpenItem() {
  const [params, setParams] = useSearchParams();
  const { openTask } = useData();
  return useCallback((ref) => {
    const parsed = parseRef(ref);
    if (!parsed) return;
    if (parsed.type === 'task') { openTask(parsed.id); return; }
    const next = new URLSearchParams(params);
    next.set('item', ref);
    setParams(next);
  }, [params, setParams, openTask]);
}

export function KindIcon({ type, item, size = 14 }) {
  if (type === 'task') return <TypeIcon type={item?.type} size={size} />;
  const color = type === 'phase' ? item?.color : stateOf(item?.state).color;
  return <span className={`kind-icon ${type}`} style={{ '--c': color || 'var(--muted)' }}><Icon name={PLAN_KINDS[type].icon} size={size} /></span>;
}

export function ProgressCell({ value, state }) {
  return (
    <span className="progress-cell">
      <ProgressBar value={value} color={stateOf(state).color} height={5} />
      <span>{value}%</span>
    </span>
  );
}

export function DateSpan({ start, end }) {
  if (!start && !end) return <span className="muted">Not scheduled</span>;
  if (!start || start === end) return <span>{fmtDate(end || start, { relative: false })}</span>;
  return <span>{fmtDate(start, { relative: false })} → {fmtDate(end, { relative: false })}</span>;
}

// ---- Dependencies ----------------------------------------------------------

const KIND_TEXT = { FS: 'must finish first', SS: 'must start first' };

/** Lists what an item depends on and what depends on it, with add/remove. */
export function DependencyEditor({ plan, refKey, canEdit, onChange }) {
  const { toast } = useData();
  const index = usePlanIndex(plan);
  const [pred, setPred] = useState('');
  const [kind, setKind] = useState('FS');
  const before = plan.dependencies.filter((d) => d.succ_ref === refKey);
  const after = plan.dependencies.filter((d) => d.pred_ref === refKey);
  const taken = new Set(before.map((d) => d.pred_ref));
  const options = [...index.values()].filter((i) => i.ref !== refKey && !taken.has(i.ref));

  const add = async () => {
    if (!pred) return;
    try {
      const res = await api('/dependencies', { method: 'POST', body: { predecessor: pred, successor: refKey, kind } });
      setPred('');
      if (res.rescheduled?.length) toast(`Moved ${res.rescheduled.length} item${res.rescheduled.length === 1 ? '' : 's'} later to respect the new dependency`, 'success');
      onChange();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async (id) => {
    try { await api(`/dependencies/${id}`, { method: 'DELETE' }); onChange(); } catch (e) { toast(e.message, 'error'); }
  };
  const Row = ({ dep, other }) => {
    const item = index.get(other);
    return (
      <div className="dep-row">
        {item && <KindIcon type={item.type} item={item} size={13} />}
        <RefChip refKey={other} />
        <span className="grow ellipsis">{item?.name || 'Deleted item'}</span>
        <span className="muted small nowrap">{dep.kind === 'SS' ? 'start-to-start' : 'finish-to-start'}</span>
        {canEdit && <button type="button" className="icon-btn tiny" onClick={() => remove(dep.id)} aria-label="Remove dependency"><Icon name="x" size={12} /></button>}
      </div>
    );
  };

  return (
    <div className="deps">
      <div className="dep-group">
        <span className="dep-label">Depends on</span>
        {before.length ? before.map((d) => <Row key={d.id} dep={d} other={d.pred_ref} />) : <span className="muted small">Nothing</span>}
      </div>
      <div className="dep-group">
        <span className="dep-label">Required by</span>
        {after.length ? after.map((d) => <Row key={d.id} dep={d} other={d.succ_ref} />) : <span className="muted small">Nothing</span>}
      </div>
      {canEdit && (
        <div className="dep-add">
          <select value={pred} onChange={(e) => setPred(e.target.value)}>
            <option value="">Add a dependency…</option>
            {['phase', 'milestone', 'release', 'task'].map((type) => {
              const list = options.filter((o) => o.type === type);
              return list.length ? (
                <optgroup key={type} label={PLAN_KINDS[type].plural}>
                  {list.map((o) => <option key={o.ref} value={o.ref}>{o.ref} · {o.name}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="dep-kind" title="Dependency type">
            <option value="FS">{KIND_TEXT.FS}</option>
            <option value="SS">{KIND_TEXT.SS}</option>
          </select>
          <button type="button" className="btn small" onClick={add} disabled={!pred}>Add</button>
        </div>
      )}
      <p className="field-hint">When an item moves later, everything that depends on it moves too, keeping its length.</p>
    </div>
  );
}

// ---- Phase / milestone / release editor -----------------------------------

const ENDPOINT = { phase: 'phases', milestone: 'milestones', release: 'releases' };

function initialForm(type, item, plan) {
  const v = (k, d = '') => item?.[k] ?? d;
  if (type === 'phase') {
    return {
      name: v('name'), description: v('description'), color: v('color', '#7b68ee'), start_date: v('start_date'), end_date: v('end_date'),
      status: v('status', 'not_started'), progress_mode: v('progress_mode', 'auto'), progress: v('progress', 0), completed_date: v('completed_date'),
    };
  }
  if (type === 'milestone') {
    return {
      name: v('name'), description: v('description'), phase_id: v('phase_id'), owner_id: v('owner_id', plan.project.owner_id || ''),
      target_date: v('target_date'), status: v('status', 'not_started'), progress_mode: v('progress_mode', 'auto'), progress: v('progress', 0),
      completed_date: v('completed_date'), weight: v('weight', 1),
    };
  }
  return {
    name: v('name'), description: v('description'), status: v('status', 'planned'), start_date: v('start_date'),
    release_date: v('release_date'), released_date: v('released_date'),
  };
}

/** Create or edit a phase, milestone or release. refKey is "PH-3" etc., or "new:phase". */
export function PlanItemModal({ plan, refKey, onClose, onSaved }) {
  const { toast, activeUsers, openTask, bumpTasks } = useData();
  const isNew = refKey.startsWith('new:');
  const type = isNew ? refKey.slice(4) : parseRef(refKey)?.type;
  const index = usePlanIndex(plan);
  const item = isNew ? null : index.get(refKey);
  const canEdit = plan.can_manage;
  const [form, setForm] = useState(() => initialForm(type, item, plan));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  if (!type || type === 'task' || (!isNew && !item)) {
    return <Modal title="Not found" onClose={onClose}><p>{refKey} does not exist in this project. It may have been deleted.</p></Modal>;
  }
  const kind = PLAN_KINDS[type];
  const calculated = item?.calculated;
  const linkedKey = { phase: 'phase_id', milestone: 'milestone_id', release: 'release_id' }[type];
  const linked = item ? plan.tasks.filter((t) => t[linkedKey] === item.id) : [];

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, project_id: plan.project.id };
      for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
      // Left empty, the server stamps today when the status becomes completed / released.
      for (const k of ['completed_date', 'released_date']) if (!body[k]) delete body[k];
      if (body.progress !== undefined && body.progress !== null) body.progress = Number(body.progress);
      if (body.weight !== undefined && body.weight !== null) body.weight = Number(body.weight);
      if (body.description === null) body.description = '';
      if (type !== 'release' && body.progress_mode === 'auto') delete body.progress;
      const saved = await api(isNew ? `/${ENDPOINT[type]}` : `/${ENDPOINT[type]}/${item.id}`, { method: isNew ? 'POST' : 'PATCH', body });
      toast(isNew ? `${kind.label} created` : `${kind.label} saved`, 'success');
      if (saved.rescheduled?.length) toast(`Moved ${saved.rescheduled.length} dependent item${saved.rescheduled.length === 1 ? '' : 's'} later`, 'info');
      onSaved();
      bumpTasks();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    await api(`/${ENDPOINT[type]}/${item.id}`, { method: 'DELETE' });
    toast(`${kind.label} deleted`, 'success');
    onSaved();
    bumpTasks();
    onClose();
  };

  const statusControl = type === 'release' ? (
    <Field label="Status">
      <select value={form.status} onChange={set('status')} disabled={!canEdit}>
        {RELEASE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </Field>
  ) : (
    <Field label="Status" hint={calculated ? `Calculated from ${item.task_count} linked task${item.task_count === 1 ? '' : 's'}` : undefined}>
      <select value={calculated ? item.status : form.status} onChange={set('status')} disabled={!canEdit || calculated}>
        {PLAN_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </Field>
  );

  const progressControl = type !== 'release' && (
    <div className="form-row">
      <Field label="Progress">
        <div className="segmented wide">
          <button type="button" disabled={!canEdit} className={form.progress_mode === 'auto' ? 'active' : ''} onClick={() => set('progress_mode')('auto')}>From linked tasks</button>
          <button type="button" disabled={!canEdit} className={form.progress_mode === 'manual' ? 'active' : ''} onClick={() => set('progress_mode')('manual')}>Set manually</button>
        </div>
        {form.progress_mode === 'auto' && (
          <span className="field-hint">
            {item?.task_count ? `${item.task_done} of ${item.task_count} linked tasks done (${item.progress}%)` : 'No linked tasks yet — status and progress below are used until tasks are linked.'}
          </span>
        )}
      </Field>
      {(form.progress_mode === 'manual' || !item?.task_count) && (
        <Field label={`Manual progress: ${form.progress || 0}%`}>
          <input type="range" min="0" max="100" step="5" value={form.progress || 0} onChange={set('progress')} disabled={!canEdit} />
        </Field>
      )}
    </div>
  );

  return (
    <Modal
      title={isNew ? `New ${kind.label.toLowerCase()}` : (
        <span className="row-gap"><KindIcon type={type} item={item} /> {item.name} <RefChip refKey={item.ref} /></span>
      )}
      onClose={onClose}
      width={640}
      footer={canEdit ? (
        <>
          <span className="grow">{!isNew && <ConfirmButton className="btn danger ghost" onConfirm={remove}>Delete {kind.label.toLowerCase()}</ConfirmButton>}</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="plan-item-form" className="btn primary" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : isNew ? `Create ${kind.label.toLowerCase()}` : 'Save'}</button>
        </>
      ) : <span className="muted small">Only managers and the project owner can change the plan.</span>}
    >
      <form id="plan-item-form" className="form" onSubmit={save}>
        {item && (
          <div className="item-summary">
            <StateBadge state={item.state} />
            <ProgressCell value={item.progress} state={item.state} />
            {item.state === 'delayed' && <span className="text-red small">Planned end date has passed</span>}
          </div>
        )}
        <Field label={type === 'release' ? 'Version / name' : 'Name'}>
          <input autoFocus={isNew} required value={form.name} onChange={set('name')} disabled={!canEdit}
            placeholder={type === 'release' ? 'e.g. v2.1.0' : type === 'milestone' ? 'e.g. Core module complete' : 'e.g. Development'} />
        </Field>

        {type === 'phase' && (
          <div className="form-row">
            <Field label="Planned start"><input type="date" value={form.start_date || ''} onChange={set('start_date')} disabled={!canEdit} /></Field>
            <Field label="Planned end"><input type="date" value={form.end_date || ''} onChange={set('end_date')} disabled={!canEdit} /></Field>
            {statusControl}
          </div>
        )}
        {type === 'milestone' && (
          <>
            <div className="form-row">
              <Field label="Target date"><input type="date" value={form.target_date || ''} onChange={set('target_date')} disabled={!canEdit} /></Field>
              <Field label="Owner">
                <select value={form.owner_id || ''} onChange={set('owner_id')} disabled={!canEdit}>
                  <option value="">No owner</option>
                  {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              {statusControl}
            </div>
            <div className="form-row">
              <Field label="Phase">
                <select value={form.phase_id || ''} onChange={set('phase_id')} disabled={!canEdit}>
                  <option value="">No phase</option>
                  {plan.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Weight" hint={plan.project.progress_method === 'milestones' ? 'Share of overall project progress' : 'Used when project progress is based on milestones'}>
                <input type="number" min="0" step="0.5" value={form.weight} onChange={set('weight')} disabled={!canEdit} />
              </Field>
              <Field label="Completed on">
                <input type="date" value={(calculated ? item.completed_date : form.completed_date) || ''} onChange={set('completed_date')}
                  disabled={!canEdit || calculated || (form.status !== 'completed')} />
              </Field>
            </div>
          </>
        )}
        {type === 'release' && (
          <div className="form-row">
            <Field label="Start"><input type="date" value={form.start_date || ''} onChange={set('start_date')} disabled={!canEdit} /></Field>
            <Field label="Target release date"><input type="date" value={form.release_date || ''} onChange={set('release_date')} disabled={!canEdit} /></Field>
            {statusControl}
            {form.status === 'released' && (
              <Field label="Released on"><input type="date" value={form.released_date || ''} onChange={set('released_date')} disabled={!canEdit} /></Field>
            )}
          </div>
        )}
        {progressControl}
        {type === 'phase' && <Field label="Color"><ColorPicker value={form.color} onChange={canEdit ? set('color') : () => {}} /></Field>}
        <Field label="Description"><textarea rows={2} value={form.description} onChange={set('description')} disabled={!canEdit} /></Field>

        {item && (
          <>
            <h4 className="form-section">Dependencies</h4>
            <DependencyEditor plan={plan} refKey={item.ref} canEdit={canEdit} onChange={onSaved} />
            <h4 className="form-section">
              Linked tasks <span className="muted small">{linked.length}</span>
              {type === 'release' && item.bug_count > 0 && <span className="muted small"> · {item.open_bugs} open of {item.bug_count} bugs</span>}
            </h4>
            {linked.length ? (
              <div className="mini-tasks">
                {linked.map((t) => (
                  <button type="button" key={t.id} className="mini-task" onClick={() => { onClose(); openTask(t.id); }}>
                    <StatusDot status={t.status} />
                    <TypeIcon type={t.type} />
                    <span className="grow ellipsis">{t.title}</span>
                    <RefChip refKey={t.ref} />
                    {t.assignees[0] && <Avatar user={t.assignees[0]} size={20} />}
                  </button>
                ))}
              </div>
            ) : <p className="muted small">Link tasks from the task's details panel ({kind.label} field).</p>}
          </>
        )}
      </form>
    </Modal>
  );
}

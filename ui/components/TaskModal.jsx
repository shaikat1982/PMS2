'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '../router.js';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { DependencyEditor } from '../project/common.jsx';
import { SEVERITIES, dueState, fmtDate, fmtHours, parseStamp, pct, statusOf, timeAgo, todayStr } from '../utils.js';
import Attachments from './Attachments.jsx';
import GitLinks from './GitLinks.jsx';
import Icon from './Icon.jsx';
import TagInput from './TagInput.jsx';
import {
  AssigneePicker, Avatar, ConfirmButton, DueDate, MenuItem, Modal, Popover, PriorityPicker, ProgressBar, RefChip, Spinner, StatusDot,
  StatusPicker, TypePicker,
} from './ui.jsx';

function AutoTextarea({ value, onSave, placeholder, className = '' }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }
  }, [draft]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
    />
  );
}

function Prop({ icon, label, children }) {
  return (
    <div className="prop">
      <span className="prop-label"><Icon name={icon} size={14} />{label}</span>
      <span className="prop-value">{children}</span>
    </div>
  );
}

/** Select for a phase / milestone / release with a shortcut to open it. */
function PlanSelect({ value, options, onChange, placeholder, onOpen }) {
  return (
    <span className="plan-select">
      <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {value && <button type="button" className="icon-btn tiny" onClick={onOpen} title="Open"><Icon name="arrowRight" size={12} /></button>}
    </span>
  );
}

/** Same rule the server uses for the timeline when no manual progress is set. */
function autoProgress(t) {
  if (t.status === 'done') return 100;
  if (t.subtasks?.length) return pct(t.subtasks.filter((s) => s.status === 'done').length, t.subtasks.length);
  if (t.checklist?.length) return pct(t.checklist.filter((c) => c.done).length, t.checklist.length);
  return 0;
}

function InlineText({ value, onSave, placeholder, list }) {
  return (
    <input
      className="inline-text"
      list={list}
      defaultValue={value || ''}
      key={value || ''}
      placeholder={placeholder}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (value || '')) onSave(v || null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

function BugDetails({ task, patch, releases }) {
  return (
    <section className="task-section bug-details">
      <div className="section-title"><h4><Icon name="bug" size={15} /> Bug details</h4></div>
      <div className="props">
        <Prop icon="alert" label="Severity">
          <select className={`sev-select ${task.severity || ''}`} value={task.severity || ''} onChange={(e) => patch({ severity: e.target.value || null })}>
            <option value="">Not set</option>
            {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Prop>
        <Prop icon="settings" label="Environment"><InlineText value={task.environment} onSave={(v) => patch({ environment: v })} placeholder="e.g. Production · Chrome 128 / Windows 11" /></Prop>
        <Prop icon="package" label="Affected version">
          <InlineText value={task.affected_version} onSave={(v) => patch({ affected_version: v })} placeholder="e.g. v1.9.3" list={`versions-${task.id}`} />
          <datalist id={`versions-${task.id}`}>{releases.map((r) => <option key={r.id} value={r.name} />)}</datalist>
        </Prop>
      </div>
      <div className="bug-field">
        <span className="field-label">Steps to reproduce</span>
        <AutoTextarea className="description" value={task.steps_to_reproduce} placeholder={'1. Go to…\n2. Click…\n3. See the error'} onSave={(v) => patch({ steps_to_reproduce: v })} />
      </div>
      <div className="bug-results">
        <div className="bug-field">
          <span className="field-label">Expected result</span>
          <AutoTextarea className="description" value={task.expected_result} placeholder="What should happen" onSave={(v) => patch({ expected_result: v })} />
        </div>
        <div className="bug-field">
          <span className="field-label">Actual result</span>
          <AutoTextarea className="description" value={task.actual_result} placeholder="What happens instead" onSave={(v) => patch({ actual_result: v })} />
        </div>
      </div>
    </section>
  );
}

function Subtasks({ task, reload }) {
  const { openTask, toast, bumpTasks } = useData();
  const [title, setTitle] = useState('');
  const act = async (fn) => {
    try { await fn(); await reload(); bumpTasks(); } catch (e) { toast(e.message, 'error'); }
  };
  const add = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    act(() => api('/tasks', { method: 'POST', body: { parent_id: task.id, title, assignee_ids: task.assignees.map((a) => a.id) } }));
    setTitle('');
  };
  const update = (id, fields) => act(() => api(`/tasks/${id}`, { method: 'PATCH', body: fields }));
  const done = task.subtasks.filter((s) => s.status === 'done').length;

  return (
    <section className="task-section">
      <div className="section-title">
        <h4><Icon name="subtask" size={15} /> Subtasks</h4>
        {task.subtasks.length > 0 && <span className="muted small">{done}/{task.subtasks.length}</span>}
      </div>
      {task.subtasks.length > 0 && <ProgressBar value={pct(done, task.subtasks.length)} color="var(--green)" height={4} />}
      <div className="subtask-list">
        {task.subtasks.map((s) => (
          <div key={s.id} className={`subtask-row${s.status === 'done' ? ' is-done' : ''}`}>
            <StatusDot status={s.status} onChange={(status) => update(s.id, { status })} />
            <button type="button" className="subtask-title" onClick={() => openTask(s.id)}>{s.title}</button>
            <AssigneePicker value={s.assignees.map((a) => a.id)} onChange={(ids) => update(s.id, { assignee_ids: ids })} size={20} max={2} />
            <DueDate task={s} onChange={(v) => update(s.id, { due_date: v })} />
            <PriorityPicker value={s.priority} onChange={(p) => update(s.id, { priority: p })} />
          </div>
        ))}
      </div>
      <form onSubmit={add} className="inline-add">
        <Icon name="plus" size={14} className="muted" />
        <input placeholder="Add a subtask and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} />
      </form>
    </section>
  );
}

function Checklist({ task, reload }) {
  const { toast, bumpTasks } = useData();
  const [text, setText] = useState('');
  const act = async (fn) => {
    try { await fn(); await reload(); bumpTasks(); } catch (e) { toast(e.message, 'error'); }
  };
  const done = task.checklist.filter((c) => c.done).length;
  return (
    <section className="task-section">
      <div className="section-title">
        <h4><Icon name="checklist" size={15} /> Checklist</h4>
        {task.checklist.length > 0 && <span className="muted small">{done}/{task.checklist.length}</span>}
      </div>
      {task.checklist.length > 0 && <ProgressBar value={pct(done, task.checklist.length)} color="var(--green)" height={4} />}
      <div className="checklist">
        {task.checklist.map((c) => (
          <label key={c.id} className={`check-item${c.done ? ' is-done' : ''}`}>
            <input type="checkbox" checked={c.done} onChange={() => act(() => api(`/tasks/checklist/${c.id}`, { method: 'PATCH', body: { done: !c.done } }))} />
            <span className="grow">{c.text}</span>
            <button type="button" className="icon-btn tiny hover-show" onClick={(e) => { e.preventDefault(); act(() => api(`/tasks/checklist/${c.id}`, { method: 'DELETE' })); }} aria-label="Delete item">
              <Icon name="x" size={12} />
            </button>
          </label>
        ))}
      </div>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          act(() => api(`/tasks/${task.id}/checklist`, { method: 'POST', body: { text } }));
          setText('');
        }}
      >
        <Icon name="plus" size={14} className="muted" />
        <input placeholder="Add checklist item" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </section>
  );
}

function TimeTracking({ task, reload }) {
  const { toast, me, isManager } = useData();
  const [form, setForm] = useState({ hours: '', note: '', date: todayStr() });
  const [open, setOpen] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/tasks/${task.id}/time`, { method: 'POST', body: { ...form, hours: Number(form.hours) } });
      setForm({ hours: '', note: '', date: todayStr() });
      setOpen(false);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (id) => {
    try { await api(`/tasks/time/${id}`, { method: 'DELETE' }); reload(); } catch (err) { toast(err.message, 'error'); }
  };
  const est = task.estimate_hours;
  return (
    <section className="task-section">
      <div className="section-title">
        <h4><Icon name="clock" size={15} /> Time tracked</h4>
        <span className="muted small">{fmtHours(task.logged_hours)}{est ? ` of ${fmtHours(est)} estimated` : ''}</span>
        <button type="button" className="btn small ghost" onClick={() => setOpen((o) => !o)}><Icon name="plus" size={13} /> Log time</button>
      </div>
      {est ? <ProgressBar value={pct(task.logged_hours, est)} color={task.logged_hours > est ? 'var(--red)' : 'var(--accent)'} height={4} /> : null}
      {open && (
        <form className="time-form" onSubmit={submit}>
          <input type="number" min="0.05" max="24" step="0.25" placeholder="Hours" required value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input className="grow" placeholder="What did you work on?" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button type="submit" className="btn primary small">Save</button>
        </form>
      )}
      {task.time_entries.length > 0 && (
        <div className="time-list">
          {task.time_entries.map((t) => (
            <div key={t.id} className="time-row">
              <Avatar user={{ name: t.user_name || 'Unknown', color: t.user_color }} size={20} />
              <b>{fmtHours(t.hours)}</b>
              <span className="grow ellipsis muted">{t.note || '—'}</span>
              <span className="muted small">{fmtDate(t.date)}</span>
              {(t.user_id === me.id || isManager) && (
                <button type="button" className="icon-btn tiny hover-show" onClick={() => remove(t.id)} aria-label="Delete entry"><Icon name="x" size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Feed({ task, reload }) {
  const { me, toast, users } = useData();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const items = useMemo(() => [
    ...task.comments.map((c) => ({ ...c, kind: 'comment' })),
    ...task.activity.map((a) => ({ ...a, kind: 'activity' })),
  ].sort((a, b) => parseStamp(a.created_at) - parseStamp(b.created_at) || (a.kind === 'activity' ? -1 : 1)), [task]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [items.length]);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await api(`/tasks/${task.id}/comments`, { method: 'POST', body: { body } });
      setBody('');
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
    }
  };
  const remove = async (id) => {
    try { await api(`/tasks/comments/${id}`, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const mentionHint = body.match(/@(\w*)$/);
  const mentionMatches = mentionHint ? users.filter((u) => u.active && u.name.toLowerCase().startsWith(mentionHint[1].toLowerCase())).slice(0, 5) : [];

  return (
    <aside className="task-feed">
      <div className="feed-head"><h4>Activity</h4><span className="muted small">{task.comments.length} comments</span></div>
      <div className="feed-scroll">
        {items.map((it) => (it.kind === 'comment' ? (
          <div key={`c${it.id}`} className="comment">
            <Avatar user={{ name: it.user_name || 'Deleted user', color: it.user_color }} size={26} />
            <div className="comment-body">
              <div className="comment-meta">
                <b>{it.user_name || 'Deleted user'}</b>
                <span className="muted small" title={parseStamp(it.created_at).toLocaleString()}>{timeAgo(it.created_at)}</span>
                {(it.user_id === me.id || me.role === 'admin') && (
                  <button type="button" className="icon-btn tiny hover-show" onClick={() => remove(it.id)} aria-label="Delete comment"><Icon name="trash" size={12} /></button>
                )}
              </div>
              <div className="comment-text">{it.body}</div>
            </div>
          </div>
        ) : (
          <div key={`a${it.id}`} className="activity-line">
            <span className="activity-dot" />
            <span><b>{it.user_name || it.actor_name || 'Someone'}</b> {it.action}</span>
            <span className="muted small nowrap" title={parseStamp(it.created_at).toLocaleString()}>{timeAgo(it.created_at)}</span>
          </div>
        )))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        {mentionMatches.length > 0 && (
          <div className="mention-list">
            {mentionMatches.map((u) => (
              <button type="button" key={u.id} onMouseDown={(e) => { e.preventDefault(); setBody(body.replace(/@(\w*)$/, `@${u.name} `)); }}>
                <Avatar user={u} size={18} /> {u.name}
              </button>
            ))}
          </div>
        )}
        <textarea
          rows={2}
          placeholder="Write a comment… use @name to mention (Ctrl+Enter to send)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
        />
        <button type="button" className="btn primary small" disabled={!body.trim() || sending} onClick={send}>Comment</button>
      </div>
    </aside>
  );
}

export default function TaskModal() {
  const { openTaskId: id, closeTask, openTask, bumpTasks, toast, projects, spaces, me, isManager } = useData();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(
    () => api(`/tasks/${id}`).then((t) => { setTask(t); setError(''); }).catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => { setTask(null); load(); }, [load]);

  // Phases, milestones, releases and dependencies of the task's project.
  const [plan, setPlan] = useState(null);
  const projectId = task?.project_id;
  const loadPlan = useCallback(() => {
    if (projectId) api(`/projects/${projectId}/plan`).then(setPlan).catch(() => {});
  }, [projectId]);
  useEffect(() => { loadPlan(); }, [loadPlan]);

  const patch = async (fields) => {
    setTask((t) => ({ ...t, ...fields }));
    try {
      const saved = await api(`/tasks/${id}`, { method: 'PATCH', body: fields });
      if (saved.rescheduled?.length) toast(`Moved ${saved.rescheduled.length} dependent item${saved.rescheduled.length === 1 ? '' : 's'} later: ${saved.rescheduled.join(', ')}`, 'info');
      await load();
      bumpTasks();
    } catch (e) {
      toast(e.message, 'error');
      load();
    }
  };
  const remove = async () => {
    await api(`/tasks/${id}`, { method: 'DELETE' });
    toast('Task deleted', 'success');
    bumpTasks();
    if (task.parent_id) openTask(task.parent_id); else closeTask();
  };

  if (!task) {
    return (
      <Modal onClose={closeTask} width={1100} className="task-modal">
        <div className="task-loading">{error ? <p className="form-error">{error}</p> : <Spinner />}</div>
      </Modal>
    );
  }

  const status = statusOf(task.status);
  const software = task.project_type === 'software';
  const options = (key, nameKey, list) => list || (task[key] ? [{ id: task[key], name: task[nameKey] }] : []);
  const openPlanItem = (ref) => { closeTask(); navigate(`/projects/${task.project_id}?tab=planning&item=${ref}`); };
  const autoPct = autoProgress(task);
  const canDelete = isManager || task.created_by === me.id;
  const due = dueState(task);

  return (
    <Modal onClose={closeTask} width={1160} className="task-modal">
      <div className="task-top" style={{ '--c': status.color }}>
        <div className="crumbs">
          <button type="button" className="crumb" onClick={() => { closeTask(); navigate(`/spaces/${task.space_id}`); }}>
            <span className="space-icon tiny" style={{ background: task.space_color }}>{task.space_name[0]}</span>{task.space_name}
          </button>
          <Icon name="chevronRight" size={12} className="muted" />
          {task.parent_id ? (
            <button type="button" className="crumb" onClick={() => { closeTask(); navigate(`/projects/${task.project_id}`); }}>
              <span className="dot" style={{ background: task.project_color }} />{task.project_name}
            </button>
          ) : (
            <Popover
              width={260}
              trigger={<span className="crumb" title="Move to another project"><span className="dot" style={{ background: task.project_color }} />{task.project_name}<Icon name="chevronDown" size={12} /></span>}
            >
              {(close) => (
                <div className="pop-scroll">
                  {spaces.map((s) => (
                    <div key={s.id}>
                      <div className="pop-group">{s.name}</div>
                      {projects.filter((p) => p.space_id === s.id && p.status !== 'archived').map((p) => (
                        <MenuItem key={p.id} color={p.color} active={p.id === task.project_id} onClick={() => { close(); if (p.id !== task.project_id) patch({ project_id: p.id }); }}>{p.name}</MenuItem>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Popover>
          )}
          {task.parent_id && (
            <>
              <Icon name="chevronRight" size={12} className="muted" />
              <button type="button" className="crumb" onClick={() => openTask(task.parent_id)}>{task.parent_title}</button>
            </>
          )}
        </div>
        <span className="row-gap hide-sm">
          <RefChip refKey={task.ref} onClick={() => navigator.clipboard?.writeText(task.ref).then(() => toast(`Copied ${task.ref}`, 'success'))} title="Copy reference" />
          <span className="muted small">created {timeAgo(task.created_at)}</span>
        </span>
        {canDelete && (
          <ConfirmButton className="icon-btn danger-hover" onConfirm={remove} confirmText="Delete?">
            <Icon name="trash" size={16} />
          </ConfirmButton>
        )}
        <button type="button" className="icon-btn" onClick={closeTask} aria-label="Close"><Icon name="x" /></button>
      </div>

      <div className="task-layout">
        <div className="task-main">
          <div className="task-title-row">
            <StatusDot status={task.status} onChange={(s) => patch({ status: s })} />
            <AutoTextarea className="task-title" value={task.title} onSave={(v) => v.trim() && patch({ title: v.replace(/\n/g, ' ') })} />
            <button type="button" className={`icon-btn key-toggle${task.is_key ? ' on' : ''}`} onClick={() => patch({ is_key: !task.is_key })}
              title={task.is_key ? 'Key task — shown on the timeline. Click to unmark.' : 'Mark as a key task to show it on the project timeline'}>
              <Icon name="star" size={18} fill={task.is_key ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="props">
            <Prop icon="circleCheck" label="Status"><StatusPicker value={task.status} onChange={(s) => patch({ status: s })} /></Prop>
            <Prop icon="users" label="Assignees">
              <AssigneePicker value={task.assignees.map((a) => a.id)} onChange={(ids) => patch({ assignee_ids: ids })} max={6} placeholder="Assign" />
            </Prop>
            <Prop icon="flag" label="Priority"><PriorityPicker value={task.priority} onChange={(p) => patch({ priority: p })} showLabel /></Prop>
            <Prop icon="calendar" label="Dates">
              <span className="date-range">
                <DueDate value={task.start_date} field="start" onChange={(v) => patch({ start_date: v })} placeholder="Start" />
                <Icon name="chevronRight" size={12} className="muted" />
                <DueDate task={task} onChange={(v) => patch({ due_date: v })} placeholder="Due" />
                {(task.start_date || task.due_date) && (
                  <button type="button" className="icon-btn tiny" title="Clear dates" onClick={() => patch({ start_date: null, due_date: null })}><Icon name="x" size={12} /></button>
                )}
                {due === 'overdue' && <span className="pill red">Overdue</span>}
              </span>
            </Prop>
            <Prop icon="clock" label="Estimate">
              <input
                className="inline-number"
                type="number"
                min="0"
                step="0.5"
                placeholder="—"
                defaultValue={task.estimate_hours ?? ''}
                key={`est-${task.estimate_hours}`}
                onBlur={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  if (v !== task.estimate_hours) patch({ estimate_hours: v });
                }}
              /> <span className="muted small">hours</span>
            </Prop>
            <Prop icon="tag" label="Tags"><TagInput value={task.tags} onChange={(tags) => patch({ tags })} /></Prop>
            {(software || task.type !== 'task') && (
              <Prop icon="layers" label="Type"><TypePicker value={task.type} onChange={(type) => patch({ type })} /></Prop>
            )}
            <Prop icon="trend" label="Progress">
              <input
                className="inline-number"
                type="number"
                min="0"
                max="100"
                step="5"
                placeholder={`${autoPct}`}
                defaultValue={task.progress ?? ''}
                key={`pr-${task.progress}`}
                disabled={task.status === 'done'}
                title="Leave empty to calculate from subtasks or the checklist"
                onBlur={(e) => {
                  const v = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value))));
                  if (v !== task.progress) patch({ progress: v });
                }}
              /> <span className="muted small">% {task.status === 'done' ? '(done)' : task.progress === null ? '(automatic)' : ''}</span>
            </Prop>
            <Prop icon="layers" label="Phase">
              <PlanSelect value={task.phase_id} options={options('phase_id', 'phase_name', plan?.phases)} placeholder="No phase"
                onChange={(v) => patch({ phase_id: v })} onOpen={() => openPlanItem(`PH-${task.phase_id}`)} />
            </Prop>
            <Prop icon="diamond" label="Milestone">
              <PlanSelect value={task.milestone_id} options={options('milestone_id', 'milestone_name', plan?.milestones)} placeholder="No milestone"
                onChange={(v) => patch({ milestone_id: v })} onOpen={() => openPlanItem(`MS-${task.milestone_id}`)} />
            </Prop>
            {software && (
              <Prop icon="package" label="Release">
                <PlanSelect value={task.release_id} options={options('release_id', 'release_name', plan?.releases)} placeholder="No release"
                  onChange={(v) => patch({ release_id: v })} onOpen={() => openPlanItem(`REL-${task.release_id}`)} />
              </Prop>
            )}
          </div>

          <section className="task-section">
            <div className="section-title"><h4>Description</h4></div>
            <AutoTextarea className="description" value={task.description} placeholder="Add details, acceptance criteria, links…" onSave={(v) => patch({ description: v })} />
          </section>

          {task.type === 'bug' && <BugDetails task={task} patch={patch} releases={plan?.releases || []} />}
          {!task.parent_id && <Subtasks task={task} reload={load} />}
          <Checklist task={task} reload={load} />
          <Attachments task={task} reload={load} />
          {(software || task.git.length > 0) && <GitLinks task={task} reload={load} />}
          {plan && !task.parent_id && (
            <section className="task-section">
              <div className="section-title"><h4><Icon name="link" size={15} /> Dependencies</h4></div>
              <DependencyEditor plan={plan} refKey={task.ref} canEdit onChange={() => { load(); loadPlan(); bumpTasks(); }} />
            </section>
          )}
          <TimeTracking task={task} reload={load} />
        </div>
        <Feed task={task} reload={load} />
      </div>
    </Modal>
  );
}

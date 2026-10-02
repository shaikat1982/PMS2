'use client';

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { PRIORITIES, SEVERITIES, STATUSES, TASK_TYPES } from '../utils.js';
import { AssigneePicker, Field, Modal, TypeIcon } from './ui.jsx';
import TagInput from './TagInput.jsx';

export default function CreateTaskModal() {
  const { createDefaults: d, closeCreate, spaces, projects, toast, bumpTasks, openTask } = useData();
  const usable = projects.filter((p) => p.status !== 'archived');
  const [form, setForm] = useState({
    title: '',
    description: '',
    project_id: d.project_id || (d.space_id ? usable.find((p) => p.space_id === d.space_id)?.id : null) || usable[0]?.id || '',
    status: d.status || 'todo',
    priority: d.priority || 'normal',
    assignee_ids: d.assignee_ids || [],
    start_date: d.start_date || '',
    due_date: d.due_date || '',
    estimate_hours: '',
    tags: [],
    type: d.type || 'task',
    phase_id: d.phase_id || '',
    milestone_id: d.milestone_id || '',
    release_id: d.release_id || '',
    severity: '',
    environment: '',
    affected_version: '',
    steps_to_reproduce: '',
    expected_result: '',
    actual_result: '',
  });
  const [plan, setPlan] = useState(null);
  const project = projects.find((p) => p.id === Number(form.project_id));
  const software = project?.type === 'software';
  useEffect(() => {
    setPlan(null);
    if (form.project_id) api(`/projects/${form.project_id}/plan`).then(setPlan).catch(() => {});
  }, [form.project_id]);
  const [saving, setSaving] = useState(false);
  const [openAfter, setOpenAfter] = useState(false);
  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: e?.target ? e.target.value : e,
    // Phases, milestones and releases belong to one project.
    ...(k === 'project_id' ? { phase_id: '', milestone_id: '', release_id: '' } : {}),
  }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const task = await api('/tasks', {
        method: 'POST',
        body: {
          ...form,
          project_id: Number(form.project_id),
          parent_id: d.parent_id || undefined,
          estimate_hours: form.estimate_hours === '' ? null : Number(form.estimate_hours),
          type: software || form.type !== 'task' ? form.type : 'task',
          phase_id: form.phase_id || null,
          milestone_id: form.milestone_id || null,
          release_id: software ? form.release_id || null : null,
        },
      });
      bumpTasks();
      toast('Task created', 'success');
      closeCreate();
      if (openAfter) openTask(task.id);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!usable.length) {
    return (
      <Modal title="New task" onClose={closeCreate}>
        <p>Create a project first — tasks live inside projects. Use <b>Add project</b> under a space in the sidebar.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={d.parent_id ? 'New subtask' : form.type === 'bug' ? 'Report a bug' : `New ${TASK_TYPES.find((t) => t.key === form.type).label.toLowerCase()}`}
      onClose={closeCreate}
      width={640}
      footer={
        <>
          <label className="checkbox-row grow">
            <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} /> Open task after creating
          </label>
          <button type="button" className="btn" onClick={closeCreate}>Cancel</button>
          <button type="submit" form="create-task" className="btn primary" disabled={saving || !form.title.trim()}>{saving ? 'Creating…' : 'Create task'}</button>
        </>
      }
    >
      <form id="create-task" className="form" onSubmit={submit}>
        {software && (
          <div className="segmented type-switch">
            {TASK_TYPES.map((t) => (
              <button type="button" key={t.key} className={form.type === t.key ? 'active' : ''} onClick={() => set('type')(t.key)}>
                <TypeIcon type={t.key} showLabel />
              </button>
            ))}
          </div>
        )}
        <input autoFocus className="title-input" placeholder={form.type === 'bug' ? 'Short summary of the bug' : form.type === 'story' ? 'As a …, I want … so that …' : 'Task name'} value={form.title} onChange={set('title')} />
        <textarea rows={3} placeholder="Add a description…" value={form.description} onChange={set('description')} />
        <div className="form-row">
          {!d.parent_id && (
            <Field label="Project">
              <select value={form.project_id} onChange={set('project_id')} required>
                {spaces.map((s) => (
                  <optgroup key={s.id} label={s.name}>
                    {usable.filter((p) => p.space_id === s.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
          )}
          <Field label="Assignees">
            <div className="input-like"><AssigneePicker value={form.assignee_ids} onChange={set('assignee_ids')} max={5} placeholder="Assign" /></div>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Status">
            <select value={form.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Estimate (hours)">
            <input type="number" min="0" step="0.5" value={form.estimate_hours} onChange={set('estimate_hours')} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Start date"><input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
          <Field label="Due date"><input type="date" value={form.due_date} onChange={set('due_date')} /></Field>
        </div>
        {plan && (plan.phases.length > 0 || plan.milestones.length > 0 || (software && plan.releases.length > 0)) && (
          <div className="form-row">
            {plan.phases.length > 0 && (
              <Field label="Phase">
                <select value={form.phase_id} onChange={set('phase_id')}>
                  <option value="">No phase</option>
                  {plan.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            )}
            {plan.milestones.length > 0 && (
              <Field label="Milestone">
                <select value={form.milestone_id} onChange={set('milestone_id')}>
                  <option value="">No milestone</option>
                  {plan.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
            )}
            {software && plan.releases.length > 0 && (
              <Field label="Release">
                <select value={form.release_id} onChange={set('release_id')}>
                  <option value="">No release</option>
                  {plan.releases.filter((r) => r.status !== 'released' && r.status !== 'cancelled').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
        {form.type === 'bug' && (
          <>
            <h4 className="form-section">Bug details</h4>
            <div className="form-row">
              <Field label="Severity">
                <select value={form.severity} onChange={set('severity')}>
                  <option value="">Not set</option>
                  {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Environment"><input value={form.environment} onChange={set('environment')} placeholder="e.g. Production · Safari 17" /></Field>
              <Field label="Affected version">
                <input value={form.affected_version} onChange={set('affected_version')} list="create-versions" placeholder="e.g. v1.9.3" />
                <datalist id="create-versions">{(plan?.releases || []).map((r) => <option key={r.id} value={r.name} />)}</datalist>
              </Field>
            </div>
            <Field label="Steps to reproduce"><textarea rows={3} value={form.steps_to_reproduce} onChange={set('steps_to_reproduce')} placeholder={'1. Go to…\n2. Click…\n3. See the error'} /></Field>
            <div className="form-row">
              <Field label="Expected result"><textarea rows={2} value={form.expected_result} onChange={set('expected_result')} /></Field>
              <Field label="Actual result"><textarea rows={2} value={form.actual_result} onChange={set('actual_result')} /></Field>
            </div>
          </>
        )}
        <Field label="Tags"><TagInput value={form.tags} onChange={set('tags')} /></Field>
      </form>
    </Modal>
  );
}

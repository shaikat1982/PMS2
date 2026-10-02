'use client';

import { useState } from 'react';
import { useNavigate } from '../router.js';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { PROJECT_STATUSES, PROJECT_TYPES, ROLES } from '../utils.js';
import { Avatar, ColorPicker, ConfirmButton, Field, Modal } from './ui.jsx';

function useSubmit(fn) {
  const { toast } = useData();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, submit };
}

function Footer({ onClose, saving, label = 'Save', left }) {
  return (
    <>
      <span className="grow">{left}</span>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="entity-form" className="btn primary" disabled={saving}>{saving ? 'Saving…' : label}</button>
    </>
  );
}

export function SpaceModal({ space, onClose, canDelete }) {
  const { refresh, toast } = useData();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: space?.name || '', description: space?.description || '', color: space?.color || '#7b68ee' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const { saving, error, submit } = useSubmit(async () => {
    const saved = await api(space ? `/spaces/${space.id}` : '/spaces', { method: space ? 'PATCH' : 'POST', body: form });
    await refresh();
    toast(space ? 'Space updated' : 'Space created', 'success');
    onClose();
    if (!space) navigate(`/spaces/${saved.id}`);
  });
  const remove = async () => {
    await api(`/spaces/${space.id}`, { method: 'DELETE' });
    await refresh();
    toast('Space deleted', 'success');
    onClose();
    navigate('/');
  };

  return (
    <Modal
      title={space ? 'Edit space' : 'New space'}
      onClose={onClose}
      footer={<Footer onClose={onClose} saving={saving} label={space ? 'Save' : 'Create space'}
        left={space && canDelete && <ConfirmButton className="btn danger ghost" onConfirm={remove} confirmText="Delete everything in it?">Delete space</ConfirmButton>} />}
    >
      <form id="entity-form" onSubmit={submit} className="form">
        <Field label="Name"><input autoFocus required value={form.name} onChange={set('name')} placeholder="e.g. Software Development" /></Field>
        <Field label="Description"><textarea rows={3} value={form.description} onChange={set('description')} /></Field>
        <Field label="Color"><ColorPicker value={form.color} onChange={set('color')} /></Field>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

export function ProjectModal({ project, defaults = {}, onClose }) {
  const { refresh, toast, spaces, activeUsers, me, bumpTasks } = useData();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: project?.name || '',
    description: project?.description || '',
    color: project?.color || spaces.find((s) => s.id === defaults.space_id)?.color || '#7b68ee',
    space_id: project?.space_id || defaults.space_id || spaces[0]?.id || '',
    owner_id: project?.owner_id ?? me.id,
    status: project?.status || 'active',
    start_date: project?.start_date || '',
    due_date: project?.due_date || '',
    type: project?.type || defaults.type || 'general',
    progress_method: project?.progress_method || 'tasks',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const { saving, error, submit } = useSubmit(async () => {
    const body = { ...form, space_id: Number(form.space_id), owner_id: form.owner_id ? Number(form.owner_id) : null };
    const saved = await api(project ? `/projects/${project.id}` : '/projects', { method: project ? 'PATCH' : 'POST', body });
    await refresh();
    toast(project ? 'Project updated' : 'Project created', 'success');
    onClose();
    if (!project) navigate(`/projects/${saved.id}`);
  });
  const remove = async () => {
    await api(`/projects/${project.id}`, { method: 'DELETE' });
    await refresh();
    bumpTasks();
    toast('Project deleted', 'success');
    onClose();
    navigate(`/spaces/${project.space_id}`);
  };

  return (
    <Modal
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      width={580}
      footer={<Footer onClose={onClose} saving={saving} label={project ? 'Save' : 'Create project'}
        left={project && <ConfirmButton className="btn danger ghost" onConfirm={remove} confirmText="Delete all its tasks?">Delete project</ConfirmButton>} />}
    >
      <form id="entity-form" onSubmit={submit} className="form">
        <Field label="Project name"><input autoFocus required value={form.name} onChange={set('name')} placeholder="e.g. Website redesign" /></Field>
        <Field label="Project type">
          <div className="type-cards">
            {PROJECT_TYPES.map((t) => (
              <button type="button" key={t.key} className={`type-card${form.type === t.key ? ' on' : ''}`} onClick={() => set('type')(t.key)}>
                <b>{t.label}</b>
                <span className="muted small">{t.hint}</span>
              </button>
            ))}
          </div>
          {form.type === 'software' && project?.type !== 'software' && (
            <span className="field-hint">Starts with the phases Planning → Development → Testing → Deployment → Maintenance{form.start_date && form.due_date ? ', spread between the start and due dates' : ''}.</span>
          )}
        </Field>
        <div className="form-row">
          <Field label="Space">
            <select value={form.space_id} onChange={set('space_id')}>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Owner">
            <select value={form.owner_id || ''} onChange={set('owner_id')}>
              <option value="">No owner</option>
              {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Start date"><input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
          <Field label="Due date"><input type="date" value={form.due_date} onChange={set('due_date')} /></Field>
          <Field label="Status">
            <select value={form.status} onChange={set('status')}>
              {PROJECT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Overall progress is calculated from">
          <select value={form.progress_method} onChange={set('progress_method')}>
            <option value="tasks">Completed tasks</option>
            <option value="milestones">Milestones, weighted by each milestone's weight</option>
          </select>
        </Field>
        <Field label="Description"><textarea rows={3} value={form.description} onChange={set('description')} placeholder="Goals, scope, links…" /></Field>
        <Field label="Color"><ColorPicker value={form.color} onChange={set('color')} /></Field>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

export function ProfileModal({ onClose }) {
  const { me, setMe, refresh, toast } = useData();
  const [form, setForm] = useState({ name: me.name, title: me.title || '', color: me.color, current_password: '', password: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const { saving, error, submit } = useSubmit(async () => {
    const body = { name: form.name, title: form.title, color: form.color };
    if (form.password) Object.assign(body, { password: form.password, current_password: form.current_password });
    const saved = await api('/auth/me', { method: 'PATCH', body });
    setMe(saved);
    await refresh();
    toast('Profile saved', 'success');
    onClose();
  });
  return (
    <Modal title="Your profile" onClose={onClose} footer={<Footer onClose={onClose} saving={saving} />}>
      <form id="entity-form" onSubmit={submit} className="form">
        <div className="profile-head">
          <Avatar user={{ ...me, name: form.name || me.name, color: form.color }} size={48} />
          <div><b>{me.email}</b><div className="muted small">Role: {me.role}</div></div>
        </div>
        <div className="form-row">
          <Field label="Name"><input required value={form.name} onChange={set('name')} /></Field>
          <Field label="Job title"><input value={form.title} onChange={set('title')} /></Field>
        </div>
        <Field label="Avatar color"><ColorPicker value={form.color} onChange={set('color')} /></Field>
        <h4 className="form-section">Change password</h4>
        <div className="form-row">
          <Field label="Current password"><input type="password" autoComplete="current-password" value={form.current_password} onChange={set('current_password')} /></Field>
          <Field label="New password"><input type="password" autoComplete="new-password" minLength={6} value={form.password} onChange={set('password')} /></Field>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

export function UserModal({ user, onClose }) {
  const { refresh, toast, teams } = useData();
  const [form, setForm] = useState({
    name: user?.name || '', email: user?.email || '', title: user?.title || '', role: user?.role || 'member',
    color: user?.color || '#7b68ee', password: '', team_ids: user?.team_ids || [], active: user ? user.active : true,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const toggleTeam = (id) => setForm((f) => ({ ...f, team_ids: f.team_ids.includes(id) ? f.team_ids.filter((t) => t !== id) : [...f.team_ids, id] }));
  const { saving, error, submit } = useSubmit(async () => {
    const body = { ...form };
    if (user && !body.password) delete body.password;
    await api(user ? `/users/${user.id}` : '/users', { method: user ? 'PATCH' : 'POST', body });
    await refresh();
    toast(user ? 'Member updated' : 'Member added', 'success');
    onClose();
  });
  return (
    <Modal title={user ? `Edit ${user.name}` : 'Add team member'} onClose={onClose} width={580} footer={<Footer onClose={onClose} saving={saving} label={user ? 'Save' : 'Add member'} />}>
      <form id="entity-form" onSubmit={submit} className="form">
        <div className="form-row">
          <Field label="Full name"><input autoFocus required value={form.name} onChange={set('name')} /></Field>
          <Field label="Job title"><input value={form.title} onChange={set('title')} placeholder="e.g. SEO Specialist" /></Field>
        </div>
        <div className="form-row">
          <Field label="Email"><input type="email" required value={form.email} onChange={set('email')} /></Field>
          <Field label={user ? 'Reset password' : 'Password'} hint={user ? 'Leave blank to keep current password' : 'At least 6 characters'}>
            <input type="text" autoComplete="new-password" required={!user} minLength={6} value={form.password} onChange={set('password')} />
          </Field>
        </div>
        <Field label="Role">
          <div className="segmented wide">
            {ROLES.map((r) => (
              <button type="button" key={r.key} className={form.role === r.key ? 'active' : ''} onClick={() => set('role')(r.key)} title={r.hint}>{r.label}</button>
            ))}
          </div>
          <span className="field-hint">{ROLES.find((r) => r.key === form.role)?.hint}</span>
        </Field>
        {teams.length > 0 && (
          <Field label="Teams">
            <div className="chip-select">
              {teams.map((t) => (
                <button type="button" key={t.id} className={`chip${form.team_ids.includes(t.id) ? ' on' : ''}`} style={{ '--c': t.color }} onClick={() => toggleTeam(t.id)}>{t.name}</button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Avatar color"><ColorPicker value={form.color} onChange={set('color')} /></Field>
        {user && (
          <label className="checkbox-row">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active')(e.target.checked)} />
            Account active <span className="muted small">(inactive members cannot sign in)</span>
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

export function TeamModal({ team, onClose }) {
  const { refresh, toast, activeUsers } = useData();
  const [form, setForm] = useState({ name: team?.name || '', description: team?.description || '', color: team?.color || '#7b68ee', member_ids: team?.member_ids || [] });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const toggle = (id) => setForm((f) => ({ ...f, member_ids: f.member_ids.includes(id) ? f.member_ids.filter((m) => m !== id) : [...f.member_ids, id] }));
  const { saving, error, submit } = useSubmit(async () => {
    await api(team ? `/teams/${team.id}` : '/teams', { method: team ? 'PATCH' : 'POST', body: form });
    await refresh();
    toast(team ? 'Team updated' : 'Team created', 'success');
    onClose();
  });
  const remove = async () => {
    await api(`/teams/${team.id}`, { method: 'DELETE' });
    await refresh();
    toast('Team deleted', 'success');
    onClose();
  };
  return (
    <Modal title={team ? 'Edit team' : 'New team'} onClose={onClose} width={560}
      footer={<Footer onClose={onClose} saving={saving} label={team ? 'Save' : 'Create team'}
        left={team && <ConfirmButton className="btn danger ghost" onConfirm={remove}>Delete team</ConfirmButton>} />}>
      <form id="entity-form" onSubmit={submit} className="form">
        <Field label="Team name"><input autoFocus required value={form.name} onChange={set('name')} placeholder="e.g. SEO Team" /></Field>
        <Field label="Description"><input value={form.description} onChange={set('description')} /></Field>
        <Field label="Color"><ColorPicker value={form.color} onChange={set('color')} /></Field>
        <Field label={`Members (${form.member_ids.length})`}>
          <div className="member-select">
            {activeUsers.map((u) => (
              <button type="button" key={u.id} className={`member-option${form.member_ids.includes(u.id) ? ' on' : ''}`} onClick={() => toggle(u.id)}>
                <Avatar user={u} size={24} />
                <span className="grow">{u.name}<small className="muted block">{u.title}</small></span>
                <input type="checkbox" readOnly checked={form.member_ids.includes(u.id)} tabIndex={-1} />
              </button>
            ))}
          </div>
        </Field>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

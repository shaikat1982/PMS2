'use client';

import { useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Tag } from '../components/TagInput.jsx';
import { AssigneePicker, DueDate, PriorityPicker, StatusDot, StatusPicker, TypeIcon } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { DUE_BUCKETS, PRIORITIES, PRIORITY_RANK, STATUSES, dueBucket } from '../utils.js';

export function groupTasks(tasks, groupBy, users) {
  switch (groupBy) {
    case 'priority':
      return PRIORITIES.map((p) => ({ ...p, field: 'priority', tasks: tasks.filter((t) => t.priority === p.key) }));
    case 'due':
      return DUE_BUCKETS.map((b) => ({ ...b, tasks: tasks.filter((t) => dueBucket(t) === b.key) }));
    case 'project': {
      const map = new Map();
      for (const t of tasks) {
        if (!map.has(t.project_id)) map.set(t.project_id, { key: t.project_id, label: `${t.project_name}`, sub: t.space_name, color: t.project_color, tasks: [] });
        map.get(t.project_id).tasks.push(t);
      }
      return [...map.values()];
    }
    case 'assignee': {
      const groups = users.filter((u) => tasks.some((t) => t.assignees.some((a) => a.id === u.id)))
        .map((u) => ({ key: u.id, label: u.name, color: u.color, tasks: tasks.filter((t) => t.assignees.some((a) => a.id === u.id)) }));
      const none = tasks.filter((t) => !t.assignees.length);
      if (none.length) groups.push({ key: 'none', label: 'Unassigned', color: '#94a3b8', tasks: none });
      return groups;
    }
    default:
      return STATUSES.map((s) => ({ ...s, field: 'status', tasks: tasks.filter((t) => t.status === s.key) }));
  }
}

export function sortTasks(tasks, sort) {
  const list = [...tasks];
  if (sort === 'due') list.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  else if (sort === 'priority') list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  else if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

export function TaskMeta({ task }) {
  return (
    <span className="task-meta">
      {task.subtask_count > 0 && (
        <span className="meta" title="Subtasks"><Icon name="subtask" size={12} />{task.subtask_done}/{task.subtask_count}</span>
      )}
      {task.checklist_total > 0 && (
        <span className={`meta${task.checklist_done === task.checklist_total ? ' ok' : ''}`} title="Checklist"><Icon name="checklist" size={12} />{task.checklist_done}/{task.checklist_total}</span>
      )}
      {task.comment_count > 0 && <span className="meta" title="Comments"><Icon name="message" size={12} />{task.comment_count}</span>}
      {task.attachment_count > 0 && <span className="meta" title="Attachments"><Icon name="paperclip" size={12} />{task.attachment_count}</span>}
      {task.git_count > 0 && <span className="meta" title="Linked branches, commits and pull requests"><Icon name="gitBranch" size={12} />{task.git_count}</span>}
    </span>
  );
}

function QuickAdd({ group, defaults, groupBy }) {
  const { toast, bumpTasks, openCreate } = useData();
  const [title, setTitle] = useState('');
  const [active, setActive] = useState(false);
  const extra = group.field ? { [group.field]: group.key } : groupBy === 'assignee' && group.key !== 'none' ? { assignee_ids: [group.key] } : {};

  if (!defaults.project_id) {
    return (
      <button type="button" className="add-row" onClick={() => openCreate({ ...defaults, ...extra })}>
        <Icon name="plus" size={14} /> Add task
      </button>
    );
  }
  if (!active) {
    return <button type="button" className="add-row" onClick={() => setActive(true)}><Icon name="plus" size={14} /> Add task</button>;
  }
  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setActive(false); return; }
    try {
      await api('/tasks', { method: 'POST', body: { ...defaults, ...extra, title } });
      setTitle('');
      bumpTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <form className="add-row editing" onSubmit={submit}>
      <Icon name="plus" size={14} className="muted" />
      <input autoFocus placeholder="Task name, press Enter to save" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => !title && setActive(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setTitle(''); setActive(false); } }} />
    </form>
  );
}

export default function ListView({ tasks, updateTask, groupBy = 'status', sort = 'manual', showProject, defaults = {} }) {
  const { openTask, users } = useData();
  const [collapsed, setCollapsed] = useState({ done: groupBy === 'due' });
  const groups = groupTasks(tasks, groupBy, users);
  const showStatus = groupBy !== 'status';

  return (
    <div className="list-view">
      {groups.map((g) => {
        if (!g.tasks.length && (groupBy === 'due' || groupBy === 'project' || groupBy === 'assignee')) return null;
        const isCollapsed = collapsed[g.key];
        return (
          <section key={g.key} className="list-group">
            <header className="group-header" style={{ '--c': g.color }}>
              <button type="button" className="icon-btn tiny" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))} aria-label="Toggle group">
                <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} />
              </button>
              <span className="group-pill">{g.label}</span>
              {g.sub && <span className="muted small">{g.sub}</span>}
              <span className="muted small">{g.tasks.length}</span>
            </header>
            {!isCollapsed && (
              <div className="table-wrap">
                <table className="task-table">
                  <thead>
                    <tr>
                      <th className="col-name">Name</th>
                      {showProject && <th className="col-project">Project</th>}
                      {showStatus && <th className="col-status">Status</th>}
                      <th className="col-assignee">Assignee</th>
                      <th className="col-due">Due date</th>
                      <th className="col-priority">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortTasks(g.tasks, sort).map((t) => (
                      <tr key={t.id} className={t.status === 'done' ? 'is-done' : ''} onClick={() => openTask(t.id)}>
                        <td className="col-name">
                          <div className="name-cell">
                            <StatusDot status={t.status} onChange={(s) => updateTask(t.id, { status: s })} />
                            {t.type !== 'task' && <TypeIcon type={t.type} size={13} />}
                            <span className="task-name">
                              {t.parent_title && <span className="parent-ref" title="Subtask of">{t.parent_title} ›</span>}
                              {t.title}
                            </span>
                            <TaskMeta task={t} />
                            {t.tags.map((tag) => <Tag key={tag} tag={tag} />)}
                          </div>
                        </td>
                        {showProject && (
                          <td className="col-project"><span className="project-chip"><span className="dot" style={{ background: t.project_color }} />{t.project_name}</span></td>
                        )}
                        {showStatus && <td className="col-status"><StatusPicker small value={t.status} onChange={(s) => updateTask(t.id, { status: s })} /></td>}
                        <td className="col-assignee">
                          <AssigneePicker value={t.assignees.map((a) => a.id)} onChange={(ids) => updateTask(t.id, { assignee_ids: ids })} size={24} />
                        </td>
                        <td className="col-due"><DueDate task={t} onChange={(v) => updateTask(t.id, { due_date: v })} /></td>
                        <td className="col-priority"><PriorityPicker value={t.priority} onChange={(p) => updateTask(t.id, { priority: p })} showLabel /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(groupBy === 'status' || groupBy === 'priority' || groupBy === 'assignee') && <QuickAdd group={g} defaults={defaults} groupBy={groupBy} />}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

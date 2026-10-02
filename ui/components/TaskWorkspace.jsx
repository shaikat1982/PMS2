'use client';

import { useMemo, useState } from 'react';
import { useData, useTasks } from '../store.jsx';
import { PRIORITIES, TASK_TYPES } from '../utils.js';
import BoardView from '../views/BoardView.jsx';
import CalendarView from '../views/CalendarView.jsx';
import ListView from '../views/ListView.jsx';
import Icon from './Icon.jsx';
import { Spinner } from './ui.jsx';

const VIEWS = [
  { key: 'list', label: 'List', icon: 'list' },
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
];

export function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  };
  return [value, set];
}

/**
 * Task toolbar + List/Board/Calendar views over one server query.
 * Filtering beyond the query happens client-side so toggling filters is instant.
 */
export default function TaskWorkspace({
  query, defaults = {}, showProject = false, spaceFilter = false, storageKey = 'default',
  defaultView = 'list', defaultGroup = 'status', initialAssignee = '', hideAssigneeFilter = false, defaultSubtasks = false,
}) {
  const { me, activeUsers, spaces, openCreate } = useData();
  const { tasks, loading, updateTask } = useTasks({ ...query, include_subtasks: query.include_subtasks ?? 1 });
  const [view, setView] = usePersisted(`view:${storageKey}`, defaultView);
  const [groupBy, setGroupBy] = usePersisted(`group:${storageKey}`, defaultGroup);
  const [sort, setSort] = usePersisted(`sort:${storageKey}`, 'manual');
  const [showDone, setShowDone] = usePersisted(`done:${storageKey}`, true);
  const [showSubtasks, setShowSubtasks] = usePersisted(`subs:${storageKey}`, defaultSubtasks);
  const [q, setQ] = useState('');
  const [assignee, setAssignee] = useState(initialAssignee);
  const [priority, setPriority] = useState('');
  const [space, setSpace] = useState('');
  const [type, setType] = useState('');
  const hasTypes = tasks.some((t) => t.type !== 'task');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!showSubtasks && t.parent_id && view !== 'calendar') return false;
      if (!showDone && t.status === 'done') return false;
      if (priority && t.priority !== priority) return false;
      if (type && t.type !== type) return false;
      if (space && t.space_id !== Number(space)) return false;
      if (assignee === 'me' && !t.assignees.some((a) => a.id === me.id)) return false;
      if (assignee === 'none' && t.assignees.length) return false;
      if (assignee && assignee !== 'me' && assignee !== 'none' && !t.assignees.some((a) => a.id === Number(assignee))) return false;
      if (needle && !t.title.toLowerCase().includes(needle) && !t.tags.some((tag) => tag.includes(needle))) return false;
      return true;
    });
  }, [tasks, q, assignee, priority, type, space, showDone, showSubtasks, view, me.id]);

  const active = [q, assignee !== initialAssignee && assignee, priority, type, space].filter(Boolean).length;
  const createDefaults = { ...defaults, ...(assignee && !['me', 'none'].includes(assignee) ? { assignee_ids: [Number(assignee)] } : {}), ...(assignee === 'me' ? { assignee_ids: [me.id] } : {}) };

  return (
    <div className="workspace">
      <div className="toolbar">
        <div className="view-tabs">
          {VIEWS.map((v) => (
            <button type="button" key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>
              <Icon name={v.icon} size={14} /> {v.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <div className="filter-search">
          <Icon name="search" size={14} className="muted" />
          <input placeholder="Filter tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {spaceFilter && (
          <select className="filter-select" value={space} onChange={(e) => setSpace(e.target.value)}>
            <option value="">All spaces</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {!hideAssigneeFilter && (
          <select className="filter-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Everyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select className="filter-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {(hasTypes || type) && (
          <select className="filter-select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Any type</option>
            {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        )}
        {view !== 'calendar' && (
          <>
            <select className="filter-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} title="Group by">
              <option value="status">Group: Status</option>
              <option value="priority">Group: Priority</option>
              {view === 'list' && <option value="due">Group: Due date</option>}
              {view === 'list' && <option value="assignee">Group: Assignee</option>}
              {view === 'list' && showProject && <option value="project">Group: Project</option>}
            </select>
            <select className="filter-select" value={sort} onChange={(e) => setSort(e.target.value)} title="Sort">
              <option value="manual">Sort: Default</option>
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="title">Sort: Name</option>
            </select>
          </>
        )}
        <label className="toggle" title="Show completed tasks">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Done
        </label>
        {view !== 'calendar' && (
          <label className="toggle" title="Show subtasks as separate rows">
            <input type="checkbox" checked={showSubtasks} onChange={(e) => setShowSubtasks(e.target.checked)} /> Subtasks
          </label>
        )}
        {active > 0 && (
          <button type="button" className="link-btn" onClick={() => { setQ(''); setAssignee(initialAssignee); setPriority(''); setType(''); setSpace(''); }}>Clear filters</button>
        )}
        <button type="button" className="btn primary small" onClick={() => openCreate(createDefaults)}><Icon name="plus" size={14} /> Task</button>
      </div>

      {loading ? <div className="center-pad"><Spinner /></div> : (
        <>
          {view === 'list' && (
            <ListView
              key={groupBy}
              tasks={filtered}
              updateTask={updateTask}
              groupBy={groupBy === 'project' && !showProject ? 'status' : groupBy}
              sort={sort}
              showProject={showProject}
              defaults={createDefaults}
            />
          )}
          {view === 'board' && (
            <BoardView tasks={filtered} updateTask={updateTask} groupBy={groupBy} sort={sort} showProject={showProject} defaults={createDefaults} />
          )}
          {view === 'calendar' && <CalendarView tasks={filtered} updateTask={updateTask} defaults={createDefaults} />}
          {!filtered.length && view !== 'calendar' && (
            <p className="muted center-pad">{tasks.length ? 'No tasks match these filters.' : 'No tasks yet — add the first one.'}</p>
          )}
        </>
      )}
    </div>
  );
}

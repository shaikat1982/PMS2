'use client';

import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Tag } from '../components/TagInput.jsx';
import { AvatarStack, DueDate, PriorityFlag, TypeIcon } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { PRIORITIES, STATUSES } from '../utils.js';
import { TaskMeta, sortTasks } from './ListView.jsx';

export default function BoardView({ tasks, updateTask, groupBy = 'status', sort = 'manual', showProject, defaults = {} }) {
  const { openTask, openCreate } = useData();
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const field = groupBy === 'priority' ? 'priority' : 'status';
  const columns = field === 'priority' ? PRIORITIES : STATUSES;

  const drop = (key) => {
    const task = tasks.find((t) => t.id === dragId);
    if (task && task[field] !== key) updateTask(task.id, { [field]: key });
    setDragId(null);
    setOver(null);
  };

  return (
    <div className="board">
      {columns.map((col) => {
        const colTasks = sortTasks(tasks.filter((t) => t[field] === col.key), sort);
        return (
          <div
            key={col.key}
            className={`board-col${over === col.key ? ' drop-over' : ''}`}
            style={{ '--c': col.color }}
            onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); drop(col.key); }}
          >
            <div className="board-col-head">
              <span className="group-pill">{col.label}</span>
              <span className="muted small">{colTasks.length}</span>
              <button type="button" className="icon-btn tiny" title="Add task" onClick={() => openCreate({ ...defaults, [field]: col.key })}><Icon name="plus" size={14} /></button>
            </div>
            <div className="board-cards">
              {colTasks.map((t) => (
                <article
                  key={t.id}
                  className={`card${dragId === t.id ? ' dragging' : ''}${t.status === 'done' ? ' is-done' : ''}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); setDragId(t.id); }}
                  onDragEnd={() => { setDragId(null); setOver(null); }}
                  onClick={() => openTask(t.id)}
                >
                  {showProject && (
                    <div className="card-project"><span className="dot" style={{ background: t.project_color }} />{t.project_name}</div>
                  )}
                  {t.parent_title && <div className="parent-ref">{t.parent_title} ›</div>}
                  <div className="card-title">{t.type !== 'task' && <TypeIcon type={t.type} size={13} />} {t.title}</div>
                  {t.tags.length > 0 && <div className="card-tags">{t.tags.map((tag) => <Tag key={tag} tag={tag} />)}</div>}
                  <div className="card-foot">
                    <AvatarStack users={t.assignees} size={22} />
                    {t.due_date && <DueDate task={t} onChange={(v) => updateTask(t.id, { due_date: v })} />}
                    <span className="grow" />
                    <TaskMeta task={t} />
                    <PriorityFlag priority={t.priority} />
                  </div>
                </article>
              ))}
              <button type="button" className="add-card" onClick={() => openCreate({ ...defaults, [field]: col.key })}>
                <Icon name="plus" size={14} /> New task
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

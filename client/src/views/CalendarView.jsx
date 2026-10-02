import { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useData } from '../store.jsx';
import { PRIORITY_RANK, dueState, priorityOf, statusOf, toDateStr, todayStr } from '../utils.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Chip({ task, onDragStart, onDragEnd }) {
  const { openTask } = useData();
  const s = statusOf(task.status);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(task.id)); onDragStart(task.id); }}
      onDragEnd={onDragEnd}
      className={`cal-chip ${dueState(task)}${task.status === 'done' ? ' is-done' : ''}`}
      style={{ '--c': priorityOf(task.priority).color, '--s': s.color }}
      title={`${task.title}\n${task.project_name} · ${s.label}${task.assignees.length ? ` · ${task.assignees.map((a) => a.name).join(', ')}` : ''}`}
      onClick={(e) => { e.stopPropagation(); openTask(task.id); }}
    >
      <span className="cal-status" />
      <span className="ellipsis">{task.title}</span>
    </button>
  );
}

export default function CalendarView({ tasks, updateTask, defaults = {} }) {
  const { openCreate, openTask } = useData();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [mode, setMode] = useState('month');
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d; });
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const today = todayStr();

  const days = useMemo(() => {
    if (mode === 'week') {
      return Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const total = Math.ceil((end.getDate() + cursor.getDay()) / 7) * 7;
    return Array.from({ length: total }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor, mode, weekStart]);

  const byDate = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      if (!t.due_date) continue;
      (map[t.due_date] ||= []).push(t);
    }
    for (const list of Object.values(map)) list.sort((a, b) => (a.status === 'done') - (b.status === 'done') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    return map;
  }, [tasks]);

  const unscheduled = tasks.filter((t) => !t.due_date && t.status !== 'done');

  const drop = (date) => {
    const task = tasks.find((t) => t.id === dragId);
    if (task && task.due_date !== date) updateTask(task.id, { due_date: date });
    setDragId(null);
    setOver(null);
  };

  const shift = (n) => {
    if (mode === 'week') setWeekStart((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + n * 7));
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  };
  const goToday = () => {
    const d = new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    const w = new Date(d); w.setDate(d.getDate() - d.getDay()); setWeekStart(w);
  };
  const heading = mode === 'week'
    ? `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="calendar-wrap">
      <div className="calendar">
        <div className="cal-toolbar">
          <button type="button" className="btn small" onClick={goToday}>Today</button>
          <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous"><Icon name="chevronLeft" /></button>
          <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Next"><Icon name="chevronRight" /></button>
          <h3>{heading}</h3>
          <span className="grow" />
          <div className="segmented">
            <button type="button" className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>Month</button>
            <button type="button" className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>Week</button>
          </div>
        </div>
        <div className="cal-scroll">
          <div className={`cal-grid ${mode}`}>
            {WEEKDAYS.map((d) => <div key={d} className="cal-weekday">{d}</div>)}
            {days.map((d) => {
              const key = toDateStr(d);
              const list = byDate[key] || [];
              const outside = mode === 'month' && d.getMonth() !== cursor.getMonth();
              return (
                <div
                  key={key}
                  className={`cal-day${outside ? ' outside' : ''}${key === today ? ' today' : ''}${over === key ? ' drop-over' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' weekend' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(key); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
                  onDrop={(e) => { e.preventDefault(); drop(key); }}
                  onDoubleClick={() => openCreate({ ...defaults, due_date: key })}
                >
                  <div className="cal-date">
                    <span className="num">{d.getDate()}</span>
                    {mode === 'week' && <span className="muted small">{d.toLocaleDateString(undefined, { month: 'short' })}</span>}
                    <button type="button" className="icon-btn tiny cal-add" title="Add task on this day" onClick={() => openCreate({ ...defaults, due_date: key })}><Icon name="plus" size={12} /></button>
                  </div>
                  <div className="cal-tasks">
                    {list.map((t) => <Chip key={t.id} task={t} onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOver(null); }} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="muted small cal-hint">Drag tasks between days to reschedule · double-click a day to add a task</p>
      </div>

      <aside className="unscheduled">
        <h4>Unscheduled <span className="muted small">{unscheduled.length}</span></h4>
        <p className="muted small">Drag onto a date to schedule.</p>
        <div className="unscheduled-list">
          {unscheduled.map((t) => (
            <button
              type="button"
              key={t.id}
              draggable
              className="unscheduled-item"
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(t.id)); setDragId(t.id); }}
              onDragEnd={() => { setDragId(null); setOver(null); }}
              onClick={() => openTask(t.id)}
            >
              <span className="dot" style={{ background: priorityOf(t.priority).color }} />
              <span className="grow ellipsis">{t.title}</span>
            </button>
          ))}
          {!unscheduled.length && <p className="muted small">Everything has a date.</p>}
        </div>
      </aside>
    </div>
  );
}

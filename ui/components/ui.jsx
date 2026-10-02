'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { useData } from '../store.jsx';
import {
  COLORS, PRIORITIES, STATUSES, TASK_TYPES, dueState, fmtDate, initials, priorityOf, stateOf, statusOf, typeOf,
} from '../utils.js';

export function Avatar({ user, size = 24, ring = false }) {
  if (!user) return null;
  return (
    <span
      className={`avatar${ring ? ' ring' : ''}`}
      title={user.name}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4), background: user.color || '#7b68ee' }}
    >
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 3, size = 24 }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((u) => <Avatar key={u.id} user={u} size={size} ring />)}
      {extra > 0 && <span className="avatar ring more" style={{ width: size, height: size, fontSize: size * 0.4 }}>+{extra}</span>}
    </span>
  );
}

/**
 * Trigger + floating panel rendered in a portal so it is never clipped by scroll containers.
 * children may be a function receiving close().
 */
export function Popover({ trigger, children, width = 220, align = 'left', className = '', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState({ visibility: 'hidden' });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    let left = align === 'right' ? r.right - panel.width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - panel.width - 8));
    let top = r.bottom + 4;
    if (top + panel.height > window.innerHeight - 8 && r.top - panel.height - 4 > 8) top = r.top - panel.height - 4;
    setStyle({ left, top, width });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return undefined;
    const inside = (e) => panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target);
    const onDown = (e) => { if (!inside(e)) setOpen(false); };
    const onScroll = (e) => { if (!panelRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`pop-trigger ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setStyle({ visibility: 'hidden', width });
          setOpen((o) => !o);
        }}
      >
        {typeof trigger === 'function' ? trigger(open) : trigger}
      </span>
      {open && createPortal(
        <div ref={panelRef} className="popover" style={style} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  );
}

export function MenuItem({ icon, children, onClick, danger, active, color }) {
  return (
    <button type="button" className={`menu-item${danger ? ' danger' : ''}${active ? ' active' : ''}`} onClick={onClick}>
      {color && <span className="dot" style={{ background: color }} />}
      {icon && <Icon name={icon} size={14} />}
      <span className="grow">{children}</span>
      {active && <Icon name="check" size={13} className="muted" />}
    </button>
  );
}

export function StatusBadge({ status, small }) {
  const s = statusOf(status);
  return (
    <span className={`status-badge${small ? ' small' : ''}`} style={{ '--c': s.color }}>
      {s.label}
    </span>
  );
}

export function StatusPicker({ value, onChange, small, disabled }) {
  return (
    <Popover disabled={disabled} width={180} trigger={<StatusBadge status={value} small={small} />}>
      {(close) => STATUSES.map((s) => (
        <MenuItem key={s.key} color={s.color} active={s.key === value} onClick={() => { close(); if (s.key !== value) onChange(s.key); }}>
          {s.label}
        </MenuItem>
      ))}
    </Popover>
  );
}

export function StatusDot({ status, onChange }) {
  const s = statusOf(status);
  const done = status === 'done';
  const dot = (
    <span className={`status-dot${done ? ' done' : ''}`} style={{ '--c': s.color }} title={s.label}>
      {done && <Icon name="check" size={9} strokeWidth={4} />}
    </span>
  );
  if (!onChange) return dot;
  return (
    <Popover width={180} trigger={dot}>
      {(close) => STATUSES.map((st) => (
        <MenuItem key={st.key} color={st.color} active={st.key === status} onClick={() => { close(); if (st.key !== status) onChange(st.key); }}>
          {st.label}
        </MenuItem>
      ))}
    </Popover>
  );
}

export function PriorityFlag({ priority, showLabel = false }) {
  const p = priorityOf(priority);
  return (
    <span className="priority-flag" style={{ color: p.color }} title={`${p.label} priority`}>
      <Icon name="flag" size={13} fill={priority === 'urgent' || priority === 'high' ? 'currentColor' : 'none'} />
      {showLabel && <span className="label">{p.label}</span>}
    </span>
  );
}

export function PriorityPicker({ value, onChange, showLabel }) {
  return (
    <Popover width={160} trigger={<span className="cell-btn"><PriorityFlag priority={value} showLabel={showLabel} /></span>}>
      {(close) => PRIORITIES.map((p) => (
        <MenuItem key={p.key} active={p.key === value} onClick={() => { close(); if (p.key !== value) onChange(p.key); }}>
          <span style={{ color: p.color, display: 'inline-flex', marginRight: 6 }}><Icon name="flag" size={13} fill="currentColor" /></span>
          {p.label}
        </MenuItem>
      ))}
    </Popover>
  );
}

export function AssigneePicker({ value = [], onChange, size = 24, max = 3, placeholder }) {
  const { activeUsers, users } = useData();
  const [query, setQuery] = useState('');
  const selected = value.map((id) => users.find((u) => u.id === id)).filter(Boolean);
  const list = activeUsers.filter((u) => u.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover
      width={240}
      trigger={
        <span className="cell-btn assignee-trigger">
          {selected.length ? <AvatarStack users={selected} size={size} max={max} /> : (
            <span className="empty-assignee" title="Assign">
              <Icon name="userPlus" size={14} />
              {placeholder && <span>{placeholder}</span>}
            </span>
          )}
        </span>
      }
    >
      <div className="pop-search">
        <input autoFocus placeholder="Search people…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="pop-scroll">
        {list.map((u) => (
          <button type="button" key={u.id} className={`menu-item${value.includes(u.id) ? ' active' : ''}`} onClick={() => toggle(u.id)}>
            <Avatar user={u} size={22} />
            <span className="grow">{u.name}<small className="muted block">{u.title}</small></span>
            {value.includes(u.id) && <Icon name="check" size={13} />}
          </button>
        ))}
        {!list.length && <div className="pop-empty">No matches</div>}
      </div>
      {value.length > 0 && (
        <div className="pop-footer">
          <button type="button" className="link-btn" onClick={() => onChange([])}>Clear all</button>
        </div>
      )}
    </Popover>
  );
}

/** Date shown as text; clicking opens the native date picker. */
export function DueDate({ task, value, onChange, placeholder = '', field = 'due' }) {
  const inputRef = useRef(null);
  const date = value !== undefined ? value : task?.due_date;
  const state = field === 'due' && task ? dueState({ ...task, due_date: date }) : '';
  const open = (e) => {
    e.stopPropagation();
    const el = inputRef.current;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  return (
    <span className={`date-cell ${state}`} onClick={open}>
      {date ? fmtDate(date) : <span className="placeholder"><Icon name="calendar" size={13} />{placeholder}</span>}
      <input
        ref={inputRef}
        type="date"
        className="hidden-date"
        value={date || ''}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value || null)}
        tabIndex={-1}
      />
    </span>
  );
}

export function Modal({ title, onClose, children, width = 520, footer, className = '' }) {
  const backdropRef = useRef(null);
  useEffect(() => {
    // With stacked modals (a file preview over a task) only the top one closes.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const all = document.querySelectorAll('.modal-backdrop');
      if (all[all.length - 1] === backdropRef.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div ref={backdropRef} className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-header">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmButton({ onConfirm, children, className = 'btn danger', confirmText = 'Click again to confirm' }) {
  const { toast } = useData();
  const [armed, setArmed] = useState(false);
  const fire = () => Promise.resolve().then(onConfirm).catch((err) => toast(err.message, 'error'));
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={className} onClick={(e) => { e.stopPropagation(); if (armed) { setArmed(false); fire(); } else setArmed(true); }}>
      {armed ? confirmText : children}
    </button>
  );
}

export function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker">
      {COLORS.map((c) => (
        <button type="button" key={c} className={`swatch${c === value ? ' selected' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}

export function ProgressBar({ value, color = 'var(--accent)', height = 6 }) {
  return (
    <div className="progress" style={{ height }}>
      <div style={{ width: `${Math.min(100, value)}%`, background: color }} />
    </div>
  );
}

export function EmptyState({ icon = 'check', title, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />;
}

export function Toasts() {
  const { toasts } = useData();
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
    </div>,
    document.body,
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// ---- Software development module ----

export function TypeIcon({ type, size = 14, showLabel = false }) {
  const t = typeOf(type);
  return (
    <span className="type-icon" style={{ '--c': t.color }} title={t.label}>
      <Icon name={t.icon} size={size} />
      {showLabel && <span className="label">{t.label}</span>}
    </span>
  );
}

export function TypePicker({ value, onChange }) {
  return (
    <Popover width={170} trigger={<span className="cell-btn"><TypeIcon type={value} showLabel /></span>}>
      {(close) => TASK_TYPES.map((t) => (
        <MenuItem key={t.key} active={t.key === value} onClick={() => { close(); if (t.key !== value) onChange(t.key); }}>
          <TypeIcon type={t.key} showLabel />
        </MenuItem>
      ))}
    </Popover>
  );
}

/** Completed / In progress / Delayed / Not started — the same everywhere. */
export function StateBadge({ state, small }) {
  const s = stateOf(state);
  return <span className={`state-badge${small ? ' small' : ''}`} style={{ '--c': s.color }}>{s.label}</span>;
}

export function RefChip({ refKey, onClick, title }) {
  if (!onClick) return <span className="ref-chip" title={title}>{refKey}</span>;
  return <button type="button" className="ref-chip link" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}>{refKey}</button>;
}

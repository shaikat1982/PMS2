'use client';

import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from '../router.js';
import Icon from './Icon.jsx';
import { Avatar, MenuItem, Popover, StatusDot } from './ui.jsx';
import { ProfileModal, ProjectModal, SpaceModal } from './EntityModals.jsx';
import { useData } from '../store.jsx';
import { api, qs } from '../api.js';

function Sidebar({ open, onClose }) {
  const { me, spaces, projects, unread, isManager, isAdmin, logout } = useData();
  const [collapsed, setCollapsed] = useState({});
  const [spaceModal, setSpaceModal] = useState(null);
  const [projectModal, setProjectModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();

  const nav = [
    { to: '/', icon: 'dashboard', label: 'Dashboard', end: true },
    { to: '/my-tasks', icon: 'checkSquare', label: 'My Tasks' },
    { to: '/inbox', icon: 'inbox', label: 'Inbox', badge: unread },
    { to: '/calendar', icon: 'calendar', label: 'Calendar' },
    { to: '/tasks', icon: 'layers', label: 'All Tasks' },
    { to: '/team', icon: 'users', label: 'Team' },
  ];

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><Icon name="check" size={16} strokeWidth={3.2} /></span>
          <span className="brand-name">Instacall <b>PM</b></span>
        </div>

        <nav className="nav" onClick={onClose}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon name={n.icon} size={16} />
              <span className="grow">{n.label}</span>
              {n.badge > 0 && <span className="badge">{n.badge > 99 ? '99+' : n.badge}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="nav-section">
          <span>Spaces</span>
          {isManager && (
            <button type="button" className="icon-btn tiny" title="New space" onClick={() => setSpaceModal({})}><Icon name="plus" size={14} /></button>
          )}
        </div>

        <div className="spaces">
          {spaces.map((s) => {
            const spaceProjects = projects.filter((p) => p.space_id === s.id && p.status !== 'archived');
            const isCollapsed = collapsed[s.id];
            return (
              <div key={s.id} className="space-group">
                <div className="space-row">
                  <button type="button" className="icon-btn tiny chevron" onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))} aria-label="Toggle">
                    <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={13} />
                  </button>
                  <NavLink to={`/spaces/${s.id}`} className={({ isActive }) => `space-link${isActive ? ' active' : ''}`} onClick={onClose}>
                    <span className="space-icon" style={{ background: s.color }}>{s.name[0]}</span>
                    <span className="grow ellipsis">{s.name}</span>
                  </NavLink>
                  {isManager && (
                    <Popover width={180} align="right" className="row-actions" trigger={<span className="icon-btn tiny"><Icon name="more" size={14} /></span>}>
                      {(close) => (
                        <>
                          <MenuItem icon="plus" onClick={() => { close(); setProjectModal({ space_id: s.id }); }}>New project</MenuItem>
                          <MenuItem icon="edit" onClick={() => { close(); setSpaceModal(s); }}>Edit space</MenuItem>
                        </>
                      )}
                    </Popover>
                  )}
                </div>
                {!isCollapsed && (
                  <div className="project-list">
                    {spaceProjects.map((p) => (
                      <NavLink key={p.id} to={`/projects/${p.id}`} className={({ isActive }) => `project-link${isActive ? ' active' : ''}`} onClick={onClose}>
                        <span className="dot" style={{ background: p.color }} />
                        <span className="grow ellipsis">{p.name}</span>
                        <span className="count">{p.task_count - p.done_count || ''}</span>
                      </NavLink>
                    ))}
                    {isManager && (
                      <button type="button" className="project-link add" onClick={() => setProjectModal({ space_id: s.id })}>
                        <Icon name="plus" size={12} /> <span>Add project</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!spaces.length && <p className="muted small pad">No spaces yet.</p>}
        </div>

        <div className="sidebar-footer">
          <button type="button" className="me-btn" onClick={() => setProfileOpen(true)}>
            <Avatar user={me} size={30} />
            <span className="grow ellipsis">
              <b>{me.name}</b>
              <small className="muted block">{me.role}{me.title ? ` · ${me.title}` : ''}</small>
            </span>
          </button>
          <button type="button" className="icon-btn" title="Sign out" onClick={() => { logout(); navigate('/'); }}><Icon name="logout" size={16} /></button>
        </div>
      </aside>
      {open && <div className="sidebar-scrim" onClick={onClose} />}

      {spaceModal && <SpaceModal space={spaceModal.id ? spaceModal : null} canDelete={isAdmin} onClose={() => setSpaceModal(null)} />}
      {projectModal && <ProjectModal project={projectModal.id ? projectModal : null} defaults={projectModal} onClose={() => setProjectModal(null)} />}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </>
  );
}

function GlobalSearch() {
  const { openTask } = useData();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api(`/tasks${qs({ q: q.trim(), include_subtasks: 1, limit: 12, sort: 'updated' })}`).then(setResults).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="global-search">
      <Icon name="search" size={15} className="muted" />
      <input
        ref={inputRef}
        placeholder="Search tasks…  (Ctrl+K)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }}
      />
      {focused && q.trim().length >= 2 && (
        <div className="search-results">
          {results.map((t) => (
            <button type="button" key={t.id} className="search-result" onMouseDown={(e) => e.preventDefault()} onClick={() => { openTask(t.id); setQ(''); inputRef.current?.blur(); }}>
              <StatusDot status={t.status} />
              <span className="grow ellipsis">{t.title}</span>
              <span className="muted small ellipsis">{t.space_name} / {t.project_name}</span>
            </button>
          ))}
          {!results.length && <div className="pop-empty">No tasks found</div>}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { openCreate } = useData();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="app">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <GlobalSearch />
          <button type="button" className="btn primary" onClick={() => openCreate({})}>
            <Icon name="plus" size={15} /> <span className="hide-sm">New Task</span>
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

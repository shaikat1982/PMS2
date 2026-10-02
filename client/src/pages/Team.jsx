import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { TeamModal, UserModal } from '../components/EntityModals.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, AvatarStack, EmptyState, Spinner } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { fmtHours } from '../utils.js';

function Members() {
  const { users, teams, isAdmin, me } = useData();
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const list = users.filter((u) => (showInactive || u.active) && `${u.name} ${u.email} ${u.title || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="toolbar">
        <div className="filter-search"><Icon name="search" size={14} className="muted" /><input placeholder="Search members…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="toggle"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show deactivated</label>
        <span className="grow" />
        {isAdmin && <button type="button" className="btn primary small" onClick={() => setEditing({})}><Icon name="userPlus" size={14} /> Add member</button>}
      </div>
      <div className="table-wrap card-panel flush">
        <table className="simple-table members">
          <thead><tr><th>Name</th><th>Role</th><th>Teams</th><th>Open tasks</th><th>Status</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>
                  <div className="row-gap">
                    <Avatar user={u} size={32} />
                    <div><b>{u.name}</b>{u.id === me.id && <span className="muted small"> (you)</span>}<div className="muted small">{u.title || '—'} · {u.email}</div></div>
                  </div>
                </td>
                <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                <td>
                  <div className="chip-select">
                    {u.team_ids.map((tid) => teams.find((t) => t.id === tid)).filter(Boolean).map((t) => (
                      <span key={t.id} className="chip on small" style={{ '--c': t.color }}>{t.name}</span>
                    ))}
                  </div>
                </td>
                <td><Link to={`/tasks?assignee=${u.id}`} className="inline-link">{u.open_tasks}</Link></td>
                <td>{u.active ? <span className="pill" style={{ '--c': '#16a34a' }}>Active</span> : <span className="pill" style={{ '--c': '#94a3b8' }}>Deactivated</span>}</td>
                {isAdmin && <td><button type="button" className="icon-btn" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}><Icon name="edit" size={15} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserModal user={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </>
  );
}

function Teams() {
  const { teams, users, isManager } = useData();
  const [editing, setEditing] = useState(null);
  return (
    <>
      <div className="toolbar">
        <span className="muted">Group people by function to see who does what.</span>
        <span className="grow" />
        {isManager && <button type="button" className="btn primary small" onClick={() => setEditing({})}><Icon name="plus" size={14} /> New team</button>}
      </div>
      {teams.length ? (
        <div className="project-grid">
          {teams.map((t) => {
            const members = t.member_ids.map((id) => users.find((u) => u.id === id)).filter(Boolean);
            const open = members.reduce((n, m) => n + m.open_tasks, 0);
            return (
              <div key={t.id} className="project-card team-card" style={{ '--c': t.color }}>
                <div className="row-between">
                  <b>{t.name}</b>
                  {isManager && <button type="button" className="icon-btn tiny" onClick={() => setEditing(t)} aria-label="Edit team"><Icon name="edit" size={13} /></button>}
                </div>
                <p className="muted small">{t.description || 'No description'}</p>
                <div className="row-between">
                  <AvatarStack users={members} max={6} size={28} />
                  <span className="small muted">{members.length} members · {open} open tasks</span>
                </div>
                <div className="team-members">
                  {members.map((m) => (
                    <Link key={m.id} to={`/tasks?assignee=${m.id}`} className="team-member">
                      <Avatar user={m} size={20} /><span className="grow ellipsis">{m.name}</span><span className="muted small">{m.open_tasks}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyState icon="users" title="No teams yet">Create teams like Engineering, SEO, Marketing and Operations.</EmptyState>}
      {editing && <TeamModal team={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </>
  );
}

function Workload() {
  const { spaces, taskVersion, toast } = useData();
  const [spaceId, setSpaceId] = useState('');
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/dashboard${spaceId ? `?space_id=${spaceId}` : ''}`).then((d) => setData(d.workload)).catch((e) => toast(e.message, 'error'));
  }, [spaceId, taskVersion, toast]);
  if (!data) return <div className="center-pad"><Spinner /></div>;
  const max = Math.max(1, ...data.map((u) => u.open));
  return (
    <>
      <div className="toolbar">
        <span className="muted">Open tasks per person. Red is overdue; click someone to see their tasks.</span>
        <span className="grow" />
        <select className="filter-select" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          <option value="">All spaces</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="card-panel flush table-wrap">
        <table className="simple-table">
          <thead><tr><th>Member</th><th style={{ width: '40%' }}>Load</th><th>Open</th><th>Overdue</th><th>High priority</th><th>Estimated</th></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td><Link to={`/tasks?assignee=${u.id}`} className="row-gap"><Avatar user={u} size={28} /><span><b>{u.name}</b><small className="muted block">{u.title}</small></span></Link></td>
                <td>
                  <div className="hbar-track">
                    <div style={{ width: `${((u.open - u.overdue) / max) * 100}%`, background: 'var(--accent)' }} />
                    <div style={{ width: `${(u.overdue / max) * 100}%`, background: 'var(--red)' }} />
                  </div>
                </td>
                <td><b>{u.open}</b></td>
                <td className={u.overdue ? 'text-red' : 'muted'}>{u.overdue}</td>
                <td className={u.high_priority ? 'text-amber' : 'muted'}>{u.high_priority}</td>
                <td className="muted">{fmtHours(u.estimate_hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Team() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'members';
  const tabs = [
    { key: 'members', label: 'Members', icon: 'users' },
    { key: 'teams', label: 'Teams', icon: 'layers' },
    { key: 'workload', label: 'Workload', icon: 'trend' },
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">Manage people, roles, teams and see who has capacity.</p>
        </div>
      </div>
      <div className="view-tabs underline">
        {tabs.map((t) => (
          <button type="button" key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setParams({ tab: t.key })}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'members' && <Members />}
      {tab === 'teams' && <Teams />}
      {tab === 'workload' && <Workload />}
    </div>
  );
}

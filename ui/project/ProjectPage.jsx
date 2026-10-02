'use client';

import { useState } from 'react';
import { Link, useParams, useSearchParams } from '../router.js';
import { ProjectModal } from '../components/EntityModals.jsx';
import Icon from '../components/Icon.jsx';
import TaskWorkspace from '../components/TaskWorkspace.jsx';
import { Avatar, EmptyState, ProgressBar, Spinner } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { PROJECT_STATUSES, fmtDate } from '../utils.js';
import { PlanItemModal, useOpenItem, usePlan } from './common.jsx';
import Development from './Development.jsx';
import Overview from './Overview.jsx';
import Planning from './Planning.jsx';
import Reports from './Reports.jsx';
import Timeline from './Timeline.jsx';

export default function ProjectPage() {
  const { id } = useParams();
  const { projects, isManager, users } = useData();
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const project = projects.find((p) => p.id === Number(id));
  if (!project) return <div className="page"><EmptyState icon="folder" title="Project not found" /></div>;
  return <ProjectView key={project.id} project={project} canEditProject={isManager} users={users}
    editing={editing} setEditing={setEditing} params={params} setParams={setParams} />;
}

function ProjectView({ project, canEditProject, users, editing, setEditing, params, setParams }) {
  const { plan, reload } = usePlan(project.id);
  const openItem = useOpenItem();
  const software = project.type === 'software';
  const st = PROJECT_STATUSES.find((s) => s.key === project.status);
  const owner = users.find((u) => u.id === project.owner_id);

  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'overview' },
    { key: 'tasks', label: 'Tasks', icon: 'list' },
    { key: 'timeline', label: 'Timeline', icon: 'gantt' },
    { key: 'planning', label: 'Planning', icon: 'diamond' },
    ...(software ? [{ key: 'development', label: 'Development', icon: 'code' }] : []),
    { key: 'reports', label: 'Reports', icon: 'chart' },
  ];
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'tasks';
  const item = params.get('item');
  const setTab = (key) => setParams(key === 'tasks' ? {} : { tab: key });
  const closeItem = () => { const n = new URLSearchParams(params); n.delete('item'); setParams(n); };
  const addItem = (type) => { const n = new URLSearchParams(params); n.set('item', `new:${type}`); setParams(n); };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link to={`/spaces/${project.space_id}`} className="crumb"><span className="space-icon tiny" style={{ background: project.space_color }}>{project.space_name[0]}</span>{project.space_name}</Link>
          </div>
          <h1 className="row-gap">
            <span className="dot big" style={{ background: project.color }} />{project.name}
            {software && <span className="type-pill" title="Software Development project"><Icon name="code" size={12} /> Software</span>}
          </h1>
          {project.description && <p className="muted">{project.description}</p>}
        </div>
        <div className="project-facts">
          <span className="pill" style={{ '--c': st.color }}>{st.label}</span>
          <span className="project-progress-bar" title={`${project.progress}% complete`}>
            <ProgressBar value={project.progress} color={project.color} height={6} />
            <b>{project.progress}%</b>
          </span>
          {owner && <span className="row-gap small"><Avatar user={owner} size={20} />{owner.name}</span>}
          {project.due_date && <span className="small muted"><Icon name="calendar" size={13} /> Due {fmtDate(project.due_date)}</span>}
          {canEditProject && <button type="button" className="btn small" onClick={() => setEditing(true)}><Icon name="edit" size={13} /> Edit</button>}
        </div>
      </div>

      <div className="view-tabs underline project-tabs">
        {tabs.map((t) => (
          <button type="button" key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && <TaskWorkspace query={{ project_id: project.id }} defaults={{ project_id: project.id }} storageKey={`project-${project.id}`} />}
      {tab === 'development' && <Development project={project} canManage={plan?.can_manage} />}
      {tab === 'reports' && <Reports project={project} software={software} openItem={openItem} />}
      {['overview', 'timeline', 'planning'].includes(tab) && (!plan ? <div className="center-pad"><Spinner /></div> : (
        <>
          {tab === 'overview' && <Overview plan={plan} openItem={openItem} software={software} onTab={setTab} />}
          {tab === 'timeline' && <Timeline plan={plan} reload={reload} openItem={openItem} onAdd={addItem} software={software} />}
          {tab === 'planning' && <Planning plan={plan} openItem={openItem} onAdd={addItem} software={software} />}
        </>
      ))}

      {item && plan && <PlanItemModal key={item} plan={plan} refKey={item} onClose={closeItem} onSaved={reload} />}
      {editing && <ProjectModal project={project} onClose={() => setEditing(false)} />}
    </div>
  );
}

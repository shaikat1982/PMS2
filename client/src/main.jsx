import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import CreateTaskModal from './components/CreateTaskModal.jsx';
import Layout from './components/Layout.jsx';
import TaskModal from './components/TaskModal.jsx';
import { Spinner, Toasts } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inbox from './pages/Inbox.jsx';
import Login from './pages/Login.jsx';
import Team from './pages/Team.jsx';
import { AllTasks, MyTasks, SpacePage } from './pages/TaskPages.jsx';
import ProjectPage from './project/ProjectPage.jsx';
import { DataProvider, useData } from './store.jsx';
import './styles.css';
import './software.css';

/** Keep ?task=ID in the URL so an open task can be shared as a link. */
function useTaskUrlSync() {
  const { openTaskId, openTask } = useData();
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('task'));
    if (id) openTask(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openTaskId) url.searchParams.set('task', openTaskId);
    else url.searchParams.delete('task');
    window.history.replaceState(window.history.state, '', url);
  }, [openTaskId]);
}

function App() {
  const { me, booting, openTaskId, createDefaults } = useData();
  useTaskUrlSync();

  if (booting) return <div className="boot"><Spinner /></div>;
  if (!me) return <><Login /><Toasts /></>;

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/my-tasks" element={<MyTasks />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/calendar" element={<AllTasks calendar key="calendar" />} />
          <Route path="/tasks" element={<AllTasks key="all" />} />
          <Route path="/team" element={<Team />} />
          <Route path="/spaces/:id" element={<SpacePage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      {openTaskId && <TaskModal key={openTaskId} />}
      {createDefaults && <CreateTaskModal />}
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        <App />
      </DataProvider>
    </BrowserRouter>
  </StrictMode>,
);

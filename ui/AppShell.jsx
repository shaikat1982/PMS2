'use client';

import CreateTaskModal from './components/CreateTaskModal.jsx';
import Layout from './components/Layout.jsx';
import TaskModal from './components/TaskModal.jsx';
import { Spinner, Toasts } from './components/ui.jsx';
import Login from './screens/Login.jsx';
import { DataProvider, useData } from './store.jsx';

function Shell({ children }) {
  const { me, booting, openTaskId, createDefaults } = useData();

  // Sessions are kept in the browser (a token in localStorage), so the server renders a
  // loading state and the app takes over once the browser has checked the session.
  if (booting) return <div className="boot"><Spinner /></div>;
  if (!me) return <><Login /><Toasts /></>;

  return (
    <>
      <Layout>{children}</Layout>
      {openTaskId && <TaskModal key={openTaskId} />}
      {createDefaults && <CreateTaskModal />}
      <Toasts />
    </>
  );
}

export default function AppShell({ children }) {
  return (
    <DataProvider>
      <Shell>{children}</Shell>
    </DataProvider>
  );
}

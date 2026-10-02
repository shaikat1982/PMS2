import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, qs, setToken } from './api.js';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [unread, setUnread] = useState(0);
  const [taskVersion, setTaskVersion] = useState(0);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [createDefaults, setCreateDefaults] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const toast = useCallback((message, type = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const refresh = useCallback(async () => {
    const [u, t, s, p] = await Promise.all([api('/users'), api('/teams'), api('/spaces'), api('/projects')]);
    setUsers(u);
    setTeams(t);
    setSpaces(s);
    setProjects(p);
  }, []);

  const refreshUnread = useCallback(() => {
    api('/notifications/unread').then((r) => setUnread(r.unread)).catch(() => {});
  }, []);

  const bumpTasks = useCallback(() => {
    setTaskVersion((v) => v + 1);
    // Project/space counters depend on tasks too.
    Promise.all([api('/spaces'), api('/projects')]).then(([s, p]) => { setSpaces(s); setProjects(p); }).catch(() => {});
  }, []);

  useEffect(() => {
    const onLogout = () => setMe(null);
    window.addEventListener('instacall:logout', onLogout);
    if (!getToken()) {
      setBooting(false);
    } else {
      api('/auth/me')
        .then(async (user) => { setMe(user); await refresh(); })
        .catch(() => setToken(null))
        .finally(() => setBooting(false));
    }
    return () => window.removeEventListener('instacall:logout', onLogout);
  }, [refresh]);

  useEffect(() => {
    if (!me) return undefined;
    refreshUnread();
    const timer = setInterval(refreshUnread, 30000);
    return () => clearInterval(timer);
  }, [me, refreshUnread]);

  const login = useCallback(async (email, password) => {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(token);
    await refresh();
    setMe(user);
  }, [refresh]);

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
    setOpenTaskId(null);
  }, []);

  const value = useMemo(() => ({
    me, setMe, booting, users, teams, spaces, projects, unread, taskVersion, openTaskId, createDefaults, toasts,
    activeUsers: users.filter((u) => u.active),
    isManager: me && (me.role === 'admin' || me.role === 'manager'),
    isAdmin: me?.role === 'admin',
    userById: (id) => users.find((u) => u.id === id),
    login, logout, refresh, refreshUnread, bumpTasks, toast,
    openTask: (id) => setOpenTaskId(id),
    closeTask: () => setOpenTaskId(null),
    openCreate: (defaults = {}) => setCreateDefaults(defaults),
    closeCreate: () => setCreateDefaults(null),
  }), [me, booting, users, teams, spaces, projects, unread, taskVersion, openTaskId, createDefaults, toasts,
    login, logout, refresh, refreshUnread, bumpTasks, toast]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);

/**
 * Loads tasks for a query and reloads whenever any task changes elsewhere.
 * updateTask applies changes optimistically, then reconciles with the server.
 */
export function useTasks(query) {
  const { taskVersion, toast, users, bumpTasks } = useData();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const key = qs(query);

  const load = useCallback(() => {
    return api(`/tasks${key}`)
      .then(setTasks)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [key, toast]);

  useEffect(() => { load(); }, [load, taskVersion]);

  const updateTask = useCallback(async (id, fields) => {
    setTasks((list) => list.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t, ...fields };
      if (fields.assignee_ids) next.assignees = fields.assignee_ids.map((uid) => users.find((u) => u.id === uid)).filter(Boolean);
      return next;
    }));
    try {
      const saved = await api(`/tasks/${id}`, { method: 'PATCH', body: fields });
      setTasks((list) => list.map((t) => (t.id === id ? saved : t)));
      if (fields.status || fields.project_id) bumpTasks();
    } catch (e) {
      toast(e.message, 'error');
      load();
    }
  }, [users, toast, load, bumpTasks]);

  return { tasks, setTasks, loading, reload: load, updateTask };
}

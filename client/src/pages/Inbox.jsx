import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import NotificationSettings from '../components/NotificationSettings.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, EmptyState, Spinner } from '../components/ui.jsx';
import { useData } from '../store.jsx';
import { timeAgo } from '../utils.js';

export default function Inbox() {
  const { openTask, refreshUnread, toast, taskVersion } = useData();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [settings, setSettings] = useState(false);
  const navigate = useNavigate();

  const load = () => api('/notifications').then(setData).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, [taskVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (n) => {
    if (n.task_id) openTask(n.task_id);
    else if (n.url) navigate(n.url);
    if (!n.read) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
      refreshUnread();
    }
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
    refreshUnread();
  };

  const items = data ? data.items.filter((n) => filter === 'all' || !n.read) : [];

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">Assignments, mentions, comments, updates, due dates and overdue alerts.</p>
        </div>
        <div className="row-gap">
          <div className="segmented">
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
            <button type="button" className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Unread</button>
          </div>
          <button type="button" className="btn small" onClick={readAll} disabled={!data?.items.some((n) => !n.read)}><Icon name="check" size={13} /> Mark all read</button>
          <button type="button" className="btn small" onClick={() => setSettings(true)}><Icon name="settings" size={13} /> Notification settings</button>
        </div>
      </div>
      {!data ? <div className="center-pad"><Spinner /></div> : items.length ? (
        <div className="card-panel flush">
          {items.map((n) => (
            <button type="button" key={n.id} className={`notification${n.read ? '' : ' unread'}`} onClick={() => open(n)}>
              <Avatar user={{ name: n.actor_name || 'System', color: n.actor_color || '#94a3b8' }} size={32} />
              <span className="grow">
                <span>{n.message}</span>
                <small className="muted block">{timeAgo(n.created_at)}</small>
              </span>
              {!n.read && <span className="unread-dot" />}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon="inbox" title={filter === 'unread' ? 'All caught up' : 'No notifications yet'}>
          You will be notified when someone assigns you, comments on or updates your tasks.
        </EmptyState>
      )}
      {settings && <NotificationSettings onClose={() => setSettings(false)} />}
    </div>
  );
}

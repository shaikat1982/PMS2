import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import Icon from './Icon.jsx';
import { Modal, Spinner } from './ui.jsx';

/** Per-event in-app and email preferences for the signed-in user. */
export default function NotificationSettings({ onClose }) {
  const { toast, me, isAdmin } = useData();
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/notifications/preferences').then(setData).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const toggle = (event, channel) => setData((d) => ({
    ...d, prefs: d.prefs.map((p) => (p.event === event ? { ...p, [channel]: !p[channel] } : p)),
  }));
  const setAll = (channel, value) => setData((d) => ({ ...d, prefs: d.prefs.map((p) => ({ ...p, [channel]: value })) }));

  const save = async () => {
    setSaving(true);
    try {
      await api('/notifications/preferences', { method: 'PUT', body: { prefs: data.prefs } });
      toast('Notification settings saved', 'success');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    try {
      const r = await api('/notifications/test-email', { method: 'POST' });
      toast(`Test email queued for ${r.to}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const email = data?.email;
  return (
    <Modal title="Notification settings" onClose={onClose} width={600}
      footer={<><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={!data || saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
      {!data ? <div className="center-pad"><Spinner /></div> : (
        <>
          <div className={`email-status${email.enabled ? ' on' : ''}`}>
            <Icon name="mail" size={16} />
            <span className="grow">
              {email.enabled ? <>Emails go to <b>{me.email}</b>.</> : <>Email delivery isn't set up on this server, so only in-app notifications are sent.</>}
              {isAdmin && !email.enabled && <small className="block muted">Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM and APP_URL on the server, then restart it.</small>}
              {isAdmin && email.enabled && <small className="block muted">From {email.from} · {email.sent} sent · {email.pending} queued{email.failed ? ` · ${email.failed} failed` : ''}</small>}
            </span>
            {email.enabled && <button type="button" className="btn small" onClick={test}>Send test</button>}
          </div>
          <table className="simple-table prefs-table">
            <thead>
              <tr>
                <th>Notify me when…</th>
                <th className="center">In-app <button type="button" className="link-btn small" onClick={() => setAll('in_app', !data.prefs.every((p) => p.in_app))}>all</button></th>
                <th className="center">Email <button type="button" className="link-btn small" onClick={() => setAll('email', !data.prefs.every((p) => p.email))}>all</button></th>
              </tr>
            </thead>
            <tbody>
              {data.prefs.map((p) => (
                <tr key={p.event}>
                  <td>{p.label}</td>
                  <td className="center"><input type="checkbox" checked={p.in_app} onChange={() => toggle(p.event, 'in_app')} aria-label={`${p.label} in-app`} /></td>
                  <td className="center"><input type="checkbox" checked={p.email} onChange={() => toggle(p.event, 'email')} disabled={!email.enabled} aria-label={`${p.label} by email`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Due-date reminders go out the day before a task is due; overdue alerts once per missed deadline.</p>
        </>
      )}
    </Modal>
  );
}

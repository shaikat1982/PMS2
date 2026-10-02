import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useData } from '../store.jsx';

export default function Login() {
  const { login } = useData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand large">
          <span className="brand-mark"><Icon name="check" size={20} strokeWidth={3.2} /></span>
          <span className="brand-name">Instacall <b>PM</b></span>
        </div>
        <h2>One place for every team's work.</h2>
        <ul>
          <li><Icon name="check" size={16} /> Software development sprints &amp; bug tracking</li>
          <li><Icon name="check" size={16} /> SEO audits, content calendars &amp; link building</li>
          <li><Icon name="check" size={16} /> Paid ads, social &amp; email campaigns</li>
          <li><Icon name="check" size={16} /> Hiring, finance &amp; day-to-day operations</li>
        </ul>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted">Use the account your admin created for you.</p>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" autoFocus required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

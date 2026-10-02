'use client';

import { useState } from 'react';
import { api } from '../api.js';
import { PrState, ProviderMark } from '../project/Development.jsx';
import { useData } from '../store.jsx';
import { parseStamp, timeAgo } from '../utils.js';
import Icon from './Icon.jsx';

const GROUPS = [
  { kind: 'pull_request', label: 'Pull requests', icon: 'gitPull' },
  { kind: 'commit', label: 'Commits', icon: 'gitCommit' },
  { kind: 'branch', label: 'Branches', icon: 'gitBranch' },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** Branches, commits and pull requests linked to a task, plus linking by URL. */
export default function GitLinks({ task, reload }) {
  const { toast } = useData();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const branch = `${task.type === 'bug' ? 'fix' : 'feature'}/task-${task.id}-${slug(task.title)}`;
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast('Copied', 'success')).catch(() => {});

  const link = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      await api(`/tasks/${task.id}/git`, { method: 'POST', body: { url: url.trim() } });
      setUrl('');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (id) => {
    try { await api(`/tasks/${task.id}/git/${id}`, { method: 'DELETE' }); reload(); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <section className="task-section">
      <div className="section-title">
        <h4><Icon name="gitBranch" size={15} /> Development</h4>
        {task.git.length > 0 && <span className="muted small">{task.git.length} linked</span>}
      </div>
      {GROUPS.map((g) => {
        const items = task.git.filter((x) => x.kind === g.kind);
        if (!items.length) return null;
        return (
          <div key={g.kind} className="git-group">
            <div className="git-group-label"><Icon name={g.icon} size={12} /> {g.label}</div>
            {items.map((x) => (
              <div key={x.id} className="git-row">
                <ProviderMark provider={x.repository_provider || x.provider} />
                <a href={x.url} target="_blank" rel="noreferrer" className="grow ellipsis git-title">
                  {x.kind === 'commit' && <code>{x.ref.slice(0, 7)}</code>}
                  {x.kind === 'pull_request' && <span className="muted">{x.provider === 'gitlab' ? '!' : '#'}{x.ref} </span>}
                  {x.kind === 'branch' ? <code>{x.ref}</code> : ` ${x.title}`}
                </a>
                {x.kind === 'pull_request' && <PrState state={x.state} provider={x.provider} />}
                <span className="muted small nowrap" title={x.occurred_at ? parseStamp(x.occurred_at).toLocaleString() : ''}>
                  {x.author ? `${x.author} · ` : ''}{x.occurred_at ? timeAgo(x.occurred_at) : ''}
                </span>
                <button type="button" className="icon-btn tiny hover-show" onClick={() => unlink(x.id)} aria-label="Unlink" title="Unlink"><Icon name="x" size={12} /></button>
              </div>
            ))}
          </div>
        );
      })}
      <form className="inline-add" onSubmit={link}>
        <Icon name="link" size={14} className="muted" />
        <input placeholder="Paste a branch, commit or pull request URL to link it" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
      </form>
      <p className="muted small git-hint">
        Or mention <button type="button" className="code-btn" onClick={() => copy(`TASK-${task.id}`)} title="Copy">TASK-{task.id}</button> in a commit message or PR title,
        or name your branch <button type="button" className="code-btn" onClick={() => copy(branch)} title="Copy">{branch}</button>
      </p>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../api.js';
import { useData } from '../store.jsx';
import { fmtSize, parseStamp, timeAgo } from '../utils.js';
import Icon from './Icon.jsx';
import { Avatar, ConfirmButton, Modal, ProgressBar } from './ui.jsx';

const isImage = (a) => a.inline && a.mime.startsWith('image/');
const isText = (a) => a.inline && (a.mime.startsWith('text/') || a.mime === 'application/json');

function fileIcon(a) {
  if (a.mime.startsWith('image/')) return 'image';
  return 'file';
}

function Preview({ att, onClose }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!isText(att)) return;
    fetch(att.url).then((r) => r.text()).then((t) => setText(t.length > 200000 ? `${t.slice(0, 200000)}\n…` : t)).catch(() => setText('Could not load the file.'));
  }, [att]);
  let body;
  if (isImage(att)) body = <img src={att.url} alt={att.filename} className="preview-image" />;
  else if (att.mime === 'application/pdf') body = <iframe src={att.url} title={att.filename} className="preview-frame" />;
  else if (att.mime.startsWith('video/')) body = <video src={att.url} controls className="preview-image" />;
  else if (att.mime.startsWith('audio/')) body = <audio src={att.url} controls />;
  else if (isText(att)) body = <pre className="preview-text">{text ?? 'Loading…'}</pre>;
  return (
    <Modal title={att.filename} onClose={onClose} width={960}
      footer={<><span className="grow muted small">{fmtSize(att.size)} · {att.mime} · uploaded by {att.user_name || 'someone'} {timeAgo(att.created_at)}</span>
        <a className="btn primary" href={`${att.url}&download`}><Icon name="download" size={14} /> Download</a></>}>
      <div className="preview">{body}</div>
    </Modal>
  );
}

/** Upload (button or drag-and-drop), preview, download and delete files on a task. */
export default function Attachments({ task, reload }) {
  const { toast, me, isManager, bumpTasks } = useData();
  const [uploads, setUploads] = useState([]);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);
  const depth = useRef(0);

  const upload = async (files) => {
    const list = [...files];
    if (!list.length) return;
    const batch = list.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, progress: 0 }));
    setUploads((u) => [...u, ...batch]);
    let ok = 0;
    await Promise.all(list.map(async (file, i) => {
      const { id } = batch[i];
      try {
        await uploadFile(`/tasks/${task.id}/attachments`, file, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
        ok += 1;
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'error');
      } finally {
        setUploads((u) => u.filter((x) => x.id !== id));
      }
    }));
    if (ok) {
      toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`, 'success');
      await reload();
      bumpTasks();
    }
  };
  const remove = async (att) => {
    await api(`/attachments/${att.id}`, { method: 'DELETE' });
    await reload();
    bumpTasks();
  };
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  return (
    <section
      className={`task-section attachments${over ? ' drop-over' : ''}`}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setOver(false); upload(e.dataTransfer.files); }}
    >
      <div className="section-title">
        <h4><Icon name="paperclip" size={15} /> Attachments</h4>
        {task.attachments.length > 0 && <span className="muted small">{task.attachments.length}</span>}
        <button type="button" className="btn small ghost" onClick={() => inputRef.current?.click()}><Icon name="upload" size={13} /> Upload</button>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </div>

      {task.attachments.length > 0 && (
        <div className="att-grid">
          {task.attachments.map((a) => (
            <div key={a.id} className="att-card" title={`${a.filename}\n${fmtSize(a.size)} · ${a.mime}\nUploaded by ${a.user_name || 'someone'} on ${parseStamp(a.created_at).toLocaleString()}`}>
              <button type="button" className="att-thumb" onClick={() => (a.inline ? setPreview(a) : window.open(`${a.url}&download`, '_self'))}>
                {isImage(a) ? <img src={a.url} alt="" loading="lazy" /> : <Icon name={fileIcon(a)} size={26} />}
              </button>
              <div className="att-meta">
                <span className="att-name ellipsis">{a.filename}</span>
                <span className="muted small row-gap">
                  <Avatar user={{ name: a.user_name || '?', color: a.user_color }} size={14} />
                  {fmtSize(a.size)} · {timeAgo(a.created_at)}
                </span>
              </div>
              <div className="att-actions">
                {a.inline && <button type="button" className="icon-btn tiny" onClick={() => setPreview(a)} aria-label="Preview"><Icon name="search" size={12} /></button>}
                <a className="icon-btn tiny" href={`${a.url}&download`} aria-label="Download"><Icon name="download" size={12} /></a>
                {(a.user_id === me.id || isManager) && (
                  <ConfirmButton className="icon-btn tiny danger-hover" onConfirm={() => remove(a)} confirmText={<Icon name="check" size={12} strokeWidth={3} />}><Icon name="trash" size={12} /></ConfirmButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {uploads.map((u) => (
        <div key={u.id} className="upload-row">
          <Icon name="upload" size={13} className="muted" />
          <span className="grow ellipsis small">{u.name}</span>
          <span style={{ width: 120 }}><ProgressBar value={Math.round(u.progress * 100)} height={4} /></span>
        </div>
      ))}

      <button type="button" className={`drop-zone${task.attachments.length ? ' compact' : ''}`} onClick={() => inputRef.current?.click()}>
        <Icon name="upload" size={16} /> Drop files here or click to upload
      </button>
      {preview && <Preview att={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

let tagCache = null;

export function tagColor(tag) {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 45%)`;
}

export function Tag({ tag, onRemove }) {
  return (
    <span className="tag" style={{ '--c': tagColor(tag) }}>
      {tag}
      {onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${tag}`}><Icon name="x" size={10} strokeWidth={3} /></button>
      )}
    </span>
  );
}

export default function TagInput({ value = [], onChange }) {
  const [draft, setDraft] = useState('');
  const [known, setKnown] = useState(tagCache || []);

  useEffect(() => {
    if (tagCache) return;
    api('/tasks/tags').then((t) => { tagCache = t.map((x) => x.tag); setKnown(tagCache); }).catch(() => {});
  }, []);

  const add = (raw) => {
    const tag = raw.trim().toLowerCase();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
      if (tagCache && !tagCache.includes(tag)) tagCache.push(tag);
    }
    setDraft('');
  };
  const suggestions = draft ? known.filter((t) => t.includes(draft.toLowerCase()) && !value.includes(t)).slice(0, 6) : [];

  return (
    <div className="tag-input">
      {value.map((t) => <Tag key={t} tag={t} onRemove={() => onChange(value.filter((x) => x !== t))} />)}
      <input
        value={draft}
        placeholder={value.length ? '' : 'Add tags (press Enter)'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
      />
      {suggestions.length > 0 && (
        <div className="tag-suggest">
          {suggestions.map((s) => (
            <button type="button" key={s} onMouseDown={(e) => { e.preventDefault(); add(s); }}><Tag tag={s} /></button>
          ))}
        </div>
      )}
    </div>
  );
}

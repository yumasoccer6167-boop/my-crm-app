import { useEffect, useRef, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';

const inputCls = 'w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none';

// 名前で検索して選べるプルダウン。options は { value, label } の配列。value が '' のものは「すべて」の扱い
export default function SearchableSelect({ value, onChange, options, placeholder = '名前で検索', ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const input = useRef(null);
  const current = options.find(o => String(o.value) === String(value));
  const term = q.trim().toLowerCase();
  const shown = term ? options.filter(o => o.value === '' || o.label.toLowerCase().includes(term)) : options;
  const pick = (o) => { onChange(String(o.value)); setOpen(false); setQ(''); };

  useEffect(() => {
    if (!open) return undefined;
    input.current?.focus();
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} className={`${inputCls} flex items-center justify-between gap-2 text-left`}>
        <span className="truncate">{current ? current.label : 'すべて'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-64 rounded-md bg-white p-2 shadow-lg ring-1 ring-slate-200">
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input
              ref={input}
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQ(''); }
                if (e.key === 'Enter') { e.preventDefault(); const first = shown.find(o => o.value !== '') || shown[0]; if (first) pick(first); }
              }}
              placeholder={placeholder}
              aria-label={`${ariaLabel || ''}を検索`}
              className={`${inputCls} pl-8`}
            />
          </div>
          <ul role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto">
            {term && !shown.some(o => o.value !== '') && <li className="px-2 py-2 text-sm text-slate-400">該当する協会がありません</li>}
            {shown.map(o => (
              <li key={o.value} role="option" aria-selected={String(o.value) === String(value)}>
                <button type="button" onClick={() => pick(o)} className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-indigo-50 ${String(o.value) === String(value) ? 'bg-indigo-50 font-medium text-indigo-800' : 'text-slate-800'}`}>{o.label}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

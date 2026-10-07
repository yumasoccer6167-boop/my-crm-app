import { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { formatReleasedAt } from './releaseNotes.js';

// アプリ更新のお知らせ。更新後の最初の表示と、サイドバー「更新情報」からの見返しの両方で使う
export default function ReleaseNotesModal({ notes, onClose, isNew }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="アップデートのお知らせ">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85dvh] flex flex-col">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Sparkles className="w-5 h-5 text-teal-600" />
          <h3 className="font-bold text-slate-800 flex-1">{isNew ? 'アップデートのお知らせ' : '更新情報'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="閉じる"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {notes.map((n) => (
            <section key={n.id}>
              <p className="text-xs text-slate-400 tabular-nums">{formatReleasedAt(n.releasedAt)} 更新</p>
              <h4 className="font-bold text-slate-800 mt-0.5">{n.title}</h4>
              <ul className="mt-2 space-y-2">
                {n.items.map((item, i) => {
                  const { heading, text } = typeof item === 'string' ? { heading: null, text: item } : item;
                  return (
                    <li key={i} className="text-sm text-slate-600 leading-relaxed flex gap-2">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
                      <span>{heading && <span className="font-semibold text-slate-800">{heading}：</span>}{text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">{isNew ? '確認しました' : '閉じる'}</button>
        </div>
      </div>
    </div>
  );
}

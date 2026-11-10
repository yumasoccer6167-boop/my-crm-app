import { useEffect, useMemo, useRef, useState } from "react";
import { filterByQuery } from "./SearchSelect";

export type MultiOption = { value: string; label: string; /** 候補の横に出す件数 */ count?: number };

/**
 * 複数選択の絞り込み欄。押すと、検索欄とチェックボックスの一覧が開く。
 * 何も選ばない状態は「すべて」（その項目では絞り込まない）。「未設定」などの候補も選べる
 */
export function MultiSelect({ label, options, selected, onChange, unit = "件" }: { label: string; options: MultiOption[]; selected: Set<string>; onChange: (next: Set<string>) => void; unit?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const shown = useMemo(() => filterByQuery(options, q, (o) => o.label), [options, q]);
  const names = options.filter((o) => selected.has(o.value)).map((o) => o.label);
  const summary = selected.size === 0 ? "すべて" : names.length === 0 ? `${selected.size}件を選択中` : names.length === 1 ? names[0]! : `${names[0]} ほか${names.length - 1}`;

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };

  return (
    <div ref={root} className="relative">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 text-left text-sm ring-1 ring-inset ${selected.size ? "text-indigo-800 ring-indigo-400" : "text-slate-700 ring-slate-300"} hover:bg-slate-50`}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden className="text-[10px] text-slate-400">
          ▼
        </span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-full min-w-[14rem] rounded-md bg-white shadow-lg ring-1 ring-slate-200">
          {options.length > 8 && (
            <div className="border-b border-slate-100 p-2">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${label}を検索`} autoFocus className="w-full rounded border-0 px-2 py-1 text-sm ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-slate-500">
            <span>{selected.size === 0 ? "選ばなければ、すべて" : `${selected.size}件を選択中`}</span>
            <button type="button" disabled={selected.size === 0} onClick={() => onChange(new Set())} className="text-indigo-700 hover:underline disabled:text-slate-300 disabled:no-underline">
              選択を外す
            </button>
          </div>
          <ul role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto pb-1">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">該当する候補がありません</li>}
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600" />
                  <span className="min-w-0 flex-1 truncate" title={o.label}>
                    {o.label}
                  </span>
                  {o.count != null && (
                    <span className="text-xs tabular-nums text-slate-400">
                      {o.count.toLocaleString()}
                      {unit}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

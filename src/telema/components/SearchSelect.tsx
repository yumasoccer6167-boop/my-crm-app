import { useEffect, useMemo, useRef, useState } from "react";
import { selectCls } from "./ui";

export type SearchOption = { value: string; label: string };

/** 検索用に揃える（全角／半角・大文字／小文字・カナの違いを無視する） */
export const normalizeForSearch = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");

/** 空白で区切った語がすべて含まれるものだけに絞る */
export function filterByQuery<T>(items: T[], query: string, text: (item: T) => string): T[] {
  const words = query.split(/[\s　]+/).map(normalizeForSearch).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((it) => {
    const t = normalizeForSearch(text(it));
    return words.every((w) => t.includes(w));
  });
}

/**
 * 候補が多いときの選択欄。押すと検索欄つきの一覧が開き、名前の一部で絞り込んで1件選ぶ（Enter で先頭を選ぶ）。
 * 先頭の「全て」のような、絞り込みを外す候補は pinned に渡す（検索に関わらず常に出す）
 */
export function SearchSelect({
  value,
  onChange,
  options,
  pinned = [],
  placeholder,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  pinned?: SearchOption[];
  placeholder: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const current = [...pinned, ...options].find((o) => o.value === value && value !== "");
  const hits = useMemo(() => filterByQuery(options, query, (o) => o.label), [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={box} className={`relative inline-block ${className}`}>
      <button type="button" className={`${selectCls} flex max-w-56 items-center justify-between gap-2 text-left`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel ?? placeholder}>
        <span className={`truncate ${current ? "" : "text-slate-500"}`}>{current ? current.label : placeholder}</span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-72 max-w-[90vw] rounded-md bg-white p-2 shadow-lg ring-1 ring-slate-200">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") {
                e.preventDefault();
                if (hits[0]) pick(hits[0].value);
              }
            }}
            placeholder={`${placeholder}を検索（例：一部の文字）`}
            className="mb-2 w-full rounded-md border-0 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            aria-label={`${placeholder}を検索`}
          />
          <ul role="listbox" className="max-h-64 overflow-y-auto text-sm">
            {pinned.map((o) => (
              <li key={`p${o.value}`}>
                <button type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o.value)} className={`block w-full rounded px-2 py-1.5 text-left hover:bg-indigo-50 ${o.value === value ? "font-semibold text-indigo-700" : "text-slate-600"}`}>
                  {o.label}
                </button>
              </li>
            ))}
            {hits.map((o) => (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o.value)} className={`block w-full rounded px-2 py-1.5 text-left hover:bg-indigo-50 ${o.value === value ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-800"}`}>
                  {o.label}
                </button>
              </li>
            ))}
            {hits.length === 0 && <li className="px-2 py-3 text-center text-xs text-slate-400">「{query}」に合うものがありません</li>}
          </ul>
          <div className="mt-1 px-2 text-right text-[11px] text-slate-400">
            {query ? `${hits.length}件 / 全${options.length}件` : `全${options.length}件`}
          </div>
        </div>
      )}
    </div>
  );
}

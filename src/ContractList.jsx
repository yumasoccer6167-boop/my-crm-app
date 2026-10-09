// 契約リスト：テレマリストのカルテに登録された契約情報を、全施設分まとめて一覧にするページ。
// 契約情報はカルテで登録・編集したものがそのまま出る（このページでは登録しない）。商材・営業担当・アポ担当者名・契約日などで絞り込める。
import { useEffect, useMemo, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';

const PER_PAGE = 50;
const inputCls = 'w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none';
const btnSecondary = 'inline-flex items-center justify-center gap-1 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300';
const EMPTY = { q: '', product: '', assigned: '', appointment: '', dateFrom: '', dateTo: '', order: 'desc' };

const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const fmtDate = (d) => (d ? d.replaceAll('-', '/') : '—');

function Label({ children }) {
  return <span className="mb-1 block text-xs font-medium text-slate-500">{children}</span>;
}

export default function ContractListView({ token, onOpenTelemaCompany }) {
  const [f, setF] = useState(EMPTY);
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [facets, setFacets] = useState(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const set = (k, v) => { setF(prev => ({ ...prev, [k]: v })); setPage(1); };

  // キーワードは入力が止まってから検索する
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(f.q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [f.q]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), order: f.order });
    if (debouncedQ) p.set('q', debouncedQ);
    if (f.product) p.set('product', f.product);
    if (f.assigned) p.set('assigned', f.assigned);
    if (f.appointment) p.set('appointment', f.appointment);
    if (f.dateFrom) p.set('date_from', f.dateFrom);
    if (f.dateTo) p.set('date_to', f.dateTo);
    return p.toString();
  }, [page, debouncedQ, f.product, f.assigned, f.appointment, f.dateFrom, f.dateTo, f.order]);

  useEffect(() => {
    let alive = true;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`/api/telema/contracts?${query}`, { headers }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch('/api/telema/contracts/facets', { headers }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([list, fc]) => { if (alive) { setData(list); setFacets(fc); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [query, token, reloadKey]);

  // 別のタブから戻ったとき、カルテで登録された最新の契約を読み込み直す
  useEffect(() => {
    const onBack = () => { if (document.visibilityState === 'visible') setReloadKey(k => k + 1); };
    document.addEventListener('visibilitychange', onBack);
    return () => document.removeEventListener('visibilitychange', onBack);
  }, []);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = f.q || f.product || f.assigned || f.appointment || f.dateFrom || f.dateTo;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        テレマリストのカルテに登録された契約情報の一覧です。カルテで契約情報を登録・変更すると、ここに反映されます。
        {data && <span className="ml-2 text-slate-500">{filtered ? '該当' : '登録数'} <b className="tabular-nums text-slate-800">{total.toLocaleString()}</b> 件</span>}
      </p>

      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="sm:col-span-2">
            <Label>キーワード（施設名・法人名・住所・電話・商材・アポ担当者名）</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <input type="search" value={f.q} onChange={e => set('q', e.target.value)} placeholder="例：かまち、Site Premium" className={`${inputCls} pl-8`} />
            </div>
          </label>
          <label>
            <Label>商材</Label>
            <select value={f.product} onChange={e => set('product', e.target.value)} className={inputCls}>
              <option value="">すべて</option>
              {(facets?.products || []).map(p => <option key={p.value} value={p.value}>{p.value}（{p.n}）</option>)}
            </select>
          </label>
          <label>
            <Label>営業担当</Label>
            <select value={f.assigned} onChange={e => set('assigned', e.target.value)} className={inputCls}>
              <option value="">すべて</option>
              {(facets?.assignees || []).map(a => <option key={a.id} value={a.id}>{a.name}（{a.n}）</option>)}
              <option value="none">未設定</option>
            </select>
          </label>
          <label>
            <Label>アポ担当者名</Label>
            <select value={f.appointment} onChange={e => set('appointment', e.target.value)} className={inputCls}>
              <option value="">すべて</option>
              {(facets?.appointments || []).map(a => <option key={a.value} value={a.value}>{a.value}（{a.n}）</option>)}
              <option value="__none__">未設定</option>
            </select>
          </label>
          <label>
            <Label>契約日（から）</Label>
            <input type="date" value={f.dateFrom} onChange={e => set('dateFrom', e.target.value)} className={inputCls} />
          </label>
          <label>
            <Label>契約日（まで）</Label>
            <input type="date" value={f.dateTo} onChange={e => set('dateTo', e.target.value)} className={inputCls} />
          </label>
          <label>
            <Label>並び順</Label>
            <select value={f.order} onChange={e => set('order', e.target.value)} className={inputCls}>
              <option value="desc">契約日が新しい順</option>
              <option value="asc">契約日が古い順</option>
            </select>
          </label>
        </div>
        {filtered && (
          <div className="mt-3 flex justify-end">
            <button type="button" className={btnSecondary} onClick={() => { setF(EMPTY); setPage(1); }}>条件をクリア</button>
          </div>
        )}
      </div>

      {error && <div role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">契約リストを読み込めませんでした。ページを開き直してください。</div>}

      <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">施設（法人）</th>
              <th className="px-3 py-2 font-medium">商材</th>
              <th className="px-3 py-2 font-medium">商材リンク</th>
              <th className="px-3 py-2 font-medium">契約日</th>
              <th className="px-3 py-2 font-medium">営業担当</th>
              <th className="px-3 py-2 font-medium">アポ担当者名</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!data && !error && <tr><td colSpan={6} className="py-10 text-center text-slate-400">読み込み中…</td></tr>}
            {data && data.items.length === 0 && (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">{filtered ? '条件に合う契約情報がありません。' : 'まだ契約情報がありません。テレマリストのカルテで登録すると、ここに表示されます。'}</td></tr>
            )}
            {(data?.items || []).map(c => {
              const url = safeUrl(c.product_url);
              return (
                <tr key={c.id} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onOpenTelemaCompany(c.company_id)} className="text-left font-medium text-indigo-700 hover:underline">{c.company_name}</button>
                    {!!c.is_user && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
                    {c.organization_name && <div className="text-xs text-slate-500">{c.organization_name}</div>}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{c.product_name}</td>
                  <td className="px-3 py-2">
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline">{host(url)}<ExternalLink className="h-3 w-3" /></a> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{fmtDate(c.contract_date)}</td>
                  <td className="px-3 py-2 text-slate-700">{c.assigned_user_name || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-slate-700">{c.appointment_user_name || <span className="text-slate-300">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > PER_PAGE && (
        <div className="flex items-center justify-end gap-3 text-sm text-slate-600">
          <span className="tabular-nums">{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} / {total.toLocaleString()}件</span>
          <button type="button" className={btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>前へ</button>
          <span className="tabular-nums">{page} / {pages}</span>
          <button type="button" className={btnSecondary} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>次へ</button>
        </div>
      )}
    </div>
  );
}

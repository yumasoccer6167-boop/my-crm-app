// 事例管理：成功事例ライブラリ。
// 「業種・エリア／困りごと／施策／成果」の4点で事例を蓄積し、検索・絞り込み・PDF出力ができる。
// テレマリストのカルテ（施設）と紐づけると、カルテの情報を事例に反映でき、カルテ側にもその事例が表示される。
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, Link2, Trash2, Edit, FileText, ExternalLink } from 'lucide-react';

// 制作内容の分類（絞り込み用）
const SUCCESS_CASE_TAGS = ['採用サイト', 'ホームページ', '動画', '広告運用', 'MEO・口コミ対策', 'その他'];
const GOALS = ['集客', '採用'];
const GOAL_STYLE = {
  集客: 'bg-sky-50 text-sky-800 ring-sky-200',
  採用: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
};

const inputCls = 'w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none';
const btnCls = 'inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed';
const btnPrimary = `${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300`;
const btnSecondary = `${btnCls} bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400`;
const btnDanger = `${btnCls} bg-white text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-50`;

const tagsOf = (c) => (Array.isArray(c.tags) ? c.tags : []);
const goalsOf = (c) => (Array.isArray(c.goals) ? c.goals : []);
const titleOf = (c) => c.name || `${c.industry}（${c.area}）`;
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// 数字の部分を強調して表示する
function Emph({ text }) {
  return String(text ?? '').split(/(\d+(?:[.,]\d+)?)/).map((p, i) => (i % 2 ? <b key={i} className="text-indigo-700">{p}</b> : p));
}

function Chip({ active, onClick, children, count }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${active ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>
      {children}
      {count != null && <span className={`ml-1 tabular-nums ${active ? 'text-slate-300' : 'text-slate-400'}`}>{count}</span>}
    </button>
  );
}

function GoalBadges({ c }) {
  return goalsOf(c).map(g => (
    <span key={g} className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${GOAL_STYLE[g] || 'bg-slate-100 text-slate-700 ring-slate-200'}`}>{g}</span>
  ));
}

function Dialog({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className={`flex max-h-[88dvh] w-full flex-col rounded-lg bg-white shadow-xl ring-1 ring-slate-200 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">{title}</div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- テレマリスト（カルテ）との連携 ----------
function useTelema(token) {
  return useMemo(() => (path) => fetch(`/api/telema${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => { if (!r.ok) throw new Error('telema'); return r.json(); }), [token]);
}

/** カルテ（テレマリストの施設）を検索して選ぶ */
function TelemaCompanyPicker({ token, onPick }) {
  const telema = useTelema(token);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (!term) return undefined;
    const timer = setTimeout(() => {
      telema(`/companies?q=${encodeURIComponent(term)}&per_page=8`)
        .then(d => { setItems(d.items || []); setError(false); })
        .catch(() => setError(true));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, telema]);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="施設名・電話番号でカルテを検索" className={`${inputCls} pl-8`} autoComplete="off" />
      </div>
      {q.trim() && error && <p className="text-xs text-rose-600">カルテを検索できませんでした</p>}
      {q.trim() && items.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md ring-1 ring-slate-200">
          {items.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => { onPick(c); setQ(''); setItems([]); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                <span className="font-medium text-slate-800">{c.company_name}</span>
                <span className="ml-2 text-xs text-slate-500">{[c.city, c.phone].filter(Boolean).join(' ／ ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 事例に紐づいたカルテの情報（ステータス・契約・加盟協会など）を、カルテから読み込んで表示する */
function TelemaLinkPanel({ token, companyId, fallbackName, onOpenCompany }) {
  const telema = useTelema(token);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    Promise.all([telema(`/companies/${companyId}`), telema('/statuses')])
      .then(([d, statuses]) => { if (alive) setState({ detail: d, statuses }); })
      .catch(() => { if (alive) setState({ error: true }); });
    return () => { alive = false; };
  }, [companyId, telema]);
  const frame = 'rounded-md bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200';
  if (state.loading) return <div className={`${frame} text-slate-400`}>カルテの情報を読み込んでいます…</div>;
  if (state.error) return <div className={`${frame} text-slate-500`}>カルテ「{fallbackName || companyId}」の情報を読み込めませんでした（削除された、または見られない施設です）。</div>;
  const { company: co, contracts = [], associations = [], list_types: listTypes = [] } = state.detail;
  const status = state.statuses.find(s => s.id === co.status_id);
  return (
    <div className={`${frame} space-y-1.5`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">テレマリストのカルテ</span>
        <button type="button" onClick={() => onOpenCompany(co.id)} className="font-semibold text-indigo-700 hover:underline">{co.company_name}</button>
        {!!co.is_user && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
        {status && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">{status.label}</span>}
      </div>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-xs text-slate-600">
        {co.address && (<><dt className="text-slate-400">住所</dt><dd>{co.address}</dd></>)}
        {co.phone && (<><dt className="text-slate-400">電話</dt><dd>{co.phone}</dd></>)}
        {associations.length > 0 && (<><dt className="text-slate-400">加盟協会</dt><dd>{associations.map(a => a.name).join('、')}</dd></>)}
        {listTypes.length > 0 && (<><dt className="text-slate-400">リスト種類</dt><dd>{listTypes.map(a => a.name).join('、')}</dd></>)}
        {contracts.length > 0 && (<><dt className="text-slate-400">契約情報</dt><dd>{contracts.map(k => `${k.product_name}（${k.contract_date}）`).join('、')}</dd></>)}
      </dl>
    </div>
  );
}

// ---------- PDF（印刷ダイアログから「PDFに保存」） ----------
function printCases(list) {
  const sheets = list.map(c => {
    const url = safeUrl(c.url);
    const nl = (s) => esc(s).replace(/\n/g, '<br>');
    const emph = (s) => esc(s).replace(/(\d+(?:[.,]\d+)?)/g, '<b>$1</b>');
    return `<section class="sheet">
  <div class="label">導入事例</div>
  <h1>${esc(titleOf(c))}</h1>
  <div class="tags">${goalsOf(c).map(g => `<span>${esc(g)}</span>`).join('')}<span>${esc(c.industry)}</span><span>${esc(c.area)}</span>${c.measure ? `<span>${esc(c.measure)}</span>` : ''}</div>
  <div class="hero"><div class="l">成果</div><div class="v">${emph(c.headline)}</div>${c.period ? `<div class="p">期間：${esc(c.period)}</div>` : ''}</div>
  <div class="step"><div class="n">1</div><div><h4>どんな会社</h4><p>${esc(c.industry)}／${esc(c.area)}${c.name ? `<br>${esc(c.name)}` : ''}${url ? `<br>${esc(url)}` : ''}</p></div></div>
  <div class="step"><div class="n">2</div><div><h4>何に困っていた</h4><p>${nl(c.problem)}</p></div></div>
  <div class="step"><div class="n">3</div><div><h4>何をした</h4><p>${nl(c.action)}</p></div></div>
  <div class="step win"><div class="n">4</div><div><h4>どうなった</h4><p>${esc(c.headline)}${c.result ? `<br>${nl(c.result)}` : ''}</p></div></div>
</section>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>導入事例集</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1e293b; margin: 0; }
  .sheet { page-break-after: always; padding: 4px 2px; }
  .sheet:last-child { page-break-after: auto; }
  .label { font-size: 11px; letter-spacing: .12em; color: #4f46e5; font-weight: 700; }
  h1 { font-size: 22px; margin: 4px 0 8px; }
  .tags span { display: inline-block; font-size: 11px; padding: 2px 8px; margin: 0 4px 4px 0; border: 1px solid #cbd5e1; border-radius: 4px; color: #475569; }
  .hero { margin: 14px 0 18px; padding: 14px 16px; background: #eef2ff; border-radius: 8px; }
  .hero .l { font-size: 11px; color: #4338ca; font-weight: 700; }
  .hero .v { font-size: 24px; font-weight: 800; margin-top: 2px; }
  .hero .v b { color: #4338ca; font-size: 30px; }
  .hero .p { font-size: 12px; color: #64748b; margin-top: 4px; }
  .step { display: flex; gap: 12px; margin-bottom: 14px; }
  .step .n { flex: none; width: 24px; height: 24px; border-radius: 50%; background: #1e293b; color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .step.win .n { background: #4f46e5; }
  .step h4 { margin: 2px 0 4px; font-size: 13px; }
  .step p { margin: 0; font-size: 12.5px; line-height: 1.7; }
</style></head><body>${sheets}<script>window.onload = function(){ window.print(); };</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

// ---------- 詳細 ----------
function Step({ n, title, children, win }) {
  return (
    <div className="flex gap-3">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${win ? 'bg-indigo-600' : 'bg-slate-700'}`}>{n}</span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <div className="mt-1 text-sm leading-relaxed text-slate-700">{children}</div>
      </div>
    </div>
  );
}

function CaseDetail({ c, token, canEdit, canDelete, onEdit, onDelete, onClose, onOpenTelemaCompany, onPdf }) {
  const [confirming, setConfirming] = useState(false);
  const url = safeUrl(c.url);
  return (
    <Dialog
      wide
      onClose={onClose}
      title={(
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <GoalBadges c={c} />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">{c.industry}</span>
            <span>{c.area}</span>
            {c.measure && <span>・{c.measure}</span>}
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">{titleOf(c)}</h3>
        </>
      )}
      footer={(
        <>
          {canDelete && (
            <div className="mr-auto flex items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-sm text-slate-700">本当に削除しますか？</span>
                  <button type="button" className={btnDanger} onClick={onDelete}>削除する</button>
                  <button type="button" className={btnSecondary} onClick={() => setConfirming(false)}>やめる</button>
                </>
              ) : (
                <button type="button" className={btnDanger} onClick={() => setConfirming(true)}><Trash2 className="h-4 w-4" />削除</button>
              )}
            </div>
          )}
          <button type="button" className={btnSecondary} onClick={onPdf}><FileText className="h-4 w-4" />PDFで保存</button>
          {canEdit && <button type="button" className={btnSecondary} onClick={onEdit}><Edit className="h-4 w-4" />編集</button>}
          <button type="button" className={btnSecondary} onClick={onClose}>閉じる</button>
        </>
      )}
    >
      <div className="space-y-4">
        <Step n="1" title="どんな会社">
          <p>{c.industry}／{c.area}{c.name && <><br />{c.name}</>}</p>
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline">{url}<ExternalLink className="h-3 w-3" /></a>}
        </Step>
        <Step n="2" title="何に困っていた"><p className="whitespace-pre-wrap">{c.problem}</p></Step>
        <Step n="3" title="何をした">
          {tagsOf(c).length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">{tagsOf(c).map(t => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t}</span>)}</div>
          )}
          <p className="whitespace-pre-wrap">{c.action}</p>
        </Step>
        <Step n="4" title="どうなった" win>
          <div className="rounded-md bg-indigo-50 px-3 py-2 ring-1 ring-inset ring-indigo-100">
            <span className="text-lg font-semibold text-slate-900"><Emph text={c.headline} /></span>
            {c.period && <span className="ml-2 text-xs text-slate-500">期間：{c.period}</span>}
          </div>
          {c.result && <p className="mt-1.5 whitespace-pre-wrap">{c.result}</p>}
        </Step>
        {c.telemaCompanyId && <TelemaLinkPanel token={token} companyId={c.telemaCompanyId} fallbackName={c.telemaCompanyName} onOpenCompany={onOpenTelemaCompany} />}
      </div>
    </Dialog>
  );
}

// ---------- 追加・編集フォーム ----------
function Legend({ n, children }) {
  return <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs text-white">{n}</span>{children}</legend>;
}
function Field({ label, req, hint, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-slate-600 ${className}`}>
      <span>{label}{req && <span className="ml-0.5 text-rose-600">*</span>}{hint && <span className="ml-2 font-normal text-slate-400">{hint}</span>}</span>
      {children}
    </label>
  );
}

function CaseForm({ initial, token, onSave, onClose, saving }) {
  const [f, setF] = useState(() => ({
    goals: [], industry: '', area: '', name: '', url: '', problem: '', tags: [], measure: '', action: '', headline: '', period: '', result: '',
    telemaCompanyId: null, telemaCompanyName: '', ...initial,
  }));
  const [error, setError] = useState('');
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const toggle = (k, v) => setF(prev => ({ ...prev, [k]: prev[k].includes(v) ? prev[k].filter(x => x !== v) : [...prev[k], v] }));

  // カルテの情報を、まだ入力していない項目に反映する（入力済みの内容は上書きしない）
  const pickCompany = (co) => {
    setF(prev => ({
      ...prev,
      telemaCompanyId: co.id,
      telemaCompanyName: co.company_name,
      name: prev.name || co.company_name || '',
      industry: prev.industry || co.industry || '',
      area: prev.area || [co.prefecture, co.city].filter(Boolean).join('') || '',
    }));
    // 検索結果にないURLは、カルテの詳細から補う
    fetch(`/api/telema/companies/${co.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setF(prev => ({
          ...prev,
          url: prev.url || d.company.website || '',
          industry: prev.industry || d.company.industry || '',
          area: prev.area || [d.company.prefecture, d.company.city].filter(Boolean).join(''),
        }));
      })
      .catch(() => {});
  };

  const submit = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    const missing = [['industry', '業種'], ['area', 'エリア'], ['problem', '困っていたこと'], ['action', '施策の内容'], ['headline', '成果']].filter(([k]) => !data[k]).map(([, l]) => l);
    if (missing.length) { setError(`${missing.join('・')}を入力してください。`); return; }
    onSave(data);
  };

  return (
    <Dialog
      wide
      onClose={onClose}
      title={<h3 className="text-base font-semibold text-slate-900">{f.id ? '事例を編集' : '事例を追加'}</h3>}
      footer={(
        <>
          {error && <span className="mr-auto text-sm text-rose-600">{error}</span>}
          <button type="button" className={btnSecondary} onClick={onClose}>キャンセル</button>
          <button type="submit" form="success-case-form" className={btnPrimary} disabled={saving}>保存</button>
        </>
      )}
    >
      <form id="success-case-form" onSubmit={submit} noValidate className="space-y-5">
        <fieldset>
          <Legend n="1">どんな会社</Legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">目的<span className="ml-2 font-normal text-slate-400">集客（利用者・園児・お客様を増やす）／採用（職員を増やす）</span></span>
              <div className="flex gap-2">{GOALS.map(g => <Chip key={g} active={f.goals.includes(g)} onClick={() => toggle('goals', g)}>{g}</Chip>)}</div>
            </div>
            <div className="sm:col-span-2 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-600">
                <Link2 className="h-3.5 w-3.5" />テレマリストのカルテと連携<span className="font-normal text-slate-400">選ぶと、会社名・業種・エリア・サイトURLを反映します（任意）</span>
              </div>
              {f.telemaCompanyId ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-slate-800">{f.telemaCompanyName || `カルテ #${f.telemaCompanyId}`}</span>
                  <button type="button" className="text-xs text-slate-500 hover:text-rose-600 hover:underline" onClick={() => setF(prev => ({ ...prev, telemaCompanyId: null, telemaCompanyName: '' }))}>連携を外す</button>
                </div>
              ) : <TelemaCompanyPicker token={token} onPick={pickCompany} />}
            </div>
            <Field label="業種" req><input className={inputCls} value={f.industry} onChange={e => set('industry', e.target.value)} placeholder="訪問介護" /></Field>
            <Field label="エリア" req><input className={inputCls} value={f.area} onChange={e => set('area', e.target.value)} placeholder="大阪府" /></Field>
            <Field label="会社名" hint="任意"><input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="サイトURL" hint="任意"><input className={inputCls} type="url" value={f.url} onChange={e => set('url', e.target.value)} placeholder="https://" /></Field>
          </div>
        </fieldset>
        <fieldset>
          <Legend n="2">何に困っていた</Legend>
          <textarea className={`${inputCls} min-h-[5rem] resize-y`} value={f.problem} onChange={e => set('problem', e.target.value)} />
        </fieldset>
        <fieldset>
          <Legend n="3">何をした</Legend>
          <div className="grid gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">制作内容<span className="ml-2 font-normal text-slate-400">当てはまるものをすべて選択（絞り込みに使います）</span></span>
              <div className="flex flex-wrap gap-2">{SUCCESS_CASE_TAGS.map(t => <Chip key={t} active={f.tags.includes(t)} onClick={() => toggle('tags', t)}>{t}</Chip>)}</div>
            </div>
            <Field label="施策名" hint="カードに表示されます（例：採用サイト＋動画制作）"><input className={inputCls} value={f.measure} onChange={e => set('measure', e.target.value)} /></Field>
            <Field label="施策の内容" req><textarea className={`${inputCls} min-h-[5rem] resize-y`} value={f.action} onChange={e => set('action', e.target.value)} /></Field>
          </div>
        </fieldset>
        <fieldset>
          <Legend n="4">どうなった</Legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="成果（数字1つ）" req hint="例：応募数 月1件→8件"><input className={inputCls} value={f.headline} onChange={e => set('headline', e.target.value)} /></Field>
            <Field label="期間" hint="例：3ヶ月"><input className={inputCls} value={f.period} onChange={e => set('period', e.target.value)} /></Field>
            <Field label="成果の詳細" className="sm:col-span-2"><textarea className={`${inputCls} min-h-[4rem] resize-y`} value={f.result} onChange={e => set('result', e.target.value)} /></Field>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

// ---------- ページ本体 ----------
/**
 * request: { ts, caseId } で事例の詳細を開く／{ ts, create: {...} } でカルテの情報を反映した追加フォームを開く（テレマリストから）
 * onOpenTelemaCompany(id): テレマリストのカルテを開く
 */
export default function SuccessCasesView({ cases, setCases, currentUser, token, canDeleteAny, request, onRequestHandled, onOpenTelemaCompany, showAlert }) {
  const [q, setQ] = useState('');
  const [industry, setIndustry] = useState('');
  const [tag, setTag] = useState('');
  const [goal, setGoal] = useState('');
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null); // { initial }

  // テレマリストのカルテからの依頼（詳細を開く／カルテ付きで追加する）。新しい依頼が来たときだけ画面に反映する
  const [seenRequest, setSeenRequest] = useState(null);
  if (request && request.ts !== seenRequest) {
    setSeenRequest(request.ts);
    if (request.caseId != null) setOpenId(request.caseId);
    else if (request.create) setEditing({ initial: request.create });
  }
  useEffect(() => { if (request && onRequestHandled) onRequestHandled(); }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => [...(cases || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), [cases]);
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sorted.filter(c => {
      if (industry && c.industry !== industry) return false;
      if (tag && !tagsOf(c).includes(tag)) return false;
      if (goal && !goalsOf(c).includes(goal)) return false;
      if (!term) return true;
      return [c.name, c.url, c.industry, c.area, c.problem, c.measure, c.action, c.headline, c.period, c.result, c.telemaCompanyName, ...tagsOf(c), ...goalsOf(c)].join(' ').toLowerCase().includes(term);
    });
  }, [sorted, q, industry, tag, goal]);
  const industries = useMemo(() => [...new Set(sorted.map(c => c.industry).filter(Boolean))], [sorted]);
  const opened = (cases || []).find(c => c.id === openId);

  const save = (data) => {
    const now = new Date().toISOString();
    if (data.id) {
      setCases(prev => prev.map(c => (c.id === data.id ? { ...c, ...data, updatedAt: now } : c)));
      showAlert && showAlert('事例を更新しました。');
    } else {
      const created = { ...data, id: Date.now(), createdAt: now, updatedAt: now, createdBy: currentUser?.displayName || '' };
      setCases(prev => [created, ...prev]);
      showAlert && showAlert('事例を登録しました。');
    }
    setEditing(null);
  };
  const remove = (id) => {
    setCases(prev => prev.filter(c => c.id !== id));
    setOpenId(null);
  };
  const pdf = (list) => { if (!printCases(list)) showAlert && showAlert('ポップアップがブロックされました。許可してからもう一度お試しください。'); };
  const canDelete = (c) => canDeleteAny || (c.createdBy && c.createdBy === currentUser?.displayName);

  const count = (fn) => sorted.filter(fn).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-600">業種・エリア／困りごと／施策／成果の4点で事例を蓄積します。<span className="ml-2 text-slate-500">登録数 <b className="tabular-nums text-slate-800">{sorted.length}</b> 件</span></p>
        <div className="flex gap-2">
          {visible.length > 0 && <button type="button" className={btnSecondary} onClick={() => pdf(visible)}><FileText className="h-4 w-4" />{visible.length === sorted.length ? `全${visible.length}件をPDFで保存` : `絞り込んだ${visible.length}件をPDFで保存`}</button>}
          <button type="button" className={btnPrimary} onClick={() => setEditing({ initial: {} })}><Plus className="h-4 w-4" />事例を追加</button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="キーワードで検索（例：採用、介護、大阪）" aria-label="キーワード検索" className={`${inputCls} pl-8`} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 w-14 text-xs text-slate-500">目的</span>
          <Chip active={!goal} onClick={() => setGoal('')}>すべて</Chip>
          {GOALS.map(g => <Chip key={g} active={goal === g} onClick={() => setGoal(g)} count={count(c => goalsOf(c).includes(g))}>{g}</Chip>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 w-14 text-xs text-slate-500">制作内容</span>
          <Chip active={!tag} onClick={() => setTag('')}>すべて</Chip>
          {SUCCESS_CASE_TAGS.filter(t => count(c => tagsOf(c).includes(t)) || tag === t).map(t => <Chip key={t} active={tag === t} onClick={() => setTag(t)} count={count(c => tagsOf(c).includes(t))}>{t}</Chip>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 w-14 text-xs text-slate-500">業種</span>
          <Chip active={!industry} onClick={() => setIndustry('')}>すべて</Chip>
          {industries.map(i => <Chip key={i} active={industry === i} onClick={() => setIndustry(i)} count={count(c => c.industry === i)}>{i}</Chip>)}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg bg-white py-10 text-center text-sm text-slate-400 ring-1 ring-slate-200">まだ事例がありません。「事例を追加」から登録してください。</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg bg-white py-10 text-center text-sm text-slate-400 ring-1 ring-slate-200">条件に合う事例がありません。</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map(c => (
            <button key={c.id} type="button" onClick={() => setOpenId(c.id)} className="flex flex-col gap-2 rounded-lg bg-white p-4 text-left ring-1 ring-slate-200 transition hover:ring-indigo-300">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <GoalBadges c={c} />
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">{c.industry}</span>
                <span>{c.area}</span>
                {c.telemaCompanyId && <span className="ml-auto inline-flex items-center gap-0.5 text-indigo-600" title="テレマリストのカルテと連携済み"><Link2 className="h-3 w-3" />カルテ</span>}
              </div>
              <h3 className="text-sm font-semibold text-slate-900">{titleOf(c)}</h3>
              {tagsOf(c).length > 0 && <div className="flex flex-wrap gap-1">{tagsOf(c).map(t => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t}</span>)}</div>}
              <div className="rounded-md bg-indigo-50 px-2.5 py-1.5 ring-1 ring-inset ring-indigo-100">
                <span className="mr-1.5 text-[11px] font-semibold text-indigo-700">成果</span>
                <span className="text-sm font-semibold text-slate-900"><Emph text={c.headline} /></span>
                {c.period && <span className="ml-2 text-xs text-slate-500">{c.period}</span>}
              </div>
              <p className="line-clamp-2 text-xs text-slate-600"><strong className="font-semibold">課題：</strong>{c.problem}</p>
            </button>
          ))}
        </div>
      )}

      {opened && !editing && (
        <CaseDetail
          c={opened}
          token={token}
          canEdit
          canDelete={canDelete(opened)}
          onEdit={() => setEditing({ initial: opened })}
          onDelete={() => remove(opened.id)}
          onClose={() => setOpenId(null)}
          onOpenTelemaCompany={onOpenTelemaCompany}
          onPdf={() => pdf([opened])}
        />
      )}
      {editing && <CaseForm initial={editing.initial} token={token} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

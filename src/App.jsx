import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Home, Users, PenTool, Plus, Search, Edit, X, Phone, MapPin, Save,
  Trash2, Package, Settings, CheckCircle, Filter, Mail, Globe,
  ChevronDown, Star, Instagram, Upload, Download, Copy, BarChart,
  Bot, Sparkles, Send, FileText, ClipboardList
} from 'lucide-react';

// ---------- 初期データ ----------
const initialProducts = [{ id: 1, name: 'SP-MEO' }, { id: 2, name: 'SP' }];

const initialActivityTypes = [
  { id: 1, name: 'テレアポ', flags: ['時間設定', '再コール', '拒否', '廃業', '接触済み拒否', '当日確認案件', '長期見込み'] },
  { id: 2, name: '初回訪問', flags: ['営業時間設定', '資料メール送り'] },
  { id: 3, name: '営業', flags: ['受注', '返事待ち', '返事待ちNG', 'NG'] },
  { id: 4, name: '過去ログ登録', flags: ['ユーザー', '過去営業履歴あり', '他者見込み', '営業提案NG'] },
];

const thisMonth = new Date().toISOString().substring(0, 7);
const initialGoals = { [thisMonth]: { timeSetting: 50, firstVisit: 20, sales: 10, order: 5 } };

const emptyCustomer = {
  id: null, gakuenName: '', enName: '', chairman: '', principal: '', address: '',
  tel: '', email: '', hpLink: '', instagram: '', gbpLink: '', reviewScore: '', reviewCount: '',
};

const initialEmailTemplates = [
  { id: 1, name: '初回訪問後の御礼', subject: '【御礼】お打ち合わせについて（{{学園名}} {{園名}} 様）',
    body: '{{学園名}}\n{{園名}}\n{{理事長}} 様\n\nいつも大変お世話になっております。\n\n本日はお忙しい中、お時間をいただき誠にありがとうございました。\n次回のご提案を準備してまいります。\n\n引き続き何卒よろしくお願い申し上げます。' },
];

const initialReportTemplates = [
  { id: 1, name: '基本報告フォーマット',
    body: '《法人》{{学園名}}\n《園名》{{園名}}\n《代表》{{理事長}}\n《住所》{{住所}}\n《URL》{{HPリンク}}\n《連絡先》{{TEL}}\n\n【5W1H】\n{{メモ}}\n\n【結果】\n{{結果}}' },
];

// ---------- テンプレート変数の置換 ----------
function fillTemplate(str, customer, extra = {}) {
  const map = {
    '{{学園名}}': customer?.gakuenName || '',
    '{{園名}}': customer?.enName || '',
    '{{理事長}}': customer?.chairman || '',
    '{{園長}}': customer?.principal || '',
    '{{住所}}': customer?.address || '',
    '{{TEL}}': customer?.tel || '',
    '{{メール}}': customer?.email || '',
    '{{HPリンク}}': customer?.hpLink || '',
    ...extra,
  };
  let out = str || '';
  Object.entries(map).forEach(([k, v]) => { out = out.split(k).join(v); });
  return out;
}

// ---------- CSV ヘルパー ----------
const CSV_FIELDS = [
  ['gakuenName', '学園名'], ['enName', '園名'], ['chairman', '理事長'], ['principal', '園長'],
  ['address', '住所'], ['tel', 'TEL'], ['email', 'メール'], ['hpLink', 'HPリンク'],
  ['instagram', 'InstagramURL'], ['gbpLink', 'GBPリンク'], ['reviewScore', '口コミ評価'], ['reviewCount', '口コミ件数'],
];

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function customersToCSV(customers) {
  const header = CSV_FIELDS.map(f => f[1]).join(',');
  const rows = customers.map(c => CSV_FIELDS.map(f => csvEscape(c[f[0]])).join(','));
  return [header, ...rows].join('\r\n');
}

function parseCSVText(text) {
  const rows = []; let cur = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

function downloadCustomersCSV(customers) {
  const blob = new Blob(['\uFEFF' + customersToCSV(customers)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `顧客リスト_${new Date().toISOString().substring(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- サーバー同期フック（/api/data 経由でデータベースと同期） ----------
function useSyncedData(initial) {
  const [data, setData] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const firstRender = useRef(true);

  // 起動時にサーバーから読み込む
  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(json => {
        setData(prev => ({ ...prev, ...json }));
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); setSyncError(true); });
  }, []);

  // データが変わるたびに（少し待ってから）サーバーへ保存する
  useEffect(() => {
    if (!loaded) return;
    if (firstRender.current) { firstRender.current = false; return; }
    const timer = setTimeout(() => {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then(res => { if (!res.ok) throw new Error(); setSyncError(false); })
        .catch(() => setSyncError(true));
    }, 800);
    return () => clearTimeout(timer);
  }, [data, loaded]);

  // customers / records などの各項目ごとに setCustomers のような関数を作る
  const makeSetter = (key) => (updater) => {
    setData(prev => ({ ...prev, [key]: typeof updater === 'function' ? updater(prev[key]) : updater }));
  };

  return { data, makeSetter, loaded, syncError };
}

// ---------- 共通UI部品 ----------
function FormField({ label, value, onChange, type = 'text', className = '', placeholder = '' }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
      />
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function CopyButton({ text, label = 'コピー', className = '' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
      copied ? 'bg-teal-100 text-teal-700' : 'bg-slate-700 text-white hover:bg-slate-600'
    } ${className}`}>
      <Copy className="w-3.5 h-3.5" />{copied ? 'コピーしました' : label}
    </button>
  );
}

function ProgressCard({ label, actual, goal, unit = '件' }) {
  const pct = goal > 0 ? Math.min(100, Math.round((actual / goal) * 100)) : 0;
  const over = goal > 0 && actual >= goal;
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-xs font-bold text-slate-500">{label}</span>
        <span className={`text-xs font-bold ${over ? 'text-teal-600' : 'text-slate-400'}`}>{pct}%</span>
      </div>
      <div className="flex items-baseline gap-1 mb-3">
        <span className="text-2xl font-extrabold text-slate-800">{actual}</span>
        <span className="text-sm text-slate-400">/ {goal}{unit}</span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${over ? 'bg-teal-500' : 'bg-indigo-400'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------- HOME ----------
function HomeView({ records, goals, setGoals }) {
  const [period, setPeriod] = useState(thisMonth);
  const months = useMemo(() => {
    const set = new Set([thisMonth]);
    records.forEach(r => set.add(r.date?.substring(0, 7)));
    return Array.from(set).filter(Boolean).sort();
  }, [records]);

  const filtered = period === 'all' ? records : records.filter(r => r.date?.startsWith(period));
  const count = (type, flag) => filtered.filter(r => r.type === type && (!flag || r.flag === flag)).length;

  const timeSetting = count('テレアポ', '時間設定');
  const firstVisit = count('初回訪問');
  const sales = count('営業');
  const order = filtered.filter(r => r.flag === '受注' || r.flag === 'ユーザー').length;

  const goal = goals[period] || { timeSetting: 0, firstVisit: 0, sales: 0, order: 0 };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal);

  const saveGoal = () => {
    setGoals({ ...goals, [period]: { ...draft } });
    setEditing(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">今月の実績</h2>
        <div className="flex items-center gap-2">
          <select value={period} onChange={e => setPeriod(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="all">全期間</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {period !== 'all' && (
            <button onClick={() => { setDraft(goal); setEditing(true); }} className="px-3 py-2 text-sm font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">目標設定</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ProgressCard label="時間設定" actual={timeSetting} goal={goal.timeSetting} />
        <ProgressCard label="初回訪問" actual={firstVisit} goal={goal.firstVisit} />
        <ProgressCard label="営業" actual={sales} goal={goal.sales} />
        <ProgressCard label="受注" actual={order} goal={goal.order} />
      </div>

      {editing && (
        <Modal title={`${period} の目標設定`} onClose={() => setEditing(false)}>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="時間設定 目標" type="number" value={draft.timeSetting} onChange={e => setDraft({ ...draft, timeSetting: Number(e.target.value) })} />
            <FormField label="初回訪問 目標" type="number" value={draft.firstVisit} onChange={e => setDraft({ ...draft, firstVisit: Number(e.target.value) })} />
            <FormField label="営業 目標" type="number" value={draft.sales} onChange={e => setDraft({ ...draft, sales: Number(e.target.value) })} />
            <FormField label="受注 目標" type="number" value={draft.order} onChange={e => setDraft({ ...draft, order: Number(e.target.value) })} />
          </div>
          <button onClick={saveGoal} className="mt-5 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">保存する</button>
        </Modal>
      )}

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-bold text-slate-600 mb-3">最近の記録</h3>
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400">まだ記録がありません。「顧客リスト」から顧客を選んで記録を追加してください。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.slice().reverse().slice(0, 8).map(r => (
              <li key={r.id} className="py-2.5 flex justify-between items-center text-sm">
                <div>
                  <span className="font-semibold text-slate-700">{r.customerName || '不明な顧客'}</span>
                  <span className="ml-2 text-slate-400">{r.type}{r.flag ? `（${r.flag}）` : ''}</span>
                </div>
                <span className="text-xs text-slate-400">{r.date}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- 顧客編集モーダル ----------
function CustomerModal({ customer, onSave, onClose }) {
  const [form, setForm] = useState(customer || emptyCustomer);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title={form.id ? '顧客情報を編集' : '新規顧客登録'} onClose={onClose} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="学園名" value={form.gakuenName} onChange={set('gakuenName')} />
        <FormField label="園名" value={form.enName} onChange={set('enName')} />
        <FormField label="理事長" value={form.chairman} onChange={set('chairman')} />
        <FormField label="園長" value={form.principal} onChange={set('principal')} />
        <FormField label="住所" value={form.address} onChange={set('address')} className="md:col-span-2" />
        <FormField label="TEL" value={form.tel} onChange={set('tel')} />
        <FormField label="メールアドレス" value={form.email} onChange={set('email')} />
        <FormField label="HPリンク" value={form.hpLink} onChange={set('hpLink')} />
        <FormField label="Instagram URL" value={form.instagram} onChange={set('instagram')} />
        <FormField label="GBPリンク" value={form.gbpLink} onChange={set('gbpLink')} />
        <FormField label="口コミ評価（★の数）" type="number" value={form.reviewScore} onChange={set('reviewScore')} />
        <FormField label="口コミ件数" type="number" value={form.reviewCount} onChange={set('reviewCount')} />
      </div>
      <button
        onClick={() => onSave({ ...form, id: form.id || Date.now() })}
        className="mt-6 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 flex items-center justify-center gap-2"
      >
        <Save className="w-4 h-4" /> 保存する
      </button>
    </Modal>
  );
}

// ---------- 報告文ジェネレーター ----------
function ReportGenerator({ customer, reportTemplates, latestRecord }) {
  const [templateId, setTemplateId] = useState(reportTemplates[0]?.id || '');
  const [memo, setMemo] = useState(latestRecord?.memo || '');
  const [result, setResult] = useState('');
  const template = reportTemplates.find(t => t.id === Number(templateId)) || reportTemplates[0];
  const text = template ? fillTemplate(template.body, customer, { '{{メモ}}': memo, '{{結果}}': result }) : '';

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="text-xs font-semibold text-slate-500">フォーマット</label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            {reportTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">メモ（5W1H）</label>
          <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">結果</label>
          <textarea value={result} onChange={e => setResult(e.target.value)} rows={3} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <pre className="text-xs whitespace-pre-wrap font-sans text-slate-700">{text}</pre>
      </div>
      <CopyButton text={text} label="報告文をコピー" />
    </div>
  );
}

// ---------- 顧客詳細（活動履歴＋記録登録）モーダル ----------
function CustomerDetailModal({ customer, records, setRecords, activityTypes, products, reportTemplates, showAlert, onClose, onEdit, startWithForm }) {
  const history = records.filter(r => r.customerId === customer.id).slice().reverse();
  const [showForm, setShowForm] = useState(!!startWithForm);
  const [showReport, setShowReport] = useState(false);

  return (
    <Modal title={customer.enName || customer.gakuenName} onClose={onClose} wide>
      <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-5">
        {customer.tel && <a href={`tel:${customer.tel}`} className="flex items-center gap-1 text-teal-700 font-semibold"><Phone className="w-4 h-4" />{customer.tel}</a>}
        {customer.address && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{customer.address}</span>}
        {customer.hpLink && <a href={customer.hpLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-600"><Globe className="w-4 h-4" />HP</a>}
        {customer.instagram && <a href={customer.instagram} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-pink-600"><Instagram className="w-4 h-4" />Instagram</a>}
        {customer.reviewScore && <span className="flex items-center gap-1 text-amber-500"><Star className="w-4 h-4 fill-amber-400" />{customer.reviewScore}（{customer.reviewCount || 0}件）</span>}
      </div>

      <div className="flex flex-wrap gap-4 mb-5">
        <button onClick={() => onEdit(customer)} className="text-sm font-semibold text-teal-700 flex items-center gap-1"><Edit className="w-4 h-4" />基本情報を編集</button>
        <button onClick={() => setShowForm(v => !v)} className="text-sm font-semibold text-indigo-700 flex items-center gap-1">
          <PenTool className="w-4 h-4" />{showForm ? '記録フォームを閉じる' : '新しい記録を追加'}
        </button>
        <button onClick={() => setShowReport(v => !v)} className="text-sm font-semibold text-purple-700 flex items-center gap-1">
          <FileText className="w-4 h-4" />{showReport ? '報告文フォームを閉じる' : '報告文を作成'}
        </button>
      </div>

      {showReport && (
        <div className="mb-6">
          <ReportGenerator customer={customer} reportTemplates={reportTemplates} latestRecord={history[0]} />
        </div>
      )}

      {showForm && (
        <div className="mb-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
          <RecordFields
            customer={customer}
            setRecords={setRecords}
            activityTypes={activityTypes}
            products={products}
            showAlert={showAlert}
            onSaved={() => setShowForm(false)}
          />
        </div>
      )}

      <h4 className="text-sm font-bold text-slate-600 mb-2">活動履歴タイムライン</h4>
      {history.length === 0 ? (
        <p className="text-sm text-slate-400">記録がありません。</p>
      ) : (
        <ul className="space-y-2">
          {history.map(r => (
            <li key={r.id} className="bg-slate-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-700">{r.type}{r.flag ? `（${r.flag}）` : ''}</span>
                <span className="text-xs text-slate-400">{r.date} {r.time}</span>
              </div>
              {r.memo && <p className="text-slate-500 mt-1">{r.memo}</p>}
              {r.productName && <p className="text-amber-700 mt-1 text-xs">受注: {r.productName} / 月額{r.monthlyFee || 0} / {r.years || 0}年 / 台数{r.quantity || 0} / 粗利{r.profit || 0}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ---------- 顧客リスト ----------
function CustomersView({ customers, setCustomers, records, setRecords, activityTypes, products, reportTemplates, showAlert, showConfirm }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // customer being edited, or {} for new
  const [viewing, setViewing] = useState(null); // customer being viewed
  const [viewingWithForm, setViewingWithForm] = useState(false);
  const fileInputRef = useRef(null);

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSVText(String(ev.target.result));
      if (rows.length < 2) { showAlert('データを読み取れませんでした。'); return; }
      const header = rows[0].map(h => h.trim());
      const labelToKey = Object.fromEntries(CSV_FIELDS.map(([k, l]) => [l, k]));
      const keyForCol = header.map(h => labelToKey[h] || null);
      const imported = rows.slice(1).map(r => {
        const obj = { id: Date.now() + Math.floor(Math.random() * 100000) };
        keyForCol.forEach((key, i) => { if (key) obj[key] = r[i] || ''; });
        return obj;
      }).filter(c => c.enName || c.gakuenName);
      setCustomers(prev => [...prev, ...imported]);
      showAlert(`${imported.length}件の顧客データを取り込みました。`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  };

  const filtered = customers.filter(c => {
    const q = search.toLowerCase();
    return !q || [c.gakuenName, c.enName, c.chairman, c.principal].some(v => (v || '').toLowerCase().includes(q));
  });

  const saveCustomer = (c) => {
    setCustomers(prev => {
      const exists = prev.some(p => p.id === c.id);
      return exists ? prev.map(p => p.id === c.id ? c : p) : [...prev, c];
    });
    setEditing(null);
    setViewing(v => v && v.id === c.id ? c : v);
  };

  const deleteCustomer = (id) => {
    showConfirm('この顧客を削除しますか？関連する活動履歴も削除されます。', () => {
      setCustomers(prev => prev.filter(c => c.id !== id));
      setViewing(null);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="園名・理事長・園長で検索"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">{filtered.length}件</span>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
            <Upload className="w-4 h-4" /> CSVインポート
          </button>
          <button onClick={() => downloadCustomersCSV(customers)} className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
            <Download className="w-4 h-4" /> CSV出力
          </button>
          <button onClick={() => setEditing(emptyCustomer)} className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700">
            <Plus className="w-4 h-4" /> 新規登録
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(c => {
          const latest = records.filter(r => r.customerId === c.id).slice(-1)[0];
          return (
            <div key={c.id} onClick={() => setViewing(c)} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden cursor-pointer hover:shadow-md hover:border-teal-200 transition">
              <div className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs text-slate-400">{c.gakuenName}</p>
                    <p className="font-bold text-slate-800">{c.enName || '（園名未登録）'}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); setViewing(c); setViewingWithForm(true); }} className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="記録登録">
                      <PenTool className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteCustomer(c.id); }} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  {c.tel && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{c.tel}</p>}
                  {c.address && <p className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{c.address}</p>}
                </div>
              </div>
              <div className="bg-slate-50 px-4 py-2.5 text-xs text-slate-500 border-t border-slate-100">
                {latest ? `最新: ${latest.type}${latest.flag ? `（${latest.flag}）` : ''} - ${latest.date}` : '活動記録なし'}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-sm text-slate-400 col-span-full text-center py-10">該当する顧客がいません。新規登録してから記録を追加してください。</p>}
      </div>

      {editing && <CustomerModal customer={editing.id ? editing : null} onSave={saveCustomer} onClose={() => setEditing(null)} />}
      {viewing && (
        <CustomerDetailModal
          customer={viewing}
          records={records}
          setRecords={setRecords}
          activityTypes={activityTypes}
          products={products}
          reportTemplates={reportTemplates}
          showAlert={showAlert}
          startWithForm={viewingWithForm}
          onClose={() => { setViewing(null); setViewingWithForm(false); }}
          onEdit={(c) => setEditing(c)}
        />
      )}
    </div>
  );
}

// ---------- 記録登録フォーム（顧客詳細モーダルの中で使う） ----------
function RecordFields({ customer, setRecords, activityTypes, products, showAlert, onSaved }) {
  const now = new Date();
  const [type, setType] = useState(activityTypes[0]?.name || '');
  const [flag, setFlag] = useState('');
  const [date, setDate] = useState(now.toISOString().substring(0, 10));
  const [time, setTime] = useState(now.toTimeString().substring(0, 5));
  const [memo, setMemo] = useState('');
  const [productName, setProductName] = useState(products[0]?.name || '');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [years, setYears] = useState('');
  const [quantity, setQuantity] = useState('');
  const [profit, setProfit] = useState('');

  const currentFlags = activityTypes.find(a => a.name === type)?.flags || [];
  const isOrder = flag === '受注' || flag === 'ユーザー';

  const reset = () => { setFlag(''); setMemo(''); setMonthlyFee(''); setYears(''); setQuantity(''); setProfit(''); };

  const save = () => {
    setRecords(prev => [...prev, {
      id: Date.now(), customerId: customer.id, customerName: customer.enName || customer.gakuenName,
      type, flag, date, time, memo,
      ...(isOrder ? { productName, monthlyFee, years, quantity, profit } : {}),
    }]);
    showAlert('記録を保存しました。');
    reset();
    onSaved && onSaved();
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">活動種別</label>
          <select value={type} onChange={e => { setType(e.target.value); setFlag(''); }} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            {activityTypes.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">結果フラグ</label>
          <select value={flag} onChange={e => setFlag(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">なし</option>
            {currentFlags.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <FormField label="日付" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <FormField label="時間" type="time" value={time} onChange={e => setTime(e.target.value)} />
      </div>

      {isOrder && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-amber-700">受注詳細</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">商品名</label>
              <select value={productName} onChange={e => setProductName(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                {products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <FormField label="月額" type="number" value={monthlyFee} onChange={e => setMonthlyFee(e.target.value)} />
            <FormField label="年数" type="number" value={years} onChange={e => setYears(e.target.value)} />
            <FormField label="台数" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
            <FormField label="営業粗利（P）" type="number" value={profit} onChange={e => setProfit(e.target.value)} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">メモ（5W1H）</label>
        <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={4}
          className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      <button onClick={save} className="w-full py-3 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 flex items-center justify-center gap-2">
        <Save className="w-4 h-4" /> 記録を保存する
      </button>
    </div>
  );
}

// ---------- メール制作 ----------
function EmailBuilderView({ customers, emailTemplates, setEmailTemplates, showAlert, showConfirm }) {
  const [innerTab, setInnerTab] = useState('compose');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [templateId, setTemplateId] = useState(emailTemplates[0]?.id || '');
  const [editingTpl, setEditingTpl] = useState(null);

  const customer = customers.find(c => c.id === Number(customerId));
  const template = emailTemplates.find(t => t.id === Number(templateId));
  const subject = customer && template ? fillTemplate(template.subject, customer) : '';
  const body = customer && template ? fillTemplate(template.body, customer) : '';

  const filteredCustomers = customers.filter(c => {
    const q = search.toLowerCase();
    return !q || (c.enName || c.gakuenName || '').toLowerCase().includes(q);
  });

  const saveTpl = (tpl) => {
    setEmailTemplates(prev => {
      const exists = prev.some(p => p.id === tpl.id);
      return exists ? prev.map(p => p.id === tpl.id ? tpl : p) : [...prev, tpl];
    });
    setEditingTpl(null);
  };

  const deleteTpl = (id) => {
    showConfirm('このフォーマットを削除しますか？', () => setEmailTemplates(prev => prev.filter(p => p.id !== id)));
  };

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <button onClick={() => setInnerTab('compose')} className={`px-4 py-2 rounded-lg text-sm font-bold ${innerTab === 'compose' ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>メール作成</button>
        <button onClick={() => setInnerTab('templates')} className={`px-4 py-2 rounded-lg text-sm font-bold ${innerTab === 'templates' ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>フォーマット管理</button>
      </div>

      {innerTab === 'compose' && (
        <div className="max-w-2xl space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">対象法人（園名で検索）</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="検索..." className="px-3 py-2 border border-slate-200 rounded-lg text-sm mb-1" />
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">選択してください</option>
              {filteredCustomers.map(c => <option key={c.id} value={c.id}>{c.enName || c.gakuenName}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">メールフォーマット</label>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
              {emailTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {customer && template && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">宛先</p>
                <p className="text-sm">{customer.email || <span className="text-red-400">メールアドレス未登録</span>}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">件名</p>
                <p className="text-sm">{subject}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">本文</p>
                <pre className="text-xs whitespace-pre-wrap font-sans text-slate-700">{body}</pre>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <CopyButton text={`件名: ${subject}\n\n${body}`} label="全文コピー" />
                <a href={`mailto:${customer.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700">
                  <Mail className="w-3.5 h-3.5" />メーラーで開く
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {innerTab === 'templates' && (
        <div className="max-w-2xl space-y-3">
          <button onClick={() => setEditingTpl({ id: null, name: '', subject: '', body: '' })} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold">
            <Plus className="w-4 h-4" />新しいフォーマット
          </button>
          <ul className="space-y-2">
            {emailTemplates.map(t => (
              <li key={t.id} className="bg-white border border-slate-200 rounded-lg p-3 flex justify-between items-start">
                <div>
                  <p className="text-sm font-bold text-slate-700">{t.name}</p>
                  <p className="text-xs text-slate-400">{t.subject}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingTpl(t)} className="p-1.5 text-slate-400 hover:text-teal-600"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => deleteTpl(t.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400 pt-2">利用可能な変数: {'{{学園名}} {{園名}} {{理事長}} {{園長}} {{住所}} {{TEL}} {{メール}} {{HPリンク}}'}</p>
        </div>
      )}

      {editingTpl && (
        <Modal title={editingTpl.id ? 'フォーマットを編集' : '新しいフォーマット'} onClose={() => setEditingTpl(null)}>
          <div className="space-y-3">
            <FormField label="フォーマット名" value={editingTpl.name} onChange={e => setEditingTpl({ ...editingTpl, name: e.target.value })} />
            <FormField label="件名" value={editingTpl.subject} onChange={e => setEditingTpl({ ...editingTpl, subject: e.target.value })} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">本文</label>
              <textarea value={editingTpl.body} onChange={e => setEditingTpl({ ...editingTpl, body: e.target.value })} rows={8}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
          </div>
          <button onClick={() => saveTpl({ ...editingTpl, id: editingTpl.id || Date.now() })}
            className="mt-5 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">保存する</button>
        </Modal>
      )}
    </div>
  );
}

// ---------- テレアポ集計 ----------
function getWeekKey(dateStr) {
  const d = new Date(dateStr);
  const first = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - first) / 86400000);
  const week = Math.ceil((days + first.getDay() + 1) / 7);
  return `${d.getFullYear()}年 第${week}週`;
}

function TeleApptStatsView({ records, activityTypes }) {
  const [granularity, setGranularity] = useState('day');
  const teleRecords = records.filter(r => r.type === 'テレアポ');
  const flags = activityTypes.find(a => a.name === 'テレアポ')?.flags || [];

  const keyFn = granularity === 'day' ? (r => r.date) : granularity === 'week' ? (r => getWeekKey(r.date)) : (r => r.date?.substring(0, 7));

  const groups = useMemo(() => {
    const map = {};
    teleRecords.forEach(r => {
      const key = keyFn(r);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [teleRecords, granularity]);

  const buildReport = (label, items) => {
    const total = items.length;
    const lines = [`${label} テレアポ結果`, `総件数: ${total}件`];
    flags.forEach(f => {
      const n = items.filter(i => i.flag === f).length;
      if (n > 0) lines.push(`${f}: ${n}件（${total ? Math.round(n / total * 100) : 0}%）`);
    });
    return lines.join('\n');
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[['day', '日別'], ['week', '週別'], ['month', '月別']].map(([v, l]) => (
          <button key={v} onClick={() => setGranularity(v)} className={`px-4 py-2 rounded-lg text-sm font-bold ${granularity === v ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{l}</button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-slate-400">テレアポの記録がまだありません。</p>
      ) : (
        <div className="space-y-3">
          {groups.map(([key, items]) => (
            <div key={key} className="bg-white rounded-xl border border-slate-100 p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-700">{key}</p>
                  <p className="text-xs text-slate-400">総件数 {items.length}件</p>
                </div>
                <CopyButton text={buildReport(key, items)} label="レポートをコピー" />
              </div>
              <div className="flex flex-wrap gap-2">
                {flags.map(f => {
                  const n = items.filter(i => i.flag === f).length;
                  if (n === 0) return null;
                  return <span key={f} className="px-2.5 py-1 bg-slate-100 rounded-full text-xs text-slate-600">{f}: {n}件</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- AIアシスタント（ローカル集計ベース） ----------
function answerLocally(question, customers, records) {
  const q = question.trim();
  const qLower = q.toLowerCase();

  // 特定の顧客名にヒットするか
  const hit = customers.find(c => q.includes(c.enName) || (c.gakuenName && q.includes(c.gakuenName)));
  if (hit) {
    const hist = records.filter(r => r.customerId === hit.id).slice().reverse();
    if (hist.length === 0) return `${hit.enName || hit.gakuenName} の活動記録はまだありません。`;
    const latest = hist[0];
    return `${hit.enName || hit.gakuenName} の最新の状況:\n・${latest.date} ${latest.type}${latest.flag ? `（${latest.flag}）` : ''}\n・これまでの記録件数: ${hist.length}件\n${latest.memo ? `・メモ: ${latest.memo}` : ''}`;
  }

  const today = new Date().toISOString().substring(0, 10);
  if (q.includes('今日')) {
    const todays = records.filter(r => r.date === today);
    if (todays.length === 0) return '本日の活動記録はまだありません。';
    return `本日の活動（${todays.length}件）:\n` + todays.map(r => `・${r.customerName || '不明'}：${r.type}${r.flag ? `（${r.flag}）` : ''}`).join('\n');
  }

  if (q.includes('今月') || q.includes('実績')) {
    const month = today.substring(0, 7);
    const monthly = records.filter(r => r.date?.startsWith(month));
    const byType = {};
    monthly.forEach(r => { byType[r.type] = (byType[r.type] || 0) + 1; });
    if (monthly.length === 0) return '今月はまだ記録がありません。';
    return `今月の実績（${month}）:\n` + Object.entries(byType).map(([t, n]) => `・${t}: ${n}件`).join('\n');
  }

  if (q.includes('受注')) {
    const orders = records.filter(r => r.flag === '受注' || r.flag === 'ユーザー');
    if (orders.length === 0) return 'まだ受注記録がありません。';
    return `受注件数: ${orders.length}件\n直近の受注:\n` + orders.slice(-5).reverse().map(r => `・${r.customerName || '不明'}（${r.date}）`).join('\n');
  }

  return 'ローカル集計アシスタントです。「〇〇園の状況は？」「今日の活動を要約して」「今月の実績は？」「受注状況は？」のように聞いてみてください。\n※本格的なAI（文章生成など）を使うには、APIキーを安全に扱うための簡単なバックエンドを別途追加する必要があります。ご希望であれば実装をお手伝いします。';
}

function AIAssistantView({ customers, records }) {
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'こんにちは。顧客データや活動記録について質問してください（例：「〇〇園の状況は？」「今月の実績は？」）。' },
  ]);
  const [input, setInput] = useState('');

  const send = () => {
    if (!input.trim()) return;
    const question = input.trim();
    const answer = answerLocally(question, customers, records);
    setMessages(prev => [...prev, { role: 'user', text: question }, { role: 'ai', text: answer }]);
    setInput('');
  };

  return (
    <div className="max-w-2xl flex flex-col h-[70vh] bg-white rounded-xl border border-slate-100 shadow-sm">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <Bot className="w-5 h-5 text-indigo-600" />
        <p className="text-sm font-bold text-slate-700">ローカル集計アシスタント</p>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-teal-600 text-white rounded-br-sm' : 'bg-slate-100 text-slate-700 rounded-bl-sm'
            }`}>{m.text}</div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-slate-100 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="質問を入力..." className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm" />
        <button onClick={send} className="p-2.5 bg-teal-600 text-white rounded-lg"><Send className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

// ---------- 設定・管理（報告フォーマット／データ運用） ----------
function SettingsView({ reportTemplates, setReportTemplates, showConfirm }) {
  const [editingTpl, setEditingTpl] = useState(null);

  const saveTpl = (tpl) => {
    setReportTemplates(prev => {
      const exists = prev.some(p => p.id === tpl.id);
      return exists ? prev.map(p => p.id === tpl.id ? tpl : p) : [...prev, tpl];
    });
    setEditingTpl(null);
  };

  const deleteTpl = (id) => {
    showConfirm('このフォーマットを削除しますか？', () => setReportTemplates(prev => prev.filter(p => p.id !== id)));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><ClipboardList className="w-4 h-4" />報告フォーマット管理</h3>
        <button onClick={() => setEditingTpl({ id: null, name: '', body: '' })} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold mb-3">
          <Plus className="w-4 h-4" />新しいフォーマット
        </button>
        <ul className="space-y-2">
          {reportTemplates.map(t => (
            <li key={t.id} className="bg-slate-50 rounded-lg p-3 flex justify-between items-start">
              <p className="text-sm font-bold text-slate-700">{t.name}</p>
              <div className="flex gap-1">
                <button onClick={() => setEditingTpl(t)} className="p-1.5 text-slate-400 hover:text-teal-600"><Edit className="w-4 h-4" /></button>
                <button onClick={() => deleteTpl(t.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-400 pt-3">利用可能な変数: {'{{学園名}} {{園名}} {{理事長}} {{園長}} {{住所}} {{TEL}} {{HPリンク}} {{メモ}} {{結果}}'}</p>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Globe className="w-4 h-4" />スプレッドシートとの連携について</h3>
        <p className="text-sm text-slate-600 leading-relaxed">
          このアプリはデータをこの端末（ブラウザ）に保存する仕組みのため、Googleスプレッドシートと自動で常時同期することはできません。
        </p>
        <p className="text-sm text-slate-600 leading-relaxed mt-2">
          代わりに「顧客リスト」画面の <strong>CSV出力</strong> ボタンで最新データをダウンロードし、スプレッドシートに貼り付けてください。逆にスプレッドシート側の情報をこのアプリに取り込みたい場合は、スプレッドシートを「CSV形式（UTF-8）」で書き出し、<strong>CSVインポート</strong> ボタンから読み込んでください。
        </p>
        <p className="text-xs text-slate-400 mt-3">
          ※本格的な自動同期（複数人でのリアルタイム共有）が必要な場合は、認証情報を安全に扱うための簡易サーバーを別途用意する必要があります。ご希望であれば構成をお手伝いします。
        </p>
      </div>

      {editingTpl && (
        <Modal title={editingTpl.id ? 'フォーマットを編集' : '新しいフォーマット'} onClose={() => setEditingTpl(null)}>
          <div className="space-y-3">
            <FormField label="フォーマット名" value={editingTpl.name} onChange={e => setEditingTpl({ ...editingTpl, name: e.target.value })} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">本文</label>
              <textarea value={editingTpl.body} onChange={e => setEditingTpl({ ...editingTpl, body: e.target.value })} rows={8}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
          </div>
          <button onClick={() => saveTpl({ ...editingTpl, id: editingTpl.id || Date.now() })}
            className="mt-5 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">保存する</button>
        </Modal>
      )}
    </div>
  );
}

// ---------- 商品・フラグ管理 ----------
function ProductsAndFlagsView({ products, setProducts, activityTypes, setActivityTypes }) {
  const [newProduct, setNewProduct] = useState('');
  const [newType, setNewType] = useState('');
  const [flagDraft, setFlagDraft] = useState({});

  const addProduct = () => {
    if (!newProduct.trim()) return;
    setProducts([...products, { id: Date.now(), name: newProduct.trim() }]);
    setNewProduct('');
  };

  const addType = () => {
    if (!newType.trim()) return;
    setActivityTypes([...activityTypes, { id: Date.now(), name: newType.trim(), flags: [] }]);
    setNewType('');
  };

  const addFlag = (typeId) => {
    const val = (flagDraft[typeId] || '').trim();
    if (!val) return;
    setActivityTypes(activityTypes.map(a => a.id === typeId ? { ...a, flags: [...a.flags, val] } : a));
    setFlagDraft({ ...flagDraft, [typeId]: '' });
  };

  const removeFlag = (typeId, flag) => {
    setActivityTypes(activityTypes.map(a => a.id === typeId ? { ...a, flags: a.flags.filter(f => f !== flag) } : a));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Package className="w-4 h-4" />商品管理</h3>
        <div className="flex gap-2 mb-4">
          <input value={newProduct} onChange={e => setNewProduct(e.target.value)} placeholder="新しい商品名"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addProduct} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold">追加</button>
        </div>
        <ul className="space-y-1.5">
          {products.map(p => (
            <li key={p.id} className="flex justify-between items-center px-3 py-2 bg-slate-50 rounded-lg text-sm">
              {p.name}
              <button onClick={() => setProducts(products.filter(x => x.id !== p.id))} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Filter className="w-4 h-4" />活動種別・結果フラグ管理</h3>
        <div className="flex gap-2 mb-4">
          <input value={newType} onChange={e => setNewType(e.target.value)} placeholder="新しい活動種別"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addType} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold">追加</button>
        </div>
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {activityTypes.map(a => (
            <div key={a.id} className="border border-slate-100 rounded-lg p-3">
              <p className="text-sm font-bold text-slate-700 mb-2">{a.name}</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {a.flags.map(f => (
                  <span key={f} className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-xs">
                    {f}
                    <button onClick={() => removeFlag(a.id, f)}><X className="w-3 h-3 text-slate-400 hover:text-red-500" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={flagDraft[a.id] || ''} onChange={e => setFlagDraft({ ...flagDraft, [a.id]: e.target.value })}
                  placeholder="フラグを追加" className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs" />
                <button onClick={() => addFlag(a.id)} className="px-3 py-1.5 bg-slate-700 text-white rounded text-xs font-bold">追加</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- ナビ ----------
function NavItem({ icon, label, isActive, onClick }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-5 py-3 text-left text-sm font-medium transition-colors ${
      isActive ? 'bg-slate-700 text-white border-l-4 border-teal-400' : 'text-slate-300 hover:bg-slate-700/60 border-l-4 border-transparent'
    }`}>
      {icon}{label}
    </button>
  );
}

// ---------- App ----------
export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const { data, makeSetter, loaded: dataLoaded, syncError } = useSyncedData({
    customers: [], records: [], products: initialProducts, activityTypes: initialActivityTypes,
    goals: initialGoals, emailTemplates: initialEmailTemplates, reportTemplates: initialReportTemplates,
  });
  const { customers, records, products, activityTypes, goals, emailTemplates, reportTemplates } = data;
  const setCustomers = makeSetter('customers');
  const setRecords = makeSetter('records');
  const setProducts = makeSetter('products');
  const setActivityTypes = makeSetter('activityTypes');
  const setGoals = makeSetter('goals');
  const setEmailTemplates = makeSetter('emailTemplates');
  const setReportTemplates = makeSetter('reportTemplates');
  const [alertMsg, setAlertMsg] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const showAlert = (msg) => setAlertMsg(msg);
  const showConfirm = (msg, onConfirm) => setConfirmState({ msg, onConfirm });

  const menuItems = [
    { id: 'home', icon: <Home className="w-4 h-4" />, label: 'HOME' },
    { id: 'customers', icon: <Users className="w-4 h-4" />, label: '顧客リスト' },
    { id: 'teleappt_stats', icon: <BarChart className="w-4 h-4" />, label: 'テレアポ集計' },
    { id: 'email', icon: <Mail className="w-4 h-4" />, label: 'メール制作' },
    { id: 'ai', icon: <Sparkles className="w-4 h-4" />, label: 'AIアシスタント' },
    { id: 'products', icon: <Package className="w-4 h-4" />, label: '商品・フラグ管理' },
    { id: 'settings', icon: <Settings className="w-4 h-4" />, label: '設定・管理' },
  ];

  const titles = {
    home: 'HOME', customers: '顧客リスト', teleappt_stats: 'テレアポ集計', email: 'メール制作',
    ai: 'AIアシスタント', products: '商品・フラグ管理', settings: '設定・管理',
  };

  if (!dataLoaded) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-50 flex-col">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mb-4" />
        <p className="text-slate-400 font-bold text-sm">データを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {/* モバイルヘッダー */}
      <header className="md:hidden fixed top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-slate-800 text-white z-30">
        <button onClick={() => setMenuOpen(true)} className="p-1"><LayoutMenuIcon /></button>
        <h1 className="font-bold text-sm">CRMシステム</h1>
        <div className="w-6" />
      </header>

      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <div className="w-64 bg-slate-800 h-full relative z-10 flex flex-col pt-4">
            <button onClick={() => setMenuOpen(false)} className="absolute top-3 right-3 text-white"><X className="w-5 h-5" /></button>
            <div className="px-5 py-3 text-white font-bold border-b border-slate-700 mb-2">CRMシステム</div>
            {menuItems.map(m => <NavItem key={m.id} {...m} isActive={activeTab === m.id} onClick={() => { setActiveTab(m.id); setMenuOpen(false); }} />)}
          </div>
        </div>
      )}

      {/* デスクトップサイドバー */}
      <aside className="hidden md:flex w-60 bg-slate-800 flex-col shrink-0">
        <div className="px-5 py-6 text-white font-bold text-lg border-b border-slate-700">CRMシステム</div>
        <nav className="flex-1 py-3">
          {menuItems.map(m => <NavItem key={m.id} {...m} isActive={activeTab === m.id} onClick={() => setActiveTab(m.id)} />)}
        </nav>
        <div className="px-5 py-4 text-[10px] flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${syncError ? 'bg-red-400' : 'bg-teal-400'}`} />
          <span className={syncError ? 'text-red-300' : 'text-slate-500'}>{syncError ? '保存に失敗しました（通信を確認してください）' : 'サーバーと同期中'}</span>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-16 md:pt-8">
        <h2 className="hidden md:block text-xl font-bold text-slate-800 mb-6">{titles[activeTab]}</h2>
        {activeTab === 'home' && <HomeView records={records} goals={goals} setGoals={setGoals} />}
        {activeTab === 'customers' && (
          <CustomersView
            customers={customers} setCustomers={setCustomers}
            records={records} setRecords={setRecords}
            activityTypes={activityTypes} products={products}
            reportTemplates={reportTemplates}
            showAlert={showAlert} showConfirm={showConfirm}
          />
        )}
        {activeTab === 'teleappt_stats' && <TeleApptStatsView records={records} activityTypes={activityTypes} />}
        {activeTab === 'email' && (
          <EmailBuilderView customers={customers} emailTemplates={emailTemplates} setEmailTemplates={setEmailTemplates} showAlert={showAlert} showConfirm={showConfirm} />
        )}
        {activeTab === 'ai' && <AIAssistantView customers={customers} records={records} />}
        {activeTab === 'products' && <ProductsAndFlagsView products={products} setProducts={setProducts} activityTypes={activityTypes} setActivityTypes={setActivityTypes} />}
        {activeTab === 'settings' && <SettingsView reportTemplates={reportTemplates} setReportTemplates={setReportTemplates} showConfirm={showConfirm} />}
      </main>

      {alertMsg && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full text-center">
            <CheckCircle className="w-10 h-10 text-teal-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-700 mb-5">{alertMsg}</p>
            <button onClick={() => setAlertMsg('')} className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold">OK</button>
          </div>
        </div>
      )}

      {confirmState && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <p className="text-sm font-medium text-slate-700 mb-5">{confirmState.msg}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmState(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium">キャンセル</button>
              <button onClick={() => { confirmState.onConfirm(); setConfirmState(null); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold">実行する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LayoutMenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Home, Users, PenTool, Plus, Search, Edit, X, Phone, MapPin, Save,
  Trash2, Package, Settings, CheckCircle, Filter, Mail, Globe,
  ChevronDown, Star, Camera, Upload, Download, Copy, BarChart,
  Bot, Sparkles, Send, FileText, ClipboardList, CalendarDays,
  ChevronLeft, ChevronRight, CheckSquare, Square, Mic, LayoutGrid, List,
  Heart, Video, MessageCircle, BookOpen, Briefcase, AlertTriangle
} from 'lucide-react';

// ---------- 初期データ ----------
const initialProducts = [{ id: 1, name: 'SP-MEO' }, { id: 2, name: 'SP' }];
const initialAssociationTypes = [];
const initialCaseStudies = [];
const initialKnowledgeArticles = [];
const initialKnowledgeTags = [
  { id: 1, name: 'テレアポ' },
  { id: 2, name: '営業' },
  { id: 3, name: '契約後の流れ' },
  { id: 4, name: '商材' },
  { id: 5, name: '制度・ルール' },
];
const initialDepartments = [
  { id: 1, name: 'WEB営業　東京　１課' },
  { id: 2, name: 'WEB営業　東京　２課' },
];

const initialActivityTypes = [
  { id: 1, name: 'テレアポ', flags: ['再コール', '留守電・不通', '初回時間設定（代表）', '初回時間設定（担当）', '飛び込み初回時間設定', '受付拒否', '代表接触拒否', '当日確認案件'] },
  { id: 2, name: '初回訪問', flags: ['営業時間設定', '資料メール送り'] },
  { id: 3, name: '営業（代表）', flags: ['返事待ち', '返事待ちNG', 'NG'] },
  { id: 6, name: '営業（担当）', flags: ['返事待ち', '返事待ちNG', 'NG'] },
  { id: 4, name: '過去ログ登録', flags: ['ユーザー', '過去営業履歴あり', '他者見込み', '営業提案NG'] },
  { id: 5, name: '受注登録', flags: ['受注'] },
  { id: 7, name: '法人被り', flags: ['法人被り', '受注'] },
];

const thisMonth = new Date().toISOString().substring(0, 7);
const initialGoals = { [thisMonth]: { timeSetting: 50, firstVisit: 20, salesTimeSetting: 15, order: 5, profit: 500000, quantity: 10 } };

const emptyCustomer = {
  id: null, gakuenName: '', gakuenNameKana: '', enName: '', enNameKana: '', associationType: '', chairman: '', principal: '', address: '',
  tel: '', mobile: '', email: '', hpLink: '', recruitSiteLink: '', hpVendor: '', instagram: '', gbpLink: '', reviewScore: '', reviewCount: '', assignedTo: '',
};

const initialEmailTemplates = [
  { id: 1, name: '初回訪問後の御礼', subject: '【御礼】お打ち合わせについて（{{法人名}} {{園名}} 様）',
    body: '{{法人名}}\n{{園名}}\n{{理事長}} 様\n\nいつも大変お世話になっております。\n\n本日はお忙しい中、お時間をいただき誠にありがとうございました。\n次回のご提案を準備してまいります。\n\n引き続き何卒よろしくお願い申し上げます。' },
];

const initialReportTemplates = [
  { id: 1, name: '基本報告フォーマット',
    body: '《法人》{{法人名}}\n《園名》{{園名}}\n《代表》{{理事長}}\n《住所》{{住所}}\n《URL》{{HPリンク}}\n《連絡先》{{TEL}}\n\n【5W1H】\n{{メモ}}\n\n【結果】\n{{結果}}' },
];

const initialDailyReportTemplates = [
  { id: 1, name: '標準日報フォーマット',
    body: '{{日付}} 日報\n\n【テレアポ】{{テレアポ件数}}件\n【初回訪問】{{初回訪問件数}}件\n【営業】{{営業件数}}件\n【受注】{{受注件数}}件（台数{{台数}} / 粗利{{営業P}}）\n\n【所感・特記事項】\n{{自由記述}}' },
];

// ---------- テンプレート変数の置換 ----------
function fillTemplate(str, customer, extra = {}) {
  const map = {
    '{{法人名}}': customer?.gakuenName || '',
    '{{学園名}}': customer?.gakuenName || '', // 旧テンプレート互換用
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

// ---------- 日報テンプレートの変数置換 ----------
function fillDailyReport(str, data) {
  const map = {
    '{{日付}}': data.date || '',
    '{{テレアポ件数}}': String(data.teleCount ?? 0),
    '{{初回訪問件数}}': String(data.visitCount ?? 0),
    '{{営業件数}}': String(data.salesCount ?? 0),
    '{{受注件数}}': String(data.orderCount ?? 0),
    '{{台数}}': String(data.quantity ?? 0),
    '{{営業P}}': String(data.profit ?? 0),
    '{{自由記述}}': data.freeText || '',
  };
  let out = str || '';
  Object.entries(map).forEach(([k, v]) => { out = out.split(k).join(v); });
  return out;
}

// ---------- 箇条書きメモを文章っぽく整える（簡易整形。生成AIではありません） ----------
function polishText(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '（特記事項なし）';
  return lines.map(l => (/[。！？]$/.test(l) ? l : l + '。')).join('\n');
}

// ---------- CSV ヘルパー ----------
// [キー, 出力時の見出し, 取り込み時に受け付ける他の見出し...]
const CSV_FIELDS = [
  ['gakuenName', '法人名', '学園名'], ['gakuenNameKana', '法人名ふりがな'],
  ['enName', '園名'], ['enNameKana', '園名ふりがな'],
  ['associationType', '協会の種類', '協会関係'],
  ['chairman', '理事長'], ['principal', '園長'],
  ['address', '住所'], ['tel', 'TEL'], ['mobile', '携帯番号'],
  ['email', 'メール', 'メールアドレス'],
  ['hpLink', 'HPリンク'], ['recruitSiteLink', '採用サイトリンク'], ['hpVendor', 'HP業者'],
  ['instagram', 'InstagramURL', 'Instagram'],
  ['gbpLink', 'GBPプロフィールリンク', 'GBPリンク'],
  ['reviewScore', '口コミ評価'],
  ['reviewCount', '口コミ件数', '口コミ数'],
];

// 活動履歴（記録）をCSVに含める際、1顧客につき何件までログ列を出力するか
const CSV_LOG_COLUMNS = 3;
// [キー, 出力時の見出し, 取り込み時に受け付ける他の見出し...]
const LOG_FIELD_SUFFIXES = [
  ['type', '種別', '活動種別'],
  ['flag', 'フラグ', '結果フラグ'],
  ['date', '日付'],
  ['time', '時間'],
  ['memo', 'メモ'],
  ['scheduledDate', '予定日付'],
  ['scheduledTime', '予定時間'],
];

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function customersToCSV(customers, records) {
  const logHeaders = [];
  for (let i = 1; i <= CSV_LOG_COLUMNS; i++) {
    LOG_FIELD_SUFFIXES.forEach(([, label]) => logHeaders.push(`ログ${i}_${label}`));
  }
  const header = [...CSV_FIELDS.map(f => f[1]), ...logHeaders].join(',');

  const rows = customers.map(c => {
    const baseCols = CSV_FIELDS.map(f => csvEscape(c[f[0]]));
    const custLogs = (records || [])
      .filter(r => r.customerId === c.id)
      .slice()
      .reverse() // 新しい順
      .slice(0, CSV_LOG_COLUMNS);
    const logCols = [];
    for (let i = 0; i < CSV_LOG_COLUMNS; i++) {
      const r = custLogs[i];
      LOG_FIELD_SUFFIXES.forEach(([key]) => logCols.push(csvEscape(r ? r[key] : '')));
    }
    return [...baseCols, ...logCols].join(',');
  });
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

function downloadCustomersCSV(customers, records, showAlert) {
  try {
    const blob = new Blob(['\uFEFF' + customersToCSV(customers, records)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers_${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('CSV export error:', err);
    showAlert && showAlert('CSVの出力中にエラーが発生しました。もう一度お試しください。');
  }
}

// ---------- 認証フック（ログイン状態の管理） ----------
function useAuth() {
  const [token, setToken] = useState(() => { try { return localStorage.getItem('crm_token'); } catch { return null; } });
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!token) { setAuthLoading(false); return; }
    fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(u => { setUser(u); setAuthLoading(false); })
      .catch(() => {
        setToken(null); setUser(null);
        try { localStorage.removeItem('crm_token'); } catch {}
        setAuthLoading(false);
      });
  }, [token]);

  const login = async (username, password) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ログインに失敗しました');
    setToken(data.token);
    setUser(data.user);
    try { localStorage.setItem('crm_token', data.token); } catch {}
  };

  const logout = () => {
    setToken(null); setUser(null);
    try { localStorage.removeItem('crm_token'); } catch {}
  };

  const updateUser = (patch) => setUser(prev => prev ? { ...prev, ...patch } : prev);

  return { token, user, authLoading, login, logout, updateUser };
}

// ---------- サーバー同期フック（/api/data 経由でデータベースと同期） ----------
function useSyncedData(initial, token, onUnauthorized) {
  const [data, setData] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const firstRender = useRef(true);

  // 起動時にサーバーから読み込む
  useEffect(() => {
    if (!token) return;
    fetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (res.status === 401) { onUnauthorized && onUnauthorized(); throw new Error('unauthorized'); }
        return res.json();
      })
      .then(json => {
        setData(prev => ({ ...prev, ...json }));
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); setSyncError(true); });
  }, [token]);

  // データが変わるたびに（少し待ってから）サーバーへ保存する
  useEffect(() => {
    if (!loaded || !token) return;
    if (firstRender.current) { firstRender.current = false; return; }
    const timer = setTimeout(() => {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      })
        .then(res => {
          if (res.status === 401) { onUnauthorized && onUnauthorized(); throw new Error('unauthorized'); }
          if (!res.ok) throw new Error();
          setSyncError(false);
        })
        .catch(() => setSyncError(true));
    }, 800);
    return () => clearTimeout(timer);
  }, [data, loaded, token]);

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
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[85dvh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 rounded-t-2xl">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
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

function ProgressCard({ label, actual, goal, unit = '件', onClick }) {
  const pct = goal > 0 ? Math.min(100, Math.round((actual / goal) * 100)) : 0;
  const over = goal > 0 && actual >= goal;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`bg-white rounded-xl p-4 shadow-sm border border-slate-100 text-left w-full ${onClick ? 'hover:shadow-md hover:border-teal-200 transition cursor-pointer' : ''}`}>
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
    </Tag>
  );
}

function RateCard({ label, rate, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`bg-white rounded-xl p-4 shadow-sm border border-slate-100 text-left w-full ${onClick ? 'hover:shadow-md hover:border-teal-200 transition cursor-pointer' : ''}`}>
      <div className="mb-2">
        <span className="text-xs font-bold text-slate-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mb-3">
        <span className="text-2xl font-extrabold text-slate-800">{rate}</span>
        <span className="text-sm text-slate-400">%</span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
    </Tag>
  );
}

// ---------- ログイン画面 ----------
function LoginView({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message || 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-xl font-bold text-slate-800">CRMシステム</h1>
          <p className="text-xs text-slate-400 mt-1">ログインしてください</p>
        </div>
        <FormField label="ユーザー名" value={username} onChange={e => setUsername(e.target.value)} />
        <FormField label="パスワード" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <button type="submit" disabled={loading} className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 disabled:opacity-50">
          {loading ? 'ログイン中...' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}

// ---------- HOME ----------
function HomeView({ records, customers, goals, setGoals, currentUser, isOwner, members, departments, onNavigate, onOpenCustomer }) {
  const [period, setPeriod] = useState(thisMonth);
  const [scopeType, setScopeType] = useState('personal'); // 'all' | 'department' | 'personal'
  const [scopeValue, setScopeValue] = useState(currentUser?.displayName || '');
  const months = useMemo(() => {
    const set = new Set([thisMonth]);
    records.forEach(r => set.add(r.date?.substring(0, 7)));
    return Array.from(set).filter(Boolean).sort();
  }, [records]);

  // 課に所属するメンバー名の一覧を取得
  const membersInDept = (deptName) => members.filter(m => m.department === deptName).map(m => m.displayName);

  // 記録に担当者が無い場合（CSV取込や担当者機能の追加前に作られた記録）は、
  // その顧客に設定されている担当者を担当者とみなして集計に含める
  const customerAssigneeById = useMemo(() => {
    const map = {};
    customers.forEach(c => { map[c.id] = c.assignedTo || ''; });
    return map;
  }, [customers]);
  const effectiveAssignee = (r) => r.assignedTo || customerAssigneeById[r.customerId] || '';

  const scopedRecords = (() => {
    if (scopeType === 'all') return records;
    if (scopeType === 'department') {
      const names = membersInDept(scopeValue);
      return records.filter(r => names.includes(effectiveAssignee(r)));
    }
    return records.filter(r => effectiveAssignee(r) === scopeValue);
  })();
  const filtered = period === 'all' ? scopedRecords : scopedRecords.filter(r => r.date?.startsWith(period));

  const scopeLabel = scopeType === 'all' ? '全体' : scopeType === 'department' ? `課: ${scopeValue || '未選択'}` : `個人: ${scopeValue || '未選択'}`;

  // 指標の計算（内訳表示のため、対象となった記録も保持しておく）
  const teleTimeSettingRecs = filtered.filter(r => r.type === 'テレアポ' && isInitialTimeSettingFlag(r.flag));
  const firstVisitRecs = filtered.filter(r => r.type === '初回訪問');
  const salesTimeSettingRecs = filtered.filter(r => r.type === '初回訪問' && r.flag === '営業時間設定');
  const orderRecords = filtered.filter(r => ['受注', 'ユーザー', '過去受注記録あり'].includes(r.flag));

  const teleTimeSetting = teleTimeSettingRecs.length; // 初回時間設定件数
  const firstVisitCount = firstVisitRecs.length; // 初回訪問件数
  const salesTimeSetting = salesTimeSettingRecs.length; // 営業時間設定件数
  const salesTimeSettingRate = firstVisitCount > 0 ? Math.round((salesTimeSetting / firstVisitCount) * 100) : 0; // 営業時間設定昇華率
  const orderCount = orderRecords.length; // 受注件数
  const profitSum = orderRecords.reduce((s, r) => s + (Number(r.profit) || 0), 0); // 営業粗利（P）
  const quantitySum = orderRecords.reduce((s, r) => s + (Number(r.quantity) || 0), 0); // 台数
  const closeRate = salesTimeSetting > 0 ? Math.round((orderCount / salesTimeSetting) * 100) : 0; // 営業落率

  // カードをクリックした時に表示する内訳
  const [drilldown, setDrilldown] = useState(null); // { title, records }
  const openDrilldown = (title, recs) => setDrilldown({ title, records: recs });

  const goal = goals[period] || { timeSetting: 0, firstVisit: 0, salesTimeSetting: 0, order: 0, profit: 0, quantity: 0 };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal);

  const saveGoal = () => {
    setGoals({ ...goals, [period]: { ...draft } });
    setEditing(false);
  };

  // 実績サマリーを表にしてPDF化（ブラウザの印刷機能でPDF保存）
  const exportPdf = () => {
    const rows = [
      ['初回時間設定件数', `${teleTimeSetting}件`, `${goal.timeSetting || 0}件`, goal.timeSetting > 0 ? `${Math.round(teleTimeSetting / goal.timeSetting * 100)}%` : '-'],
      ['初回訪問件数', `${firstVisitCount}件`, `${goal.firstVisit || 0}件`, goal.firstVisit > 0 ? `${Math.round(firstVisitCount / goal.firstVisit * 100)}%` : '-'],
      ['営業時間設定件数', `${salesTimeSetting}件`, `${goal.salesTimeSetting || 0}件`, goal.salesTimeSetting > 0 ? `${Math.round(salesTimeSetting / goal.salesTimeSetting * 100)}%` : '-'],
      ['営業時間設定昇華率', `${salesTimeSettingRate}%`, '-', '-'],
      ['受注件数', `${orderCount}件`, `${goal.order || 0}件`, goal.order > 0 ? `${Math.round(orderCount / goal.order * 100)}%` : '-'],
      ['営業粗利', `${profitSum}P`, `${goal.profit || 0}P`, goal.profit > 0 ? `${Math.round(profitSum / goal.profit * 100)}%` : '-'],
      ['台数', `${quantitySum}台`, `${goal.quantity || 0}台`, goal.quantity > 0 ? `${Math.round(quantitySum / goal.quantity * 100)}%` : '-'],
      ['営業落率', `${closeRate}%`, '-', '-'],
    ];
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>実績レポート</title>
<style>
  body { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; padding: 32px; color: #1e293b; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p.meta { font-size: 12px; color: #64748b; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
  th { background: #f1f5f9; font-weight: bold; }
  td.num { text-align: right; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>実績レポート</h1>
<p class="meta">対象: ${scopeLabel} ／ 期間: ${period === 'all' ? '全期間' : period} ／ 出力日: ${new Date().toISOString().substring(0, 10)}</p>
<table>
  <thead><tr><th>項目</th><th>実績</th><th>目標</th><th>達成率</th></tr></thead>
  <tbody>
    ${rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td></tr>`).join('')}
  </tbody>
</table>
<script>window.onload = function(){ window.print(); };<\/script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  // カレンダー：直近の予定（3件）
  const todayStr = new Date().toISOString().substring(0, 10);
  const upcoming = scopedRecords
    .filter(r => r.scheduledDate && r.scheduledDate >= todayStr)
    .slice()
    .sort((a, b) => (a.scheduledDate + (a.scheduledTime || '')).localeCompare(b.scheduledDate + (b.scheduledTime || '')))
    .slice(0, 3);

  // テレアポ集計：今日と今月の概要
  const teleToday = scopedRecords.filter(r => r.type === 'テレアポ' && r.date === todayStr).length;
  const teleMonth = scopedRecords.filter(r => r.type === 'テレアポ' && r.date?.startsWith(thisMonth)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">実績サマリー</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            {[['all', '全体'], ['department', '課'], ['personal', '個人']].map(([v, l]) => (
              <button key={v}
                onClick={() => {
                  setScopeType(v);
                  if (v === 'department') setScopeValue(currentUser?.department || (departments[0]?.name || ''));
                  else if (v === 'personal') setScopeValue(currentUser?.displayName || '');
                }}
                className={`px-3 py-2 text-sm font-bold ${scopeType === v ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {l}
              </button>
            ))}
          </div>
          {scopeType === 'department' && (
            <select value={scopeValue} onChange={e => setScopeValue(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">課を選択</option>
              {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          )}
          {scopeType === 'personal' && (
            <select value={scopeValue} onChange={e => setScopeValue(e.target.value)} disabled={!isOwner}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-50">
              {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
            </select>
          )}
          <select value={period} onChange={e => setPeriod(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="all">全期間</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {period !== 'all' && (
            <button onClick={() => { setDraft(goal); setEditing(true); }} className="px-3 py-2 text-sm font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">目標設定</button>
          )}
          <button onClick={exportPdf} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-slate-700 rounded-lg hover:bg-slate-600">
            <Download className="w-4 h-4" />PDF出力
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ProgressCard label="初回時間設定件数" actual={teleTimeSetting} goal={goal.timeSetting} onClick={() => openDrilldown('初回時間設定件数', teleTimeSettingRecs)} />
        <ProgressCard label="初回訪問件数" actual={firstVisitCount} goal={goal.firstVisit} onClick={() => openDrilldown('初回訪問件数', firstVisitRecs)} />
        <ProgressCard label="営業時間設定件数" actual={salesTimeSetting} goal={goal.salesTimeSetting} onClick={() => openDrilldown('営業時間設定件数', salesTimeSettingRecs)} />
        <RateCard label="営業時間設定昇華率" rate={salesTimeSettingRate} onClick={() => openDrilldown('営業時間設定昇華率の内訳（営業時間設定）', salesTimeSettingRecs)} />
        <ProgressCard label="受注件数" actual={orderCount} goal={goal.order} onClick={() => openDrilldown('受注件数', orderRecords)} />
        <ProgressCard label="営業粗利" actual={profitSum} goal={goal.profit} unit="P" onClick={() => openDrilldown('営業粗利の内訳', orderRecords)} />
        <ProgressCard label="台数" actual={quantitySum} goal={goal.quantity} unit="台" onClick={() => openDrilldown('台数の内訳', orderRecords)} />
        <RateCard label="営業落率" rate={closeRate} onClick={() => openDrilldown('営業落率の内訳（受注）', orderRecords)} />
      </div>

      {editing && (
        <Modal title={`${period} の目標設定`} onClose={() => setEditing(false)}>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="初回時間設定 目標" type="number" value={draft.timeSetting} onChange={e => setDraft({ ...draft, timeSetting: Number(e.target.value) })} />
            <FormField label="初回訪問 目標" type="number" value={draft.firstVisit} onChange={e => setDraft({ ...draft, firstVisit: Number(e.target.value) })} />
            <FormField label="営業時間設定 目標" type="number" value={draft.salesTimeSetting} onChange={e => setDraft({ ...draft, salesTimeSetting: Number(e.target.value) })} />
            <FormField label="受注 目標" type="number" value={draft.order} onChange={e => setDraft({ ...draft, order: Number(e.target.value) })} />
            <FormField label="営業粗利 目標（P）" type="number" value={draft.profit} onChange={e => setDraft({ ...draft, profit: Number(e.target.value) })} />
            <FormField label="台数 目標" type="number" value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: Number(e.target.value) })} />
          </div>
          <button onClick={saveGoal} className="mt-5 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">保存する</button>
        </Modal>
      )}

      {drilldown && (
        <Modal title={`${drilldown.title}（${drilldown.records.length}件）`} onClose={() => setDrilldown(null)} wide>
          {drilldown.records.length === 0 ? (
            <p className="text-sm text-slate-400">該当する記録がありません。</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {drilldown.records.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(r => {
                const cust = customers.find(c => c.id === r.customerId);
                return (
                  <button key={r.id}
                    onClick={() => { setDrilldown(null); onOpenCustomer(r.customerId); }}
                    className="text-left bg-white rounded-xl border border-slate-100 p-3 hover:shadow-md hover:border-teal-200 transition">
                    <p className="text-xs text-slate-400">{cust?.gakuenName || ''}{cust?.associationType ? ` ・ ${cust.associationType}` : ''}</p>
                    <p className="font-bold text-slate-800 text-sm">{r.customerName || cust?.enName || '不明な顧客'}</p>
                    <p className="text-xs text-slate-500 mt-1">{r.type}{r.flag ? `（${r.flag}）` : ''} ・ {r.date}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">担当: {effectiveAssignee(r) || '未設定'}</p>
                    {r.productName && (
                      <p className="text-[11px] text-amber-700 mt-1">{r.productName} / 粗利{r.profit || 0}P / 台数{r.quantity || 0}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-600 flex items-center gap-1.5"><CalendarDays className="w-4 h-4" />直近の予定</h3>
            <button onClick={() => onNavigate('calendar')} className="text-xs text-teal-600 font-semibold">カレンダーを見る</button>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-400">直近の予定はありません。</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map(r => (
                <li key={r.id}>
                  <button onClick={() => onOpenCustomer(r.customerId)} className="w-full text-left text-sm hover:bg-slate-50 rounded-lg px-1.5 py-1 -mx-1.5 transition">
                    <p className="font-semibold text-teal-700 hover:underline">{r.customerName || '不明な顧客'}</p>
                    <p className="text-xs text-indigo-600">{r.scheduledDate} {r.scheduledTime}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-600 flex items-center gap-1.5"><BarChart className="w-4 h-4" />テレアポ状況</h3>
            <button onClick={() => onNavigate('teleappt_stats')} className="text-xs text-teal-600 font-semibold">集計を見る</button>
          </div>
          <div className="flex justify-around text-center">
            <div><p className="text-2xl font-extrabold text-slate-800">{teleToday}</p><p className="text-[10px] text-slate-400">今日</p></div>
            <div><p className="text-2xl font-extrabold text-slate-800">{teleMonth}</p><p className="text-[10px] text-slate-400">今月</p></div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
          <h3 className="text-sm font-bold text-slate-600 flex items-center gap-1.5 mb-3"><FileText className="w-4 h-4" />日報</h3>
          <p className="text-xs text-slate-400 mb-3">今日の活動を自動集計して日報を作成できます。</p>
          <button onClick={() => onNavigate('daily_report')} className="w-full py-2 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700">日報を作成する</button>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-bold text-slate-600 mb-3">最近の記録</h3>
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400">まだ記録がありません。「顧客リスト」から顧客を選んで記録を追加してください。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.slice().reverse().slice(0, 8).map(r => (
              <li key={r.id} className="py-2.5">
                <button onClick={() => onOpenCustomer(r.customerId)} className="w-full flex justify-between items-center text-sm hover:bg-slate-50 rounded-lg px-1.5 -mx-1.5 py-0.5 transition text-left">
                  <div>
                    <span className="font-semibold text-teal-700 hover:underline">{r.customerName || '不明な顧客'}</span>
                    <span className="ml-2 text-slate-400">{r.type}{r.flag ? `（${r.flag}）` : ''}</span>
                  </div>
                  <span className="text-xs text-slate-400">{r.date}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- 顧客編集モーダル ----------
function CustomerModal({ customer, associationTypes, members, currentUser, onSave, onClose }) {
  const [form, setForm] = useState(customer ? { ...emptyCustomer, ...customer } : { ...emptyCustomer, assignedTo: currentUser?.displayName || '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // すでに設定済みの値が管理リストに無い場合（過去のデータ等）も選べるように残しておく
  const associationOptions = form.associationType && !associationTypes.some(a => a.name === form.associationType)
    ? [...associationTypes, { id: 'legacy', name: form.associationType }]
    : associationTypes;

  return (
    <Modal title={form.id ? '顧客情報を編集' : '新規顧客登録'} onClose={onClose} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="法人名" value={form.gakuenName} onChange={set('gakuenName')} />
        <FormField label="法人名ふりがな" value={form.gakuenNameKana} onChange={set('gakuenNameKana')} />
        <FormField label="園名" value={form.enName} onChange={set('enName')} />
        <FormField label="園名ふりがな" value={form.enNameKana} onChange={set('enNameKana')} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">協会の種類</label>
          <select value={form.associationType} onChange={set('associationType')} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">未設定</option>
            {associationOptions.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <p className="text-[11px] text-slate-400">選択肢の追加・編集は「設定・管理」からオーナーが行えます。</p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">担当者</label>
          <select value={form.assignedTo} onChange={set('assignedTo')} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">未設定</option>
            {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
          </select>
        </div>
        <FormField label="理事長" value={form.chairman} onChange={set('chairman')} />
        <FormField label="園長" value={form.principal} onChange={set('principal')} />
        <FormField label="住所" value={form.address} onChange={set('address')} className="md:col-span-2" />
        <FormField label="TEL" value={form.tel} onChange={set('tel')} />
        <FormField label="携帯番号" value={form.mobile} onChange={set('mobile')} />
        <FormField label="メールアドレス" value={form.email} onChange={set('email')} />
        <FormField label="HPリンク" value={form.hpLink} onChange={set('hpLink')} />
        <FormField label="採用サイトリンク" value={form.recruitSiteLink} onChange={set('recruitSiteLink')} />
        <FormField label="HP業者" value={form.hpVendor} onChange={set('hpVendor')} />
        <FormField label="Instagram URL" value={form.instagram} onChange={set('instagram')} />
        <FormField label="GBPプロフィールリンク" value={form.gbpLink} onChange={set('gbpLink')} />
        <FormField label="口コミ評価（★の数）" type="number" value={form.reviewScore} onChange={set('reviewScore')} />
        <FormField label="口コミ数" type="number" value={form.reviewCount} onChange={set('reviewCount')} />
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

// ---------- 過去の記録の編集フォーム ----------
function RecordEditForm({ record, activityTypes, products, members, onSave, onCancel }) {
  const [type, setType] = useState(record.type);
  const [flag, setFlag] = useState(record.flag || '');
  const [date, setDate] = useState(record.date || '');
  const [time, setTime] = useState(record.time || '');
  const [memo, setMemo] = useState(record.memo || '');
  const [assignedTo, setAssignedTo] = useState(record.assignedTo || '');
  const [productName, setProductName] = useState(record.productName || products[0]?.name || '');
  const [monthlyFee, setMonthlyFee] = useState(record.monthlyFee || '');
  const [years, setYears] = useState(record.years || '');
  const [quantity, setQuantity] = useState(record.quantity || '');
  const [profit, setProfit] = useState(record.profit || '');
  const [scheduledDate, setScheduledDate] = useState(record.scheduledDate || '');
  const [scheduledTime, setScheduledTime] = useState(record.scheduledTime || '');
  const [voiceLink, setVoiceLink] = useState(record.voiceLink || '');
  const [voiceMemo, setVoiceMemo] = useState(record.voiceMemo || '');

  const currentFlags = activityTypes.find(a => a.name === type)?.flags || [];
  const isOrder = flag === '受注' || flag === 'ユーザー';
  const needsSchedule = SCHEDULE_FLAGS.includes(flag);
  const isTele = type === 'テレアポ';

  const save = () => {
    onSave({
      ...record, type, flag, date, time, memo, assignedTo,
      ...(isOrder ? { productName, monthlyFee, years, quantity, profit } : { productName: undefined, monthlyFee: undefined, years: undefined, quantity: undefined, profit: undefined }),
      ...(needsSchedule && scheduledDate ? { scheduledDate, scheduledTime } : { scheduledDate: undefined, scheduledTime: undefined }),
      ...(isTele && (voiceLink || voiceMemo) ? { voiceLink, voiceMemo } : { voiceLink: undefined, voiceMemo: undefined }),
    });
  };

  return (
    <div className="bg-white border border-indigo-200 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-500">活動種別</label>
          <select value={type} onChange={e => { setType(e.target.value); setFlag(''); }} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white">
            {activityTypes.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-500">結果フラグ</label>
          <select value={flag} onChange={e => setFlag(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white">
            <option value="">なし</option>
            {currentFlags.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <FormField label="日付" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <FormField label="時間" type="time" value={time} onChange={e => setTime(e.target.value)} />
        <div className="flex flex-col gap-1 col-span-2">
          <label className="text-[11px] font-semibold text-slate-500">担当者</label>
          <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white">
            <option value="">未設定</option>
            {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
          </select>
        </div>
      </div>

      {needsSchedule && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="予定日" type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
          <FormField label="予定時間" type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
        </div>
      )}

      {isTele && (
        <div className="grid grid-cols-1 gap-2">
          <FormField label="音声リンク（URL）" value={voiceLink} onChange={e => setVoiceLink(e.target.value)} />
          <FormField label="音声メモ" value={voiceMemo} onChange={e => setVoiceMemo(e.target.value)} />
        </div>
      )}

      {isOrder && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">商品名</label>
            <select value={productName} onChange={e => setProductName(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white">
              {products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <FormField label="月額" type="number" value={monthlyFee} onChange={e => setMonthlyFee(e.target.value)} />
          <FormField label="年数" type="number" value={years} onChange={e => setYears(e.target.value)} />
          <FormField label="台数" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
          <FormField label="営業粗利（P）" type="number" value={profit} onChange={e => setProfit(e.target.value)} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold text-slate-500">メモ</label>
        <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white" />
      </div>

      <div className="flex gap-2">
        <button onClick={save} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700">保存する</button>
        <button onClick={onCancel} className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium">キャンセル</button>
      </div>
    </div>
  );
}

// ---------- 顧客詳細（活動履歴＋記録登録）モーダル ----------
function CustomerDetailModal({ customer, records, setRecords, activityTypes, products, reportTemplates, members, currentUser, token, canDelete, showAlert, showConfirm, onClose, onEdit, startWithForm }) {
  const history = records
    .filter(r => r.customerId === customer.id)
    .slice()
    .sort((a, b) => `${b.date || ''}${b.time || ''}`.localeCompare(`${a.date || ''}${a.time || ''}`));
  const [showForm, setShowForm] = useState(!!startWithForm);
  const [showReport, setShowReport] = useState(false);
  const [reportSeedRecord, setReportSeedRecord] = useState(null);
  const [editingRecordId, setEditingRecordId] = useState(null);

  const updateRecord = (updated) => {
    setRecords(prev => prev.map(r => r.id === updated.id ? updated : r));
    setEditingRecordId(null);
    showAlert('記録を更新しました。');
  };

  const deleteRecord = (id) => {
    showConfirm('この記録を削除しますか？', () => {
      setRecords(prev => prev.filter(r => r.id !== id));
      showAlert('記録を削除しました。');
    });
  };

  const AUTO_REPORT_FLAGS = ['初回時間設定（代表）', '初回時間設定（担当）', '営業時間設定'];
  const handleRecordSaved = (record) => {
    setShowForm(false);
    if (AUTO_REPORT_FLAGS.includes(record.flag)) {
      setReportSeedRecord(record);
      setShowReport(true);
    }
  };

  return (
    <Modal title={customer.enName || customer.gakuenName} onClose={onClose} wide>
      {(() => {
        const status = getCustomerStatus(customer.id, records);
        return (customer.associationType || status) && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {customer.associationType && <span className="px-2.5 py-1 bg-slate-100 rounded-full text-xs text-slate-600">{customer.associationType}</span>}
            {status && <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${status.badge}`}>現在の状況: {status.label}</span>}
          </div>
        );
      })()}
      <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-5">
        {customer.chairman && <span className="flex items-center gap-1"><Users className="w-4 h-4" />理事長: {customer.chairman}</span>}
        {customer.principal && <span className="flex items-center gap-1"><Users className="w-4 h-4" />園長: {customer.principal}</span>}
        {customer.tel && <a href={`tel:${customer.tel}`} className="flex items-center gap-1 text-teal-700 font-semibold"><Phone className="w-4 h-4" />{customer.tel}</a>}
        {customer.mobile && <a href={`tel:${customer.mobile}`} className="flex items-center gap-1 text-teal-700 font-semibold"><Phone className="w-4 h-4" />{customer.mobile}（携帯）</a>}
        {customer.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-1 text-teal-700"><Mail className="w-4 h-4" />{customer.email}</a>}
        {customer.address && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{customer.address}</span>}
        {customer.hpLink && <a href={customer.hpLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-600"><Globe className="w-4 h-4" />HP</a>}
        {customer.recruitSiteLink && <a href={customer.recruitSiteLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-600"><Briefcase className="w-4 h-4" />採用サイト</a>}
        {customer.instagram && <a href={customer.instagram} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-pink-600"><Camera className="w-4 h-4" />Instagram</a>}
        {customer.reviewScore && <span className="flex items-center gap-1 text-amber-500"><Star className="w-4 h-4 fill-amber-400" />{customer.reviewScore}（{customer.reviewCount || 0}件）</span>}
      </div>

      <div className="flex flex-wrap gap-4 mb-5">
        <button onClick={() => onEdit(customer)} className="text-sm font-semibold text-teal-700 flex items-center gap-1"><Edit className="w-4 h-4" />基本情報を編集</button>
        <button onClick={() => setShowForm(v => !v)} className="text-sm font-semibold text-indigo-700 flex items-center gap-1">
          <PenTool className="w-4 h-4" />{showForm ? '記録フォームを閉じる' : '新しい記録を追加'}
        </button>
        <button onClick={() => { setShowReport(v => !v); if (showReport) setReportSeedRecord(null); }} className="text-sm font-semibold text-purple-700 flex items-center gap-1">
          <FileText className="w-4 h-4" />{showReport ? '報告文フォームを閉じる' : '報告文を作成'}
        </button>
      </div>

      {showReport && (
        <div className="mb-6">
          {reportSeedRecord && (
            <p className="text-xs text-purple-600 mb-2 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />「{reportSeedRecord.flag}」の記録が登録されたので、報告文フォーマットを自動で表示しています。</p>
          )}
          <ReportGenerator customer={customer} reportTemplates={reportTemplates} latestRecord={reportSeedRecord || history[0]} />
        </div>
      )}

      {showForm && (
        <div className="mb-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
          <RecordFields
            customer={customer}
            setRecords={setRecords}
            activityTypes={activityTypes}
            products={products}
            members={members}
            currentUser={currentUser}
            token={token}
            showAlert={showAlert}
            onSaved={handleRecordSaved}
          />
        </div>
      )}

      <h4 className="text-sm font-bold text-slate-600 mb-2">活動履歴タイムライン</h4>
      {history.length === 0 ? (
        <p className="text-sm text-slate-400">記録がありません。</p>
      ) : (
        <ul className="space-y-2">
          {history.map(r => (
            <li key={r.id}>
              {editingRecordId === r.id ? (
                <RecordEditForm record={r} activityTypes={activityTypes} products={products} members={members} onSave={updateRecord} onCancel={() => setEditingRecordId(null)} />
              ) : (
                <div className="bg-slate-50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-700">{r.type}{r.flag ? `（${r.flag}）` : ''}</span>
                      {r.assignedTo && <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full text-[10px] font-bold">担当: {r.assignedTo}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-400">{r.date} {r.time}</span>
                      <button onClick={() => setEditingRecordId(r.id)} className="p-1 text-slate-300 hover:text-teal-600"><Edit className="w-3.5 h-3.5" /></button>
                      {canDelete && (
                        <button onClick={() => deleteRecord(r.id)} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </div>
                  {r.memo && <p className="text-slate-500 mt-1">{r.memo}</p>}
                  {r.productName && <p className="text-amber-700 mt-1 text-xs">受注: {r.productName} / 月額{r.monthlyFee || 0} / {r.years || 0}年 / 台数{r.quantity || 0} / 粗利{r.profit || 0}</p>}
                  {r.scheduledDate && <p className="text-indigo-600 mt-1 text-xs flex items-center gap-1"><CalendarDays className="w-3 h-3" />次回予定: {r.scheduledDate} {r.scheduledTime}</p>}
                  {(r.voiceLink || r.voiceMemo) && (
                    <p className="text-pink-600 mt-1 text-xs">
                      {r.voiceLink && <a href={r.voiceLink} target="_blank" rel="noreferrer" className="underline">音声リンクを開く</a>}
                      {r.voiceMemo && <span>{r.voiceLink ? '　' : ''}{r.voiceMemo}</span>}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ---------- 顧客の現在の状況（記録から自動判定） ----------
function getCustomerStatus(customerId, records) {
  const custRecords = records.filter(r => r.customerId === customerId);
  if (custRecords.length === 0) return null;

  const hasOrder = custRecords.some(r => ['受注', 'ユーザー', '過去受注記録あり'].includes(r.flag));
  if (hasOrder) return { label: 'ユーザー', badge: 'bg-amber-100 text-amber-700', card: 'border-amber-300 bg-amber-50/60' };

  const hasSalesResult = custRecords.some(r => SALES_TYPES.includes(r.type) && ['NG', '返事待ち', '返事待ちNG'].includes(r.flag));
  if (hasSalesResult) return { label: '営業実行済み', badge: 'bg-blue-100 text-blue-700', card: 'border-blue-300 bg-blue-50/60' };

  const hasVisitTimeSet = custRecords.some(r => r.type === '初回訪問' && r.flag === '営業時間設定');
  if (hasVisitTimeSet) return { label: '初回訪問済み・営業時間設定', badge: 'bg-purple-200 text-purple-800', card: 'border-purple-400 bg-purple-100/60' };

  const hasVisit = custRecords.some(r => r.type === '初回訪問');
  if (hasVisit) return { label: '初回訪問済み', badge: 'bg-purple-100 text-purple-700', card: 'border-purple-300 bg-purple-50/60' };

  const hasTele = custRecords.some(r => r.type === 'テレアポ');
  if (hasTele) return { label: 'テレアポ中', badge: 'bg-pink-100 text-pink-700', card: 'border-pink-300 bg-pink-50/60' };

  const hasCompanyOverlap = custRecords.some(r => r.flag === '法人被り');
  if (hasCompanyOverlap) return { label: '法人被り', badge: 'bg-slate-300 text-slate-700', card: 'border-slate-300 bg-slate-200/60' };

  return { label: '記録あり', badge: 'bg-slate-100 text-slate-600', card: 'border-slate-200' };
}

// ---------- 一括編集（担当者・協会の種類）モーダル ----------
function BulkEditModal({ count, members, associationTypes, activityTypes, onApply, onClose }) {
  const [assignedTo, setAssignedTo] = useState('__unchanged__');
  const [associationType, setAssociationType] = useState('__unchanged__');
  const [activityType, setActivityType] = useState('__none__');
  const [flag, setFlag] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));

  const currentFlags = activityType !== '__none__' ? (activityTypes.find(a => a.name === activityType)?.flags || []) : [];

  const apply = () => {
    onApply({
      assignedTo: assignedTo === '__unchanged__' ? null : assignedTo,
      associationType: associationType === '__unchanged__' ? null : associationType,
      record: activityType === '__none__' ? null : { type: activityType, flag, date },
    });
  };

  const noChange = assignedTo === '__unchanged__' && associationType === '__unchanged__' && activityType === '__none__';

  return (
    <Modal title={`選択した${count}件を一括編集`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">担当者</label>
          <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="__unchanged__">変更しない</option>
            <option value="">未設定にする</option>
            {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">協会の種類</label>
          <select value={associationType} onChange={e => setAssociationType(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="__unchanged__">変更しない</option>
            <option value="">未設定にする</option>
            {associationTypes.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-bold text-slate-500 mb-2">記録の一括登録（任意）</p>
          <p className="text-[11px] text-slate-400 mb-3">選択した活動種別・結果フラグで、対象全員に同じ内容の記録を1件ずつ追加します。受注詳細（商品・粗利など）は個別に記録画面から追記してください。</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">活動種別</label>
              <select value={activityType} onChange={e => { setActivityType(e.target.value); setFlag(''); }} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="__none__">記録を追加しない</option>
                {activityTypes.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">結果フラグ</label>
              <select value={flag} onChange={e => setFlag(e.target.value)} disabled={activityType === '__none__'} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-50 disabled:text-slate-300">
                <option value="">なし</option>
                {currentFlags.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          {activityType !== '__none__' && (
            <div className="mt-3">
              <FormField label="日付" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          )}
        </div>
      </div>
      <button onClick={apply} disabled={noChange}
        className="mt-5 w-full py-2.5 bg-teal-600 disabled:bg-teal-300 text-white rounded-lg font-bold hover:bg-teal-700">
        {count}件に適用する
      </button>
    </Modal>
  );
}

// ---------- 顧客リスト ----------
function CustomersView({ customers, setCustomers, records, setRecords, activityTypes, products, reportTemplates, associationTypes, members, currentUser, isOwner, canDeleteCustomer, canBulkEdit, token, showAlert, showConfirm, filters, setFilters, pendingViewCustomerId, clearPendingViewCustomer }) {
  const { search, addressFilter, statusFilter, associationFilter, activityTypeFilter, flagFilter, assigneeFilter, viewMode, firstVisitFilter, excludeCompanyOverlap, excludeUser } = filters;
  const setSearch = (v) => setFilters(prev => ({ ...prev, search: v }));
  const setAddressFilter = (v) => setFilters(prev => ({ ...prev, addressFilter: v }));
  const setStatusFilter = (v) => setFilters(prev => ({ ...prev, statusFilter: v }));
  const setAssociationFilter = (v) => setFilters(prev => ({ ...prev, associationFilter: v }));
  const setActivityTypeFilter = (v) => setFilters(prev => ({ ...prev, activityTypeFilter: v, flagFilter: '' }));
  const setFlagFilter = (v) => setFilters(prev => ({ ...prev, flagFilter: v }));
  const setAssigneeFilter = (v) => setFilters(prev => ({ ...prev, assigneeFilter: v }));
  const setViewMode = (v) => setFilters(prev => ({ ...prev, viewMode: v }));
  const setFirstVisitFilter = (v) => setFilters(prev => ({ ...prev, firstVisitFilter: v }));
  const setExcludeCompanyOverlap = (v) => setFilters(prev => ({ ...prev, excludeCompanyOverlap: v }));
  const setExcludeUser = (v) => setFilters(prev => ({ ...prev, excludeUser: v }));
  const effectiveAssigneeFilter = isOwner ? assigneeFilter : (currentUser?.displayName || '');

  const [editing, setEditing] = useState(null); // customer being edited, or {} for new
  const [viewing, setViewing] = useState(null); // customer being viewed

  // HOME画面の「直近の予定」「最近の記録」から遷移してきた場合、該当の顧客を自動で開く
  useEffect(() => {
    if (!pendingViewCustomerId) return;
    const target = customers.find(c => c.id === pendingViewCustomerId);
    if (target) setViewing(target);
    clearPendingViewCustomer();
  }, [pendingViewCustomerId, customers]);
  const [viewingWithForm, setViewingWithForm] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const fileInputRef = useRef(null);

  const STATUS_OPTIONS = ['ユーザー', '営業実行済み', '初回訪問済み・営業時間設定', '初回訪問済み', 'テレアポ中', '法人被り', '記録あり', '記録なし'];
  const associationOptions = [...new Set(customers.map(c => c.associationType).filter(Boolean))];
  const flagOptions = activityTypeFilter
    ? (activityTypes.find(a => a.name === activityTypeFilter)?.flags || [])
    : [...new Set(activityTypes.flatMap(a => a.flags))];

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSVText(String(ev.target.result));
        if (rows.length < 2) { showAlert('データを読み取れませんでした。'); return; }
        const header = rows[0].map(h => h.trim());

        // 見出しの表記ゆれ（例：「協会関係」「メールアドレス」など）も受け付ける
        const labelToKey = {};
        CSV_FIELDS.forEach(([key, ...labels]) => { labels.forEach(l => { labelToKey[l] = key; }); });
        const keyForCol = header.map(h => labelToKey[h] || null);

        // ログ列（ログ1_種別／ログ1_活動種別 など、表記ゆれも含む）の位置を調べておく
        const logColIndexes = [];
        for (let i = 1; i <= CSV_LOG_COLUMNS; i++) {
          const cols = {};
          LOG_FIELD_SUFFIXES.forEach(([key, ...labels]) => {
            for (const label of labels) {
              const idx = header.indexOf(`ログ${i}_${label}`);
              if (idx !== -1) { cols[key] = idx; break; }
            }
          });
          if (Object.keys(cols).length > 0) logColIndexes.push(cols);
        }

        const importedCustomers = [];
        const importedRecords = [];
        rows.slice(1).forEach(r => {
          const customerId = Date.now() + Math.floor(Math.random() * 1000000);
          const obj = { id: customerId };
          keyForCol.forEach((key, i) => { if (key) obj[key] = r[i] || ''; });
          if (!obj.enName && !obj.gakuenName) return;
          importedCustomers.push(obj);

          logColIndexes.forEach(cols => {
            const type = cols.type !== undefined ? r[cols.type] : '';
            if (!type) return; // 種別が空のログ列は無視
            const rec = {
              id: Date.now() + Math.floor(Math.random() * 1000000),
              customerId,
              customerName: obj.enName || obj.gakuenName,
              type,
              flag: cols.flag !== undefined ? r[cols.flag] || '' : '',
              date: cols.date !== undefined ? r[cols.date] || '' : '',
              time: cols.time !== undefined ? r[cols.time] || '' : '',
              memo: cols.memo !== undefined ? r[cols.memo] || '' : '',
            };
            const schedDate = cols.scheduledDate !== undefined ? r[cols.scheduledDate] || '' : '';
            const schedTime = cols.scheduledTime !== undefined ? r[cols.scheduledTime] || '' : '';
            if (schedDate) { rec.scheduledDate = schedDate; rec.scheduledTime = schedTime; }
            importedRecords.push(rec);
          });
        });

        setCustomers(prev => [...prev, ...importedCustomers]);
        if (importedRecords.length > 0) setRecords(prev => [...prev, ...importedRecords]);
        showAlert(`${importedCustomers.length}件の顧客データと${importedRecords.length}件の活動履歴を取り込みました。`);
      } catch (err) {
        console.error('CSV import error:', err);
        showAlert('CSVの読み込み中にエラーが発生しました。ファイルの形式をご確認ください。');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => showAlert('ファイルの読み込みに失敗しました。');
    reader.readAsText(file, 'UTF-8');
  };

  const filtered = customers.filter(c => {
    const q = search.toLowerCase();
    const matchesSearch = !q || [c.gakuenName, c.enName, c.chairman, c.principal].some(v => (v || '').toLowerCase().includes(q));
    const matchesAddress = !addressFilter || (c.address || '').toLowerCase().includes(addressFilter.toLowerCase());
    const status = getCustomerStatus(c.id, records);
    const statusLabel = status ? status.label : '記録なし';
    const matchesStatus = !statusFilter || statusLabel === statusFilter;
    const matchesAssociation = !associationFilter || c.associationType === associationFilter;
    const custRecords = records.filter(r => r.customerId === c.id);
    const matchesActivityType = !activityTypeFilter || custRecords.some(r => r.type === activityTypeFilter);
    const matchesFlag = !flagFilter || custRecords.some(r => r.flag === flagFilter);
    const matchesAssignee = !effectiveAssigneeFilter || c.assignedTo === effectiveAssigneeFilter;
    const hasFirstVisit = custRecords.some(r => r.type === '初回訪問');
    const matchesFirstVisit = !firstVisitFilter || (firstVisitFilter === 'has' ? hasFirstVisit : !hasFirstVisit);
    const hasCompanyOverlap = custRecords.some(r => r.type === '法人被り' || r.flag === '法人被り');
    const matchesOverlap = !excludeCompanyOverlap || !hasCompanyOverlap;
    const isUser = statusLabel === 'ユーザー';
    const matchesUserExclusion = !excludeUser || !isUser;
    return matchesSearch && matchesAddress && matchesStatus && matchesAssociation && matchesActivityType && matchesFlag && matchesAssignee && matchesFirstVisit && matchesOverlap && matchesUserExclusion;
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
      setRecords(prev => prev.filter(r => r.customerId !== id));
      setViewing(null);
    });
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedIds.includes(c.id));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => prev.filter(id => !filtered.some(c => c.id === id)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...filtered.map(c => c.id)])]);
    }
  };

  const deleteSelected = () => {
    if (selectedIds.length === 0) return;
    showConfirm(`選択した${selectedIds.length}件の顧客を削除しますか？関連する活動履歴も削除されます。`, () => {
      setCustomers(prev => prev.filter(c => !selectedIds.includes(c.id)));
      setRecords(prev => prev.filter(r => !selectedIds.includes(r.customerId)));
      setSelectedIds([]);
      setSelectMode(false);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="園名・理事長・園長で検索"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <input value={addressFilter} onChange={e => setAddressFilter(e.target.value)} placeholder="住所で絞り込み"
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white w-32" />
          <select value={associationFilter} onChange={e => setAssociationFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">すべての協会</option>
            {associationOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={activityTypeFilter} onChange={e => setActivityTypeFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">すべての活動種別</option>
            {activityTypes.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <select value={flagFilter} onChange={e => setFlagFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">すべての結果フラグ</option>
            {flagOptions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">すべてのステータス</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {isOwner && (
            <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">すべての担当者</option>
              {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
            </select>
          )}
          <select value={firstVisitFilter} onChange={e => setFirstVisitFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">初回訪問：すべて</option>
            <option value="has">初回訪問済みのみ</option>
            <option value="none">初回訪問済みでないのみ</option>
          </select>
          <label className="flex items-center gap-1.5 px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer select-none">
            <input type="checkbox" checked={excludeCompanyOverlap} onChange={e => setExcludeCompanyOverlap(e.target.checked)} className="accent-orange-600" />
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
            法人被りリストを除く
          </label>
          <label className="flex items-center gap-1.5 px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer select-none">
            <input type="checkbox" checked={excludeUser} onChange={e => setExcludeUser(e.target.checked)} className="accent-amber-600" />
            <Star className="w-3.5 h-3.5 text-amber-500" />
            ユーザーを除く
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">{filtered.length}件</span>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            <button onClick={() => setViewMode('card')} className={`p-2.5 ${viewMode === 'card' ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`} title="カード表示">
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('table')} className={`p-2.5 ${viewMode === 'table' ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`} title="表形式表示">
              <List className="w-4 h-4" />
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
            <Upload className="w-4 h-4" /> CSVインポート
          </button>
          <button onClick={() => downloadCustomersCSV(customers, records, showAlert)} className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
            <Download className="w-4 h-4" /> CSV出力
          </button>
          <button
            onClick={() => { setSelectMode(v => !v); setSelectedIds([]); }}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold border ${selectMode ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            <CheckSquare className="w-4 h-4" /> {selectMode ? '選択を終了' : '複数選択'}
          </button>
          {selectMode && (
            <button onClick={toggleSelectAll} className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
              <CheckSquare className="w-4 h-4" /> {allFilteredSelected ? '全解除' : `全件選択（${filtered.length}件）`}
            </button>
          )}
          {selectMode && canBulkEdit && (
            <button onClick={() => setBulkEditOpen(true)} disabled={selectedIds.length === 0}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-indigo-600 disabled:bg-indigo-200 text-white rounded-lg text-sm font-bold">
              <Edit className="w-4 h-4" /> {selectedIds.length}件を一括編集
            </button>
          )}
          {selectMode && canDeleteCustomer && (
            <button onClick={deleteSelected} disabled={selectedIds.length === 0}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-red-600 disabled:bg-red-200 text-white rounded-lg text-sm font-bold">
              <Trash2 className="w-4 h-4" /> {selectedIds.length}件を削除
            </button>
          )}
          {!selectMode && (
            <button onClick={() => setEditing(emptyCustomer)} className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700">
              <Plus className="w-4 h-4" /> 新規登録
            </button>
          )}
        </div>
      </div>

      {bulkEditOpen && (
        <BulkEditModal
          count={selectedIds.length}
          members={members}
          associationTypes={associationTypes}
          activityTypes={activityTypes}
          onApply={({ assignedTo, associationType, record }) => {
            setCustomers(prev => prev.map(c => {
              if (!selectedIds.includes(c.id)) return c;
              const patch = {};
              if (assignedTo !== null) patch.assignedTo = assignedTo;
              if (associationType !== null) patch.associationType = associationType;
              return { ...c, ...patch };
            }));
            if (record) {
              const now = new Date();
              setRecords(prev => [
                ...prev,
                ...selectedIds.map((customerId, i) => {
                  const c = customers.find(x => x.id === customerId);
                  const finalAssignedTo = assignedTo !== null ? assignedTo : (c?.assignedTo || currentUser?.displayName || '');
                  return {
                    id: Date.now() + i,
                    customerId,
                    customerName: c ? (c.enName || c.gakuenName) : '',
                    type: record.type,
                    flag: record.flag,
                    date: record.date,
                    time: now.toTimeString().substring(0, 5),
                    memo: '',
                    assignedTo: finalAssignedTo,
                  };
                }),
              ]);
            }
            setBulkEditOpen(false);
            setSelectMode(false);
            setSelectedIds([]);
            showAlert(`${selectedIds.length}件の顧客を更新しました。`);
          }}
          onClose={() => setBulkEditOpen(false)}
        />
      )}

      {viewMode === 'card' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => {
            const custRecords = records.filter(r => r.customerId === c.id);
            const latest = custRecords.slice(-1)[0];
            const status = getCustomerStatus(c.id, records);
            const hasFirstVisit = custRecords.some(r => r.type === '初回訪問');
            const hasCompanyOverlap = custRecords.some(r => r.type === '法人被り' || r.flag === '法人被り');
            const isSelected = selectedIds.includes(c.id);
            return (
              <div key={c.id} onClick={() => selectMode ? toggleSelect(c.id) : setViewing(c)}
                className={`bg-white rounded-xl shadow-sm border overflow-hidden cursor-pointer hover:shadow-md transition ${
                  selectMode && isSelected ? 'border-teal-400 ring-2 ring-teal-200' : (status ? status.card : 'border-slate-100 hover:border-teal-200')
                }`}>
                <div className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-start gap-2">
                      {selectMode && (isSelected ? <CheckSquare className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" /> : <Square className="w-4 h-4 text-slate-300 mt-0.5 shrink-0" />)}
                      <div>
                        <p className="text-xs text-slate-400">{c.gakuenName}{c.associationType ? ` ・ ${c.associationType}` : ''}{c.assignedTo ? ` ・ 担当:${c.assignedTo}` : ''}</p>
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-slate-800">{c.enName || '（園名未登録）'}</p>
                          {hasFirstVisit && (
                            <span title="初回訪問済み" className="inline-flex items-center justify-center w-4 h-4 bg-violet-100 text-violet-600 rounded-full shrink-0">
                              <CheckCircle className="w-3 h-3" />
                            </span>
                          )}
                          {hasCompanyOverlap && (
                            <span title="法人被り" className="inline-flex items-center justify-center w-4 h-4 bg-orange-100 text-orange-600 rounded-full shrink-0">
                              <AlertTriangle className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        {status && <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.badge}`}>{status.label}</span>}
                      </div>
                    </div>
                    {!selectMode && (
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); setViewing(c); setViewingWithForm(true); }} className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="記録登録">
                          <PenTool className="w-4 h-4" />
                        </button>
                        {canDeleteCustomer && (
                          <button onClick={(e) => { e.stopPropagation(); deleteCustomer(c.id); }} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    {c.chairman && <p className="flex items-center gap-1.5"><Users className="w-3 h-3" />理事長: {c.chairman}</p>}
                    {c.principal && <p className="flex items-center gap-1.5"><Users className="w-3 h-3" />園長: {c.principal}</p>}
                    {c.tel && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{c.tel}</p>}
                    {c.mobile && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{c.mobile}（携帯）</p>}
                    {c.email && <p className="flex items-center gap-1.5"><Mail className="w-3 h-3" />{c.email}</p>}
                    {c.address && <p className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{c.address}</p>}
                    {(c.reviewScore || c.reviewCount) && (
                      <p className="flex items-center gap-1.5 text-amber-600">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        {c.reviewScore || '-'}（口コミ{c.reviewCount || 0}件）
                      </p>
                    )}
                  </div>
                  {(c.hpLink || c.recruitSiteLink || c.instagram || c.gbpLink) && (
                    <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {c.hpLink && (
                        <a href={c.hpLink} target="_blank" rel="noreferrer" title="HP" className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100">
                          <Globe className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {c.recruitSiteLink && (
                        <a href={c.recruitSiteLink} target="_blank" rel="noreferrer" title="採用サイト" className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100">
                          <Briefcase className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {c.instagram && (
                        <a href={c.instagram} target="_blank" rel="noreferrer" title="Instagram" className="p-1.5 bg-pink-50 text-pink-600 rounded-lg hover:bg-pink-100">
                          <Camera className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {c.gbpLink && (
                        <a href={c.gbpLink} target="_blank" rel="noreferrer" title="GBPプロフィール" className="p-1.5 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100">
                          <Star className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div className="bg-slate-50 px-4 py-2.5 text-xs text-slate-500 border-t border-slate-100">
                  {latest ? `最新: ${latest.type}${latest.flag ? `（${latest.flag}）` : ''} - ${latest.date}` : '活動記録なし'}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="text-sm text-slate-400 col-span-full text-center py-10">該当する顧客がいません。新規登録してから記録を追加してください。</p>}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                {selectMode && <th className="px-3 py-2 w-8"></th>}
                <th className="px-3 py-2">園名</th>
                <th className="px-3 py-2">協会の種類</th>
                <th className="px-3 py-2">TEL</th>
                <th className="px-3 py-2">住所</th>
                <th className="px-3 py-2">ステータス</th>
                <th className="px-3 py-2">最新記録</th>
                {!selectMode && <th className="px-3 py-2 w-20"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const custRecords = records.filter(r => r.customerId === c.id);
                const latest = custRecords.slice(-1)[0];
                const status = getCustomerStatus(c.id, records);
                const isSelected = selectedIds.includes(c.id);
                return (
                  <tr key={c.id} onClick={() => selectMode ? toggleSelect(c.id) : setViewing(c)}
                    className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${selectMode && isSelected ? 'bg-teal-50' : ''}`}>
                    {selectMode && (
                      <td className="px-3 py-2.5">{isSelected ? <CheckSquare className="w-4 h-4 text-teal-600" /> : <Square className="w-4 h-4 text-slate-300" />}</td>
                    )}
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-slate-800">{c.enName || '（園名未登録）'}</p>
                      <p className="text-xs text-slate-400">{c.gakuenName}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{c.associationType || '-'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{c.tel || '-'}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[160px] truncate">{c.address || '-'}</td>
                    <td className="px-3 py-2.5">{status && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status.badge}`}>{status.label}</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{latest ? `${latest.type}${latest.flag ? `（${latest.flag}）` : ''} - ${latest.date}` : '-'}</td>
                    {!selectMode && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setViewing(c); setViewingWithForm(true); }} className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><PenTool className="w-4 h-4" /></button>
                          {canDeleteCustomer && (
                            <button onClick={(e) => { e.stopPropagation(); deleteCustomer(c.id); }} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-10">該当する顧客がいません。</p>}
        </div>
      )}

      {viewing && (
        <CustomerDetailModal
          customer={viewing}
          records={records}
          setRecords={setRecords}
          activityTypes={activityTypes}
          products={products}
          reportTemplates={reportTemplates}
          members={members}
          currentUser={currentUser}
          token={token}
          canDelete={canDeleteCustomer}
          showAlert={showAlert}
          showConfirm={showConfirm}
          startWithForm={viewingWithForm}
          onClose={() => { setViewing(null); setViewingWithForm(false); }}
          onEdit={(c) => setEditing(c)}
        />
      )}
      {editing && (
        <CustomerModal
          customer={editing.id ? editing : null}
          associationTypes={associationTypes}
          members={members}
          currentUser={currentUser}
          onSave={saveCustomer}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ---------- 記録登録フォーム（顧客詳細モーダルの中で使う） ----------
const SCHEDULE_FLAGS = ['初回時間設定（代表）', '初回時間設定（担当）', '飛び込み初回時間設定', '営業時間設定', '返事待ち', '返事待ちNG'];
const SALES_TYPES = ['営業（代表）', '営業（担当）'];
const isInitialTimeSettingFlag = (flag) => flag === '初回時間設定（代表）' || flag === '初回時間設定（担当）';

function RecordFields({ customer, setRecords, activityTypes, products, members, currentUser, token, showAlert, onSaved }) {
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
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [voiceLink, setVoiceLink] = useState('');
  const [voiceMemo, setVoiceMemo] = useState('');
  const [assignedTo, setAssignedTo] = useState(currentUser?.displayName || '');

  const currentFlags = activityTypes.find(a => a.name === type)?.flags || [];
  const isOrder = flag === '受注' || flag === 'ユーザー';
  const needsSchedule = SCHEDULE_FLAGS.includes(flag);
  const isTele = type === 'テレアポ';

  const reset = () => {
    setFlag(''); setMemo(''); setMonthlyFee(''); setYears(''); setQuantity(''); setProfit('');
    setScheduledDate(''); setScheduledTime(''); setVoiceLink(''); setVoiceMemo('');
    setAssignedTo(currentUser?.displayName || '');
  };

  const save = () => {
    const newRecord = {
      id: Date.now(), customerId: customer.id, customerName: customer.enName || customer.gakuenName,
      type, flag, date, time, memo, assignedTo,
      ...(isOrder ? { productName, monthlyFee, years, quantity, profit } : {}),
      ...(needsSchedule && scheduledDate ? { scheduledDate, scheduledTime } : {}),
      ...(isTele && (voiceLink || voiceMemo) ? { voiceLink, voiceMemo } : {}),
    };
    setRecords(prev => [...prev, newRecord]);
    showAlert('記録を保存しました。');
    reset();
    onSaved && onSaved(newRecord);

    // 予定がある記録は、設定済みであれば自動でGoogleカレンダーにも登録する
    if (needsSchedule && scheduledDate && token) {
      fetch('/api/calendar/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          date: scheduledDate,
          time: scheduledTime || '09:00',
          title: `${customer.enName || customer.gakuenName} - ${type}${flag ? `（${flag}）` : ''}`,
          description: memo,
        }),
      })
        .then(res => res.json().then(data => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (ok && data.eventId) {
            setRecords(prev => prev.map(r => r.id === newRecord.id ? { ...r, googleEventId: data.eventId } : r));
          }
        })
        .catch(() => {});
    }
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
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-semibold text-slate-500">担当者</label>
          <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">未設定</option>
            {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
          </select>
        </div>
      </div>

      {needsSchedule && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <p className="text-xs font-bold text-indigo-700 mb-2">次回予定（カレンダーに反映されます）</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="予定日" type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
            <FormField label="予定時間" type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
          </div>
        </div>
      )}

      {isTele && (
        <div className="bg-pink-50 border border-pink-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-pink-700">通話の音声メモ（任意）</p>
          <FormField label="音声リンク（URL）" value={voiceLink} onChange={e => setVoiceLink(e.target.value)} placeholder="録音データのURLがあれば貼り付け" />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">音声メモ</label>
            <textarea value={voiceMemo} onChange={e => setVoiceMemo(e.target.value)} rows={2} placeholder="パスワードや特記事項など"
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
          </div>
        </div>
      )}

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
          <p className="text-xs text-slate-400 pt-2">利用可能な変数: {'{{法人名}} {{園名}} {{理事長}} {{園長}} {{住所}} {{TEL}} {{メール}} {{HPリンク}}'}</p>
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
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm resize-y max-h-72" />
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

function TeleApptStatsView({ records, customers, activityTypes, members, currentUser, isOwner }) {
  const [granularity, setGranularity] = useState('day');
  const [scope, setScope] = useState(isOwner ? 'all' : (currentUser?.displayName || 'all'));
  // 記録に担当者が無い場合は顧客側の担当者で補う
  const customerAssigneeById = useMemo(() => {
    const map = {};
    (customers || []).forEach(c => { map[c.id] = c.assignedTo || ''; });
    return map;
  }, [customers]);
  const effectiveAssignee = (r) => r.assignedTo || customerAssigneeById[r.customerId] || '';
  const scopedRecords = scope === 'all' ? records : records.filter(r => effectiveAssignee(r) === scope);
  const teleRecords = scopedRecords.filter(r => r.type === 'テレアポ');
  // 現在設定されているフラグ ＋ 過去に使われたことがあるが今は消えたフラグも漏らさず集計する
  const configuredFlags = activityTypes.find(a => a.name === 'テレアポ')?.flags || [];
  const usedFlags = [...new Set(teleRecords.map(r => r.flag).filter(Boolean))];
  const flags = [...new Set([...configuredFlags, ...usedFlags])];

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

  // コール数・有効/無効コール数・代表接触数・時間設定件数・接続アポ率・代表接触率を算出
  const computeFunnel = (items) => {
    const callCount = items.length; // コール数：活動種別「テレアポ」を選択した回数
    const invalidCount = items.filter(i => i.flag === '留守電・不通').length; // 無効コール数
    const validCount = callCount - invalidCount; // 有効コール数：その他の結果フラグの数
    const repTimeSettingCount = items.filter(i => i.flag === '初回時間設定（代表）').length; // 時間設定（代表）
    const staffTimeSettingCount = items.filter(i => i.flag === '初回時間設定（担当）').length; // 時間設定（担当）
    const timeSettingCount = repTimeSettingCount + staffTimeSettingCount; // 時間設定件数（合計）
    const repContactCount = items.filter(i => isInitialTimeSettingFlag(i.flag) || ['代表接触拒否', '当日確認案件'].includes(i.flag)).length; // 代表接触数
    const validRate = callCount > 0 ? Math.round((validCount / callCount) * 100) : 0; // 有効コール率
    const repContactRate = validCount > 0 ? Math.round((repContactCount / validCount) * 100) : 0; // 代表接触率
    const apptRate = repContactCount > 0 ? Math.round((timeSettingCount / repContactCount) * 100) : 0; // 接続アポ率
    return { callCount, invalidCount, validCount, timeSettingCount, repTimeSettingCount, staffTimeSettingCount, repContactCount, validRate, repContactRate, apptRate };
  };

  const buildReport = (label, items) => {
    const total = items.length;
    const f = computeFunnel(items);
    const lines = [
      `${label} テレアポ結果`,
      `コール数: ${f.callCount}件`,
      `有効コール数: ${f.validCount}件`,
      `無効コール数: ${f.invalidCount}件`,
      `代表接触数: ${f.repContactCount}件`,
      `時間設定件数: ${f.timeSettingCount}件（代表${f.repTimeSettingCount}件、担当${f.staffTimeSettingCount}件）`,
      `有効コール率: ${f.validRate}%`,
      `代表接触率: ${f.repContactRate}%`,
      `接続アポ率: ${f.apptRate}%`,
      '',
      '【フラグ内訳】',
    ];
    flags.forEach(fl => {
      const n = items.filter(i => i.flag === fl).length;
      if (n > 0) lines.push(`${fl}: ${n}件（${total ? Math.round(n / total * 100) : 0}%）`);
    });
    const noFlag = items.filter(i => !i.flag).length;
    if (noFlag > 0) lines.push(`フラグなし: ${noFlag}件（${total ? Math.round(noFlag / total * 100) : 0}%）`);
    return lines.join('\n');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          {[['day', '日別'], ['week', '週別'], ['month', '月別']].map(([v, l]) => (
            <button key={v} onClick={() => setGranularity(v)} className={`px-4 py-2 rounded-lg text-sm font-bold ${granularity === v ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{l}</button>
          ))}
        </div>
        {isOwner && (
          <select value={scope} onChange={e => setScope(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="all">全員</option>
            {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
          </select>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-slate-400">テレアポの記録がまだありません。</p>
      ) : (
        <div className="space-y-3">
          {groups.map(([key, items]) => {
            const noFlagCount = items.filter(i => !i.flag).length;
            const f = computeFunnel(items);
            return (
              <div key={key} className="bg-white rounded-xl border border-slate-100 p-4">
                <div className="flex justify-between items-start mb-3">
                  <p className="text-sm font-bold text-slate-700">{key}</p>
                  <CopyButton text={buildReport(key, items)} label="レポートをコピー" />
                </div>

                <div className="grid grid-cols-4 lg:grid-cols-10 gap-2 mb-3">
                  {[
                    ['コール数', f.callCount, '件'],
                    ['有効コール数', f.validCount, '件'],
                    ['無効コール数', f.invalidCount, '件'],
                    ['代表接触数', f.repContactCount, '件'],
                    ['時間設定件数', f.timeSettingCount, '件'],
                    ['　├代表', f.repTimeSettingCount, '件'],
                    ['　└担当', f.staffTimeSettingCount, '件'],
                    ['有効コール率', f.validRate, '%'],
                    ['代表接触率', f.repContactRate, '%'],
                    ['接続アポ率', f.apptRate, '%'],
                  ].map(([label, value, unit]) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-2 text-center">
                      <p className="text-base font-extrabold text-slate-800">{value}<span className="text-xs font-normal text-slate-400">{unit}</span></p>
                      <p className="text-[10px] text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-slate-400 mb-1.5">フラグ内訳</p>
                <div className="flex flex-wrap gap-2">
                  {flags.map(f => {
                    const n = items.filter(i => i.flag === f).length;
                    if (n === 0) return null;
                    return <span key={f} className="px-2.5 py-1 bg-slate-100 rounded-full text-xs text-slate-600">{f}: {n}件</span>;
                  })}
                  {noFlagCount > 0 && <span className="px-2.5 py-1 bg-slate-50 border border-dashed border-slate-200 rounded-full text-xs text-slate-400">フラグなし: {noFlagCount}件</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- 日報 ----------
// ---------- 日報フォーマット用ヘルパー ----------
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

// 「協会の種類」の値から群私幼／ユーザー／新規のどれに属するかを判定する
function getApproachBucket(customer) {
  const t = customer?.associationType || '';
  if (t.includes('群私幼')) return 'gunshiyou';
  if (t.includes('ユーザー')) return 'user';
  if (t.includes('新規')) return 'shinki';
  return null;
}

function computeApproachStats(records, customerIds, dateFrom, dateTo) {
  const recs = records.filter(r => customerIds.has(r.customerId) && r.date >= dateFrom && r.date <= dateTo);
  const initialTimeSettingRep = recs.filter(r => r.type === 'テレアポ' && r.flag === '初回時間設定（代表）').length;
  const initialTimeSettingStaff = recs.filter(r => r.type === 'テレアポ' && r.flag === '初回時間設定（担当）').length;
  const initialTimeSetting = initialTimeSettingRep + initialTimeSettingStaff;
  const initialVisit = recs.filter(r => r.type === '初回訪問').length;
  const timeSetting = recs.filter(r => r.flag === '営業時間設定').length;
  const visit = recs.filter(r => SALES_TYPES.includes(r.type)).length;
  const visitRep = recs.filter(r => r.type === '営業（代表）').length;
  const visitStaff = recs.filter(r => r.type === '営業（担当）').length;
  const orderRecs = recs.filter(r => ['受注', 'ユーザー', '過去受注記録あり'].includes(r.flag));
  const profit = orderRecs.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const quantity = orderRecs.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  return { initialTimeSetting, initialTimeSettingRep, initialTimeSettingStaff, initialVisit, timeSetting, visit, visitRep, visitStaff, profit, quantity };
}

function NumField({ label, value, onChange, suffix = '件' }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold text-slate-500">{label}</label>
      <div className="flex items-center gap-1">
        <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
          className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
        <span className="text-xs text-slate-400 shrink-0">{suffix}</span>
      </div>
    </div>
  );
}

function DailyReportView({ records, customers, currentUser, dailyReportLogs, setDailyReportLogs, showAlert }) {
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [companyName, setCompanyName] = useState('');
  const [totalWorkingDays, setTotalWorkingDays] = useState(22);

  const [monthlyCommitProfit, setMonthlyCommitProfit] = useState(0);
  const [monthlyCommitQuantity, setMonthlyCommitQuantity] = useState(0);
  const [todayCommitTimeSetting, setTodayCommitTimeSetting] = useState(0);
  const [todayCommitAppt, setTodayCommitAppt] = useState(0);
  const [todayCommitProfit, setTodayCommitProfit] = useState(0);
  const [todayCommitQuantity, setTodayCommitQuantity] = useState(0);
  const [nextWeekCommitTimeSetting, setNextWeekCommitTimeSetting] = useState(0);
  const [nextWeekCommitAppt, setNextWeekCommitAppt] = useState(0);
  const [nextWeekCommitProfit, setNextWeekCommitProfit] = useState(0);
  const [nextWeekCommitQuantity, setNextWeekCommitQuantity] = useState(0);

  const [userStats, setUserStats] = useState({ contact: 0, appt: 0, visit: 0, meeting: 0, newSchedule: 0, noContact: 0, churnRisk: 0 });
  const [referral, setReferral] = useState({ count: 0, converted: 0, notApproached: 0 });

  const [growthText, setGrowthText] = useState('');
  const [improvementText, setImprovementText] = useState('');
  const [improvementActionText, setImprovementActionText] = useState('');
  const [nextWeekGoal1, setNextWeekGoal1] = useState('');
  const [nextWeekGoal2, setNextWeekGoal2] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const myRecords = records.filter(r => r.assignedTo === currentUser?.displayName);
  const monthStr = date.substring(0, 7);
  const monthStart = `${monthStr}-01`;
  const monthRecords = myRecords.filter(r => r.date?.startsWith(monthStr) && r.date <= date);
  const workedDates = [...new Set(monthRecords.map(r => r.date))];
  const workedDaysCount = workedDates.length;

  const dParts = date.split('-');
  const dayOfWeek = WEEKDAY_JA[new Date(date).getDay()];

  const todayRecords = myRecords.filter(r => r.date === date);
  const todayTimeSetting = todayRecords.filter(r => r.type === 'テレアポ' && isInitialTimeSettingFlag(r.flag)).length;
  const todayVisit = todayRecords.filter(r => r.type === '初回訪問').length;
  const todayOrderRecs = todayRecords.filter(r => ['受注', 'ユーザー', '過去受注記録あり'].includes(r.flag));
  const todayProfit = todayOrderRecs.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const todayQuantity = todayOrderRecs.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  const cumOrderRecs = monthRecords.filter(r => ['受注', 'ユーザー', '過去受注記録あり'].includes(r.flag));
  const cumProfit = cumOrderRecs.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const cumQuantity = cumOrderRecs.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  const remainingDays = Math.max(totalWorkingDays - workedDaysCount, 1);
  const remainingProfit = Math.max(monthlyCommitProfit - cumProfit, 0);
  const remainingQuantity = Math.max(monthlyCommitQuantity - cumQuantity, 0);
  const dailyNeededProfit = (remainingProfit / remainingDays).toFixed(2);
  const dailyNeededQuantity = (remainingQuantity / remainingDays).toFixed(2);

  const gunshiyouIds = new Set(customers.filter(c => getApproachBucket(c) === 'gunshiyou').map(c => c.id));
  const gunshiyouToday = computeApproachStats(myRecords, gunshiyouIds, date, date);
  const gunshiyouCum = computeApproachStats(myRecords, gunshiyouIds, monthStart, date);

  const userIds = new Set(customers.filter(c => getApproachBucket(c) === 'user').map(c => c.id));
  const userToday = computeApproachStats(myRecords, userIds, date, date);
  const userCum = computeApproachStats(myRecords, userIds, monthStart, date);

  const shinkiIds = new Set(customers.filter(c => getApproachBucket(c) === 'shinki').map(c => c.id));
  const shinkiToday = computeApproachStats(myRecords, shinkiIds, date, date);
  const shinkiCum = computeApproachStats(myRecords, shinkiIds, monthStart, date);

  const reportText = [
    `ゾス！${companyName}の${currentUser?.displayName || ''}です！`,
    `${Number(dParts[1])}月${Number(dParts[2])}日（${dayOfWeek}）の日報を提出します。`,
    `稼働${workedDaysCount}日目/${totalWorkingDays}日`,
    '',
    '【今月のコミット】',
    `粗利/台数：${monthlyCommitProfit}P/${monthlyCommitQuantity}台`,
    `実数　${cumProfit}p/${cumQuantity}台`,
    '',
    '【本日コミット】',
    `時間設定件数：${todayCommitTimeSetting}件`,
    `アポ件数 ：${todayCommitAppt}訪問`,
    `粗利/台数：${todayCommitProfit}P/${todayCommitQuantity}台`,
    '',
    '▪️結果',
    `時間設定件数：${todayTimeSetting}件`,
    `アポ件数 ：${todayVisit}訪問`,
    `粗利/台数：${todayProfit}P/${todayQuantity}台`,
    '',
    '【群私幼アプローチ】',
    `初回時間設定件数　${gunshiyouToday.initialTimeSetting}件`,
    `初回訪問件数　${gunshiyouToday.initialVisit}件`,
    `時間設定件数　${gunshiyouToday.timeSetting}件`,
    `訪問件数　${gunshiyouToday.visit}件`,
    `粗利/台数：${gunshiyouToday.profit}P/${gunshiyouToday.quantity}台`,
    '',
    `累計初回時間設定：${gunshiyouCum.initialTimeSetting}件（代表${gunshiyouCum.initialTimeSettingRep}件、担当${gunshiyouCum.initialTimeSettingStaff}件）`,
    `累計初回訪問件数　${gunshiyouCum.initialVisit}件`,
    `累計時間設定件数：${gunshiyouCum.timeSetting}件`,
    `累計訪問件数　${gunshiyouCum.visit}件`,
    `実数 ${gunshiyouCum.profit}P/${gunshiyouCum.quantity}台`,
    `日々累計必要数：${remainingProfit}P/${remainingQuantity}台(日${dailyNeededProfit}P/${dailyNeededQuantity}台)`,
    '',
    '【ユーザーアプローチ】',
    `1コンタクト完了数　${userStats.contact}件`,
    `2アポ数　${userStats.appt}件`,
    `3訪問数　${userStats.visit}件`,
    `4定例ミーティング実行数　${userStats.meeting}件`,
    `5新規スケジューリング数　${userStats.newSchedule}件`,
    '-----',
    `6：未コンタクト/追客　${userStats.noContact}件`,
    `7：解約リスク　${userStats.churnRisk}件`,
    '',
    `訪問件数　${userToday.visit}件`,
    `累計訪問件数　${userCum.visit}件`,
    `実数 ${userCum.profit}P/${userCum.quantity}台`,
    '',
    '【新規アプローチ】',
    `時間設定件数　${shinkiToday.initialTimeSetting}件`,
    `訪問件数　${shinkiToday.initialVisit}件`,
    `累計時間設定件数　${shinkiCum.initialTimeSetting}件`,
    `累計訪問件数　${shinkiCum.initialVisit}件`,
    `粗利/台数　${shinkiCum.profit}P/${shinkiCum.quantity}台`,
    '',
    '【今日の成長】',
    `・${growthText}`,
    '',
    '【改善点】',
    `・${improvementText}`,
    '',
    '【改善行動】',
    `・${improvementActionText}`,
    '',
    '【来週の目標】',
    `①${nextWeekGoal1}`,
    `②${nextWeekGoal2}`,
    '',
    '【来週のコミット】',
    `時間設定件数：${nextWeekCommitTimeSetting}件`,
    `アポ件数 ：${nextWeekCommitAppt}訪問`,
    `粗利/台数：${nextWeekCommitProfit}P/${nextWeekCommitQuantity}台`,
    '',
    '【紹介取得数】',
    `紹介取得数：${referral.count}件`,
    `商談昇華数：${referral.converted}件`,
    `未アプローチ数：${referral.notApproached}件`,
    '',
    '以上です。',
  ].join('\n');

  const existingLog = dailyReportLogs.find(l => l.date === date);

  const saveLog = () => {
    setDailyReportLogs(prev => {
      const withoutSameDate = prev.filter(l => l.date !== date);
      return [...withoutSameDate, { id: Date.now(), date, text: reportText, createdAt: new Date().toISOString() }];
    });
    showAlert(existingLog ? 'この日の日報を上書き保存しました。' : '日報を保存しました。ログに記録されます。');
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div className="bg-white rounded-xl border border-slate-100 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <FormField label="日付" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <FormField label="会社・支社名" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="例：WEB東京" />
        <NumField label="今月の総稼働予定日数" value={totalWorkingDays} onChange={setTotalWorkingDays} suffix="日" />
        <div className="flex flex-col justify-end">
          <p className="text-xs text-slate-400">自動計算：稼働{workedDaysCount}日目/{totalWorkingDays}日</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-bold text-slate-500 mb-3">コミット（目標）※手入力</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="今月コミット：粗利" value={monthlyCommitProfit} onChange={setMonthlyCommitProfit} suffix="P" />
          <NumField label="今月コミット：台数" value={monthlyCommitQuantity} onChange={setMonthlyCommitQuantity} suffix="台" />
          <NumField label="本日コミット：時間設定" value={todayCommitTimeSetting} onChange={setTodayCommitTimeSetting} />
          <NumField label="本日コミット：アポ" value={todayCommitAppt} onChange={setTodayCommitAppt} suffix="訪問" />
          <NumField label="本日コミット：粗利" value={todayCommitProfit} onChange={setTodayCommitProfit} suffix="P" />
          <NumField label="本日コミット：台数" value={todayCommitQuantity} onChange={setTodayCommitQuantity} suffix="台" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-bold text-slate-500 mb-3">本日の実績（自動集計）</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <div><p className="text-xl font-extrabold text-slate-800">{todayTimeSetting}</p><p className="text-[10px] text-slate-400">時間設定件数</p></div>
          <div><p className="text-xl font-extrabold text-slate-800">{todayVisit}</p><p className="text-[10px] text-slate-400">アポ（訪問）件数</p></div>
          <div><p className="text-xl font-extrabold text-slate-800">{todayProfit}<span className="text-xs font-normal text-slate-400">P</span></p><p className="text-[10px] text-slate-400">粗利</p></div>
          <div><p className="text-xl font-extrabold text-slate-800">{todayQuantity}<span className="text-xs font-normal text-slate-400">台</span></p><p className="text-[10px] text-slate-400">台数</p></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-bold text-slate-500 mb-1">群私幼アプローチ（自動集計・協会の種類「群私幼」）</p>
        <p className="text-[11px] text-slate-400 mb-3">本日: 初回時間設定{gunshiyouToday.initialTimeSetting}件（代表{gunshiyouToday.initialTimeSettingRep}/担当{gunshiyouToday.initialTimeSettingStaff}） / 初回訪問{gunshiyouToday.initialVisit}件 / 時間設定{gunshiyouToday.timeSetting}件 / 訪問{gunshiyouToday.visit}件 / {gunshiyouToday.profit}P・{gunshiyouToday.quantity}台</p>
        <p className="text-[11px] text-slate-500">累計: 初回時間設定{gunshiyouCum.initialTimeSetting}件（代表{gunshiyouCum.initialTimeSettingRep}/担当{gunshiyouCum.initialTimeSettingStaff}） / 初回訪問{gunshiyouCum.initialVisit}件 / 時間設定{gunshiyouCum.timeSetting}件 / 訪問{gunshiyouCum.visit}件 / 実数{gunshiyouCum.profit}P・{gunshiyouCum.quantity}台</p>
        <p className="text-[11px] text-slate-500">日々累計必要数: {remainingProfit}P/{remainingQuantity}台（日{dailyNeededProfit}P/{dailyNeededQuantity}台）</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-bold text-slate-500 mb-3">ユーザーアプローチ ※手入力（既存のフラグでは追跡していない指標のため）</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="1 コンタクト完了数" value={userStats.contact} onChange={v => setUserStats({ ...userStats, contact: v })} />
          <NumField label="2 アポ数" value={userStats.appt} onChange={v => setUserStats({ ...userStats, appt: v })} />
          <NumField label="3 訪問数" value={userStats.visit} onChange={v => setUserStats({ ...userStats, visit: v })} />
          <NumField label="4 定例ミーティング実行数" value={userStats.meeting} onChange={v => setUserStats({ ...userStats, meeting: v })} />
          <NumField label="5 新規スケジューリング数" value={userStats.newSchedule} onChange={v => setUserStats({ ...userStats, newSchedule: v })} />
          <NumField label="6 未コンタクト/追客" value={userStats.noContact} onChange={v => setUserStats({ ...userStats, noContact: v })} />
          <NumField label="7 解約リスク" value={userStats.churnRisk} onChange={v => setUserStats({ ...userStats, churnRisk: v })} />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">自動集計（協会の種類「ユーザー」）：本日訪問{userToday.visit}件 / 累計訪問{userCum.visit}件 / 実数{userCum.profit}P・{userCum.quantity}台</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-bold text-slate-500 mb-1">新規アプローチ（自動集計・協会の種類「新規」）</p>
        <p className="text-[11px] text-slate-400 mb-1">本日: 時間設定{shinkiToday.initialTimeSetting}件 / 訪問{shinkiToday.initialVisit}件</p>
        <p className="text-[11px] text-slate-500">累計: 時間設定{shinkiCum.initialTimeSetting}件 / 訪問{shinkiCum.initialVisit}件 / {shinkiCum.profit}P・{shinkiCum.quantity}台</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
        <p className="text-xs font-bold text-slate-500">所感・自由記述</p>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-500">今日の成長</label>
          <input value={growthText} onChange={e => setGrowthText(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-500">改善点</label>
          <input value={improvementText} onChange={e => setImprovementText(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-500">改善行動</label>
          <input value={improvementActionText} onChange={e => setImprovementActionText(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">来週の目標①</label>
            <input value={nextWeekGoal1} onChange={e => setNextWeekGoal1(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">来週の目標②</label>
            <input value={nextWeekGoal2} onChange={e => setNextWeekGoal2(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-bold text-slate-500 mb-3">来週のコミット ／ 紹介取得数 ※手入力</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumField label="来週コミット：時間設定" value={nextWeekCommitTimeSetting} onChange={setNextWeekCommitTimeSetting} />
          <NumField label="来週コミット：アポ" value={nextWeekCommitAppt} onChange={setNextWeekCommitAppt} suffix="訪問" />
          <NumField label="来週コミット：粗利/台数" value={nextWeekCommitProfit} onChange={setNextWeekCommitProfit} suffix="P" />
          <NumField label="紹介取得数" value={referral.count} onChange={v => setReferral({ ...referral, count: v })} />
          <NumField label="商談昇華数" value={referral.converted} onChange={v => setReferral({ ...referral, converted: v })} />
          <NumField label="未アプローチ数" value={referral.notApproached} onChange={v => setReferral({ ...referral, notApproached: v })} />
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
        <pre className="text-xs whitespace-pre-wrap font-sans text-slate-700">{reportText}</pre>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={reportText} label="日報をコピー" />
        <button onClick={saveLog} className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700">
          <Save className="w-3.5 h-3.5" />{existingLog ? 'この日の日報を上書き保存' : '日報を保存してログに残す'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <button onClick={() => setHistoryOpen(v => !v)} className="w-full flex justify-between items-center text-sm font-bold text-slate-700">
          過去の日報ログ（{dailyReportLogs.length}件）
          <ChevronDown className={`w-4 h-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
        </button>
        {historyOpen && (
          <ul className="mt-3 space-y-2 max-h-96 overflow-y-auto">
            {dailyReportLogs.length === 0 && <p className="text-sm text-slate-400">まだ保存された日報はありません。</p>}
            {dailyReportLogs.slice().sort((a, b) => b.date.localeCompare(a.date)).map(log => (
              <li key={log.id} className="bg-slate-50 rounded-lg p-3">
                <div className="flex justify-between items-center mb-1">
                  <p className="text-xs font-bold text-slate-700">{log.date}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setDate(log.date)} className="text-[11px] text-teal-600 font-semibold">この日を開く</button>
                    <CopyButton text={log.text} label="コピー" />
                  </div>
                </div>
                <pre className="text-[11px] whitespace-pre-wrap font-sans text-slate-500 max-h-24 overflow-y-auto">{log.text}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- カレンダー（訪問予定・再コール予定） ----------
function CalendarView({ records, customers, members, currentUser, isOwner }) {
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week' | 'day'
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [scope, setScope] = useState(isOwner ? 'all' : (currentUser?.displayName || 'all'));

  const customerAssigneeById = useMemo(() => {
    const map = {};
    (customers || []).forEach(c => { map[c.id] = c.assignedTo || ''; });
    return map;
  }, [customers]);
  const effectiveAssignee = (r) => r.assignedTo || customerAssigneeById[r.customerId] || '';
  const scoped = scope === 'all' ? records : records.filter(r => effectiveAssignee(r) === scope);
  const scheduled = scoped.filter(r => r.scheduledDate);
  const byDate = useMemo(() => {
    const map = {};
    scheduled.forEach(r => {
      if (!map[r.scheduledDate]) map[r.scheduledDate] = [];
      map[r.scheduledDate].push(r);
    });
    Object.values(map).forEach(list => list.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || '')));
    return map;
  }, [scheduled]);

  const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayStr = toDateStr(new Date());

  // 表示範囲の移動
  const move = (dir) => {
    const d = new Date(cursor);
    if (viewMode === 'month') d.setMonth(d.getMonth() + dir);
    else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  };

  // 週の開始日（日曜）を求める
  const weekStart = (() => {
    const d = new Date(cursor);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7時〜21時
  const HOUR_HEIGHT = 56; // 1時間あたりの高さ(px)

  const headerLabel = viewMode === 'month'
    ? `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月`
    : viewMode === 'week'
      ? `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 〜 ${weekDays[6].getMonth() + 1}月${weekDays[6].getDate()}日`
      : `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月${cursor.getDate()}日（${WEEKDAY_JA[cursor.getDay()]}）`;

  // 時間グリッド上に予定を配置するための計算
  const eventStyle = (r) => {
    const [h, m] = (r.scheduledTime || '09:00').split(':').map(Number);
    const top = ((h - 7) * 60 + (m || 0)) / 60 * HOUR_HEIGHT;
    return { top: `${Math.max(top, 0)}px`, height: `${HOUR_HEIGHT}px` };
  };

  const findCustomer = (r) => customers.find(c => c.id === r.customerId);

  const renderTimeGrid = (days) => (
    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
      <div className="flex border-b border-slate-100">
        <div className="w-14 shrink-0 border-r border-slate-100" />
        {days.map(d => {
          const ds = toDateStr(d);
          const isToday = ds === todayStr;
          return (
            <div key={ds} className={`flex-1 text-center py-2 ${isToday ? 'bg-teal-50' : ''}`}>
              <p className="text-[11px] text-slate-400">{WEEKDAY_JA[d.getDay()]}</p>
              <p className={`text-lg font-bold ${isToday ? 'text-teal-600' : 'text-slate-700'}`}>{d.getDate()}</p>
            </div>
          );
        })}
      </div>
      <div className="overflow-y-auto max-h-[60vh]">
        <div className="flex relative">
          <div className="w-14 shrink-0 border-r border-slate-100">
            {HOURS.map(h => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className="text-[10px] text-slate-400 text-right pr-1.5 -mt-1.5">
                {h}:00
              </div>
            ))}
          </div>
          {days.map(d => {
            const ds = toDateStr(d);
            const items = byDate[ds] || [];
            return (
              <div key={ds} className="flex-1 relative border-r border-slate-50 last:border-r-0">
                {HOURS.map(h => <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-slate-50" />)}
                {items.map(r => {
                  const cust = findCustomer(r);
                  return (
                    <div key={r.id} style={eventStyle(r)}
                      className="absolute left-0.5 right-0.5 bg-indigo-500 text-white rounded-md px-1.5 py-1 overflow-hidden shadow-sm">
                      <p className="text-[10px] font-bold leading-tight truncate">{r.scheduledTime}</p>
                      <p className="text-[10px] leading-tight truncate">{r.customerName || '不明な顧客'}</p>
                      <p className="text-[9px] leading-tight opacity-80 truncate">{r.type}{r.flag ? `（${r.flag}）` : ''}</p>
                      {cust?.address && <p className="text-[9px] leading-tight opacity-70 truncate">{cust.address}</p>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // 月表示用のセル
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthCells = [];
  for (let i = 0; i < startWeekday; i++) monthCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) monthCells.push(d);
  const monthDateStr = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const selectedItems = selectedDate ? (byDate[selectedDate] || []) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {[['month', '月'], ['week', '週'], ['day', '日']].map(([v, l]) => (
            <button key={v} onClick={() => setViewMode(v)}
              className={`px-4 py-2 rounded-lg text-sm font-bold ${viewMode === v ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {l}
            </button>
          ))}
          <button onClick={() => setCursor(new Date())} className="px-4 py-2 rounded-lg text-sm font-bold bg-white border border-slate-200 text-slate-600">今日</button>
        </div>
        {isOwner && (
          <select value={scope} onChange={e => setScope(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="all">全員</option>
            {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
          </select>
        )}
      </div>

      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-100 p-4">
        <button onClick={() => move(-1)} className="p-2 hover:bg-slate-100 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
        <p className="font-bold text-slate-700">{headerLabel}</p>
        <button onClick={() => move(1)} className="p-2 hover:bg-slate-100 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {viewMode === 'month' && (
        <>
          <div className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="grid grid-cols-7 text-center text-xs font-bold text-slate-400 mb-2">
              {WEEKDAY_JA.map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthCells.map((d, i) => {
                if (d === null) return <div key={i} />;
                const ds = monthDateStr(d);
                const items = byDate[ds] || [];
                const isToday = ds === todayStr;
                return (
                  <button key={i} onClick={() => setSelectedDate(ds)}
                    className={`aspect-square rounded-lg p-1 text-left border transition ${
                      selectedDate === ds ? 'border-teal-500 bg-teal-50' : isToday ? 'border-teal-300' : 'border-transparent hover:border-slate-200'
                    }`}>
                    <span className={`text-xs ${isToday ? 'font-bold text-teal-600' : 'text-slate-600'}`}>{d}</span>
                    {items.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-0.5">
                        {items.slice(0, 3).map((it, idx) => <span key={idx} className="w-1.5 h-1.5 rounded-full bg-indigo-400" />)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDate && (
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <p className="text-sm font-bold text-slate-700 mb-3">{selectedDate} の予定（{selectedItems.length}件）</p>
              {selectedItems.length === 0 ? (
                <p className="text-sm text-slate-400">この日の予定はありません。</p>
              ) : (
                <ul className="space-y-2">
                  {selectedItems.map(r => {
                    const cust = findCustomer(r);
                    return (
                      <li key={r.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                        <div>
                          <span className="font-semibold text-slate-700">{r.customerName || '不明な顧客'}</span>
                          <span className="ml-2 text-slate-400">{r.type}{r.flag ? `（${r.flag}）` : ''}</span>
                          {cust?.address && <p className="text-xs text-slate-400 mt-0.5">{cust.address}</p>}
                        </div>
                        <span className="text-xs text-indigo-600 font-bold shrink-0">{r.scheduledTime || '時間未設定'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {viewMode === 'week' && renderTimeGrid(weekDays)}
      {viewMode === 'day' && renderTimeGrid([cursor])}
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

// ---------- Googleカレンダー連携状況 ----------
function GoogleCalendarStatusCard({ token }) {
  const [status, setStatus] = useState(null); // null=読み込み中, true/false

  useEffect(() => {
    if (!token) return;
    fetch('/api/calendar/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setStatus(!!data.configured))
      .catch(() => setStatus(false));
  }, [token]);

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
      <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4" />Googleカレンダー連携</h3>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${status ? 'bg-teal-500' : 'bg-slate-300'}`} />
        <span className="text-sm font-semibold text-slate-600">
          {status === null ? '確認中...' : status ? '連携済み：予定を保存すると自動でGoogleカレンダーに登録されます' : '未連携'}
        </span>
      </div>
      {!status && (
        <div className="text-sm text-slate-600 leading-relaxed space-y-2">
          <p>連携するには、Renderの環境変数に以下の2つを設定してください。</p>
          <ul className="list-disc list-inside text-xs text-slate-500 space-y-1">
            <li><code className="bg-slate-100 px-1 rounded">GOOGLE_CALENDAR_ID</code>：書き込み先のGoogleカレンダーのID</li>
            <li><code className="bg-slate-100 px-1 rounded">GOOGLE_CALENDAR_CREDENTIALS_JSON</code>：サービスアカウントの認証情報（JSON）</li>
          </ul>
          <p className="text-xs text-slate-400">詳しい取得手順はサポートに聞いてください。設定後、このアプリを再デプロイすると「連携済み」に切り替わります。</p>
        </div>
      )}
    </div>
  );
}

// ---------- メンバー管理（オーナーのみ） ----------
const ROLE_LABELS = { owner: 'オーナー', executive: '役員', emgr: 'EMGR', mgr: 'MGR', smgr: 'SMGR', general: '一般', member: '一般' };
const ROLE_BADGE_CLASS = {
  owner: 'bg-amber-100 text-amber-700', executive: 'bg-rose-100 text-rose-700', emgr: 'bg-violet-100 text-violet-700',
  mgr: 'bg-indigo-100 text-indigo-700', smgr: 'bg-teal-100 text-teal-700',
  general: 'bg-slate-200 text-slate-600', member: 'bg-slate-200 text-slate-600',
};

// ---------- 役職ごとの権限管理 ----------
const EDITABLE_ROLES = ['executive', 'emgr', 'mgr', 'smgr', 'general'];
const PERMISSION_DEFS = [
  { key: 'viewSettings', label: '設定・管理ページの閲覧' },
  { key: 'deleteCustomer', label: '顧客・記録の削除' },
  { key: 'bulkEdit', label: '顧客の一括編集' },
  { key: 'editCaseStudies', label: 'ユーザー管理（導入事例）の編集' },
  { key: 'editKnowledge', label: '営業ノウハウの編集' },
];
const initialRolePermissions = {
  executive: { viewSettings: true, deleteCustomer: true, bulkEdit: true, editCaseStudies: true, editKnowledge: true },
  emgr: { viewSettings: false, deleteCustomer: true, bulkEdit: true, editCaseStudies: true, editKnowledge: true },
  mgr: { viewSettings: false, deleteCustomer: true, bulkEdit: false, editCaseStudies: true, editKnowledge: true },
  smgr: { viewSettings: false, deleteCustomer: false, bulkEdit: false, editCaseStudies: false, editKnowledge: false },
  general: { viewSettings: false, deleteCustomer: false, bulkEdit: false, editCaseStudies: false, editKnowledge: false },
};
function hasPermission(role, key, rolePermissions) {
  if (role === 'owner') return true;
  return !!(rolePermissions?.[role]?.[key]);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Avatar({ photo, name, size = 'w-9 h-9' }) {
  if (photo) return <img src={photo} alt={name} className={`${size} rounded-full object-cover`} />;
  return (
    <div className={`${size} rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-bold shrink-0`}>
      {(name || '?').slice(0, 1)}
    </div>
  );
}

function MembersManagement({ token, currentUser, departments, showAlert, showConfirm }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setMembers(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const isNew = !editing.id;
      const res = await fetch(isNew ? '/api/users' : `/api/users/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存に失敗しました');
      showAlert(isNew ? 'メンバーを追加しました。' : 'メンバー情報を更新しました。');
      setEditing(null);
      load();
    } catch (err) {
      showAlert(err.message);
    }
  };

  const remove = (id) => {
    showConfirm('このメンバーを削除しますか？', async () => {
      try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        load();
      } catch (err) {
        showAlert(err.message);
      }
    });
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showAlert('画像サイズが大きすぎます（2MB以下にしてください）。'); return; }
    const dataUrl = await readFileAsDataUrl(file);
    setEditing(prev => ({ ...prev, photo: dataUrl }));
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
      <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Users className="w-4 h-4" />メンバー管理</h3>
      <button onClick={() => setEditing({ username: '', password: '', displayName: '', role: 'general', department: '', photo: '' })}
        className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold mb-3">
        <Plus className="w-4 h-4" />メンバーを追加
      </button>
      {loading ? <p className="text-sm text-slate-400">読み込み中...</p> : (
        <ul className="space-y-2">
          {members.map(m => (
            <li key={m.id} className="bg-slate-50 rounded-lg p-3 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Avatar photo={m.photo} name={m.displayName} />
                <div>
                  <p className="text-sm font-bold text-slate-700">{m.displayName} <span className="text-xs text-slate-400 font-normal">（{m.username}）</span></p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${ROLE_BADGE_CLASS[m.role] || ROLE_BADGE_CLASS.general}`}>
                      {ROLE_LABELS[m.role] || '一般'}
                    </span>
                    {m.department && <span className="text-[10px] text-slate-400">{m.department}</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing({ ...m, password: '' })} className="p-1.5 text-slate-400 hover:text-teal-600"><Edit className="w-4 h-4" /></button>
                {m.id !== currentUser?.id && (
                  <button onClick={() => remove(m.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={editing.id ? 'メンバー編集' : '新しいメンバー'} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar photo={editing.photo} name={editing.displayName} size="w-14 h-14" />
              <label className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold cursor-pointer">
                写真を選択
                <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
              </label>
              {editing.photo && (
                <button onClick={() => setEditing({ ...editing, photo: '' })} className="text-xs text-red-500">削除</button>
              )}
            </div>
            <FormField label="ユーザー名（ログインID）" value={editing.username} onChange={e => setEditing({ ...editing, username: e.target.value })} />
            <FormField label="表示名" value={editing.displayName} onChange={e => setEditing({ ...editing, displayName: e.target.value })} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">課</label>
              <select value={editing.department || ''} onChange={e => setEditing({ ...editing, department: e.target.value })}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="">未設定</option>
                {(departments || []).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <p className="text-[11px] text-slate-400">課の追加・削除は「商品・フラグ管理」から行えます。</p>
            </div>
            <FormField label={editing.id ? '新しいパスワード（変更する場合のみ）' : 'パスワード'} type="password" value={editing.password} onChange={e => setEditing({ ...editing, password: e.target.value })} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">役職</label>
              <select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="general">一般</option>
                <option value="smgr">SMGR</option>
                <option value="mgr">MGR</option>
                <option value="emgr">EMGR</option>
                <option value="executive">役員</option>
                <option value="owner">オーナー</option>
              </select>
            </div>
          </div>
          <button onClick={save} className="mt-5 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">保存する</button>
        </Modal>
      )}
    </div>
  );
}

// ---------- ユーザー管理（導入事例集） ----------
function emptyDeal() {
  return { id: null, product: '', description: '', background: '', salesP: '', quantity: '', salesRep: '', apptRep: '', orderDate: '', videoLink: '' };
}

function DealModal({ deal, products, members, onSave, onClose }) {
  const [form, setForm] = useState(deal);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title={deal.id ? '事例を編集' : '新しい事例を追加'} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">商材</label>
          <select value={form.product} onChange={set('product')} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">選択してください</option>
            {products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="営業P" type="number" value={form.salesP} onChange={set('salesP')} />
          <FormField label="台数" type="number" value={form.quantity} onChange={set('quantity')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">営業担当</label>
            <select value={form.salesRep} onChange={set('salesRep')} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">未設定</option>
              {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">アポ担当</label>
            <select value={form.apptRep} onChange={set('apptRep')} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">未設定</option>
              {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
            </select>
          </div>
        </div>
        <FormField label="受注日" type="date" value={form.orderDate} onChange={set('orderDate')} />
        <FormField label="動画リンク" value={form.videoLink} onChange={set('videoLink')} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">受注背景</label>
          <textarea value={form.background} onChange={e => setForm({ ...form, background: e.target.value })} rows={3} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">事例としての説明（紹介する時に使える紹介文）</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
        </div>
      </div>
      <button onClick={() => onSave({ ...form, id: form.id || Date.now() })} className="mt-5 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">保存する</button>
    </Modal>
  );
}

function CompanyModal({ company, onSave, onClose }) {
  const [form, setForm] = useState(company);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title={form.id ? '法人情報を編集' : '新しい法人を登録'} onClose={onClose}>
      <div className="space-y-3">
        <FormField label="法人名" value={form.companyName} onChange={set('companyName')} />
        <FormField label="所在地（都道府県・市区町村など）" value={form.location} onChange={set('location')} placeholder="例：群馬県前橋市" />
        <FormField label="HPリンク" value={form.hpLink} onChange={set('hpLink')} />
        <FormField label="GBPリンク" value={form.gbpLink} onChange={set('gbpLink')} />
      </div>
      <button onClick={() => onSave({ ...form, id: form.id || Date.now() })} className="mt-5 w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">保存する</button>
    </Modal>
  );
}

function CaseStudyCard({ company, products, members, currentUser, setCaseStudies, showConfirm, canEdit }) {
  const [expanded, setExpanded] = useState(false);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingDeal, setEditingDeal] = useState(null);
  const [commentText, setCommentText] = useState('');

  const isFavorited = (company.favoritedBy || []).includes(currentUser?.displayName);

  const toggleFavorite = () => {
    setCaseStudies(prev => prev.map(c => {
      if (c.id !== company.id) return c;
      const fav = c.favoritedBy || [];
      const next = fav.includes(currentUser?.displayName) ? fav.filter(n => n !== currentUser.displayName) : [...fav, currentUser.displayName];
      return { ...c, favoritedBy: next };
    }));
  };

  const saveCompany = (data) => {
    setCaseStudies(prev => prev.map(c => c.id === company.id ? { ...c, ...data } : c));
    setEditingCompany(false);
  };

  const removeCompany = () => {
    showConfirm(`「${company.companyName}」を削除しますか？登録された事例・コメントもすべて削除されます。`, () => {
      setCaseStudies(prev => prev.filter(c => c.id !== company.id));
    });
  };

  const saveDeal = (deal) => {
    setCaseStudies(prev => prev.map(c => {
      if (c.id !== company.id) return c;
      const deals = c.deals || [];
      const exists = deals.some(d => d.id === deal.id);
      return { ...c, deals: exists ? deals.map(d => d.id === deal.id ? deal : d) : [...deals, deal] };
    }));
    setEditingDeal(null);
  };

  const removeDeal = (dealId) => {
    showConfirm('この事例を削除しますか？', () => {
      setCaseStudies(prev => prev.map(c => c.id === company.id ? { ...c, deals: (c.deals || []).filter(d => d.id !== dealId) } : c));
    });
  };

  const addComment = () => {
    if (!commentText.trim()) return;
    setCaseStudies(prev => prev.map(c => c.id === company.id ? {
      ...c,
      comments: [...(c.comments || []), { id: Date.now(), author: currentUser?.displayName || '', text: commentText.trim(), createdAt: new Date().toISOString().substring(0, 16).replace('T', ' ') }],
    } : c));
    setCommentText('');
  };

  const removeComment = (commentId) => {
    setCaseStudies(prev => prev.map(c => c.id === company.id ? { ...c, comments: (c.comments || []).filter(cm => cm.id !== commentId) } : c));
  };

  const deals = company.deals || [];
  const comments = company.comments || [];

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold text-slate-800">{company.companyName}</p>
            {company.location && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{company.location}</p>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={toggleFavorite} className={`p-1.5 rounded-lg ${isFavorited ? 'text-rose-500 bg-rose-50' : 'text-slate-300 hover:text-rose-400 hover:bg-rose-50'}`} title="お気に入り">
              <Heart className={`w-4 h-4 ${isFavorited ? 'fill-rose-500' : ''}`} />
            </button>
            {canEdit && (
              <>
                <button onClick={() => setEditingCompany(true)} className="p-1.5 text-slate-300 hover:text-teal-600"><Edit className="w-4 h-4" /></button>
                <button onClick={removeCompany} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          {company.hpLink && <a href={company.hpLink} target="_blank" rel="noreferrer" title="HP" className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100"><Globe className="w-3.5 h-3.5" /></a>}
          {company.gbpLink && <a href={company.gbpLink} target="_blank" rel="noreferrer" title="GBP" className="p-1.5 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100"><Star className="w-3.5 h-3.5" /></a>}
          <span className="text-xs text-slate-400">事例{deals.length}件 ・ コメント{comments.length}件</span>
        </div>

        <button onClick={() => setExpanded(v => !v)} className="mt-3 w-full flex justify-between items-center text-xs font-bold text-teal-700 border-t border-slate-100 pt-3">
          詳細を{expanded ? '閉じる' : '見る'}
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <p className="text-xs font-bold text-slate-500">導入事例</p>
              {canEdit && (
                <button onClick={() => setEditingDeal(emptyDeal())} className="flex items-center gap-1 text-xs text-teal-600 font-bold"><Plus className="w-3.5 h-3.5" />事例を追加</button>
              )}
            </div>
            {deals.length === 0 ? (
              <p className="text-xs text-slate-400">まだ事例が登録されていません。</p>
            ) : (
              <ul className="space-y-2">
                {deals.map(d => (
                  <li key={d.id} className="bg-white rounded-lg p-3 border border-slate-100">
                    <div className="flex justify-between items-start">
                      <p className="text-sm font-bold text-slate-700">{d.product || '（商材未設定）'} <span className="text-xs font-normal text-slate-400">{d.orderDate}</span></p>
                      {canEdit && (
                        <div className="flex gap-1">
                          <button onClick={() => setEditingDeal(d)} className="p-1 text-slate-300 hover:text-teal-600"><Edit className="w-3.5 h-3.5" /></button>
                          <button onClick={() => removeDeal(d.id)} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">営業P: {d.salesP || 0} ・ 台数: {d.quantity || 0} ・ 営業担当: {d.salesRep || '-'} ・ アポ担当: {d.apptRep || '-'}</p>
                    {d.background && <p className="text-xs text-slate-500 mt-1">受注背景: {d.background}</p>}
                    {d.description && <p className="text-xs text-slate-700 mt-1 bg-teal-50 rounded p-2">{d.description}</p>}
                    {d.videoLink && <a href={d.videoLink} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline flex items-center gap-1 mt-1"><Video className="w-3 h-3" />動画を見る</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />コメント（活用方法の共有）</p>
            {comments.length === 0 ? (
              <p className="text-xs text-slate-400 mb-2">まだコメントはありません。</p>
            ) : (
              <ul className="space-y-1.5 mb-2">
                {comments.map(cm => (
                  <li key={cm.id} className="bg-white rounded-lg p-2.5 border border-slate-100 text-xs">
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-slate-600">{cm.author}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">{cm.createdAt}</span>
                        {cm.author === currentUser?.displayName && (
                          <button onClick={() => removeComment(cm.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                        )}
                      </div>
                    </div>
                    <p className="text-slate-600 mt-1">{cm.text}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="この事例をどう活用したか共有..."
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs" />
              <button onClick={addComment} className="px-3 py-2 bg-slate-700 text-white rounded-lg text-xs font-bold">投稿</button>
            </div>
          </div>
        </div>
      )}

      {editingCompany && <CompanyModal company={company} onSave={saveCompany} onClose={() => setEditingCompany(false)} />}
      {editingDeal && <DealModal deal={editingDeal} products={products} members={members} onSave={saveDeal} onClose={() => setEditingDeal(null)} />}
    </div>
  );
}

function CaseStudiesView({ caseStudies, setCaseStudies, products, members, currentUser, showConfirm, canEdit }) {
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [addingCompany, setAddingCompany] = useState(false);

  const locationOptions = [...new Set(caseStudies.map(c => c.location).filter(Boolean))];

  const filtered = caseStudies.filter(c => {
    const q = search.toLowerCase();
    const matchesSearch = !q || c.companyName.toLowerCase().includes(q);
    const matchesLocation = !locationFilter || c.location === locationFilter;
    const matchesFavorite = !favoritesOnly || (c.favoritedBy || []).includes(currentUser?.displayName);
    return matchesSearch && matchesLocation && matchesFavorite;
  });

  const addCompany = (data) => {
    setCaseStudies(prev => [...prev, { ...data, id: Date.now(), deals: [], comments: [], favoritedBy: [] }]);
    setAddingCompany(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="法人名で検索"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white" />
          </div>
          <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">すべての場所</option>
            {locationOptions.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <label className="flex items-center gap-1.5 px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer select-none">
            <input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} className="accent-rose-500" />
            <Heart className="w-3.5 h-3.5 text-rose-500" />
            お気に入りのみ
          </label>
        </div>
        {canEdit && (
          <button onClick={() => setAddingCompany(true)} className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700">
            <Plus className="w-4 h-4" />法人を登録
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(c => (
          <CaseStudyCard key={c.id} company={c} products={products} members={members} currentUser={currentUser} setCaseStudies={setCaseStudies} showConfirm={showConfirm} canEdit={canEdit} />
        ))}
        {filtered.length === 0 && <p className="text-sm text-slate-400 col-span-full text-center py-10">該当する法人がありません。</p>}
      </div>

      {addingCompany && canEdit && (
        <CompanyModal company={{ id: null, companyName: '', location: '', hpLink: '', gbpLink: '' }} onSave={addCompany} onClose={() => setAddingCompany(false)} />
      )}
    </div>
  );
}

// ---------- 営業ノウハウページ ----------
function KnowledgeBaseView({ articles, setArticles, knowledgeTags, members, currentUser, showConfirm, showAlert, canEdit }) {
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selected, setSelected] = useState(null); // article being viewed
  const [editing, setEditing] = useState(null); // article being edited/created

  const filtered = articles.filter(a => {
    const matchesSearch = !search || a.title.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !tagFilter || (a.tags || []).includes(tagFilter);
    return matchesSearch && matchesTag;
  });

  const save = () => {
    setArticles(prev => {
      const exists = prev.some(a => a.id === editing.id);
      const clean = { ...editing, id: editing.id || Date.now(), updatedAt: new Date().toISOString().substring(0, 10), updatedBy: currentUser?.displayName || '' };
      return exists ? prev.map(a => a.id === editing.id ? clean : a) : [...prev, clean];
    });
    setSelected(null);
    setEditing(null);
  };

  const remove = (id) => {
    showConfirm('この記事を削除しますか？', () => {
      setArticles(prev => prev.filter(a => a.id !== id));
      setSelected(null);
    });
  };

  const toggleTag = (tagName) => {
    setEditing(prev => {
      const tags = prev.tags || [];
      return { ...prev, tags: tags.includes(tagName) ? tags.filter(t => t !== tagName) : [...tags, tagName] };
    });
  };

  const handleFileAdd = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // データベースに保存するため、大きすぎるファイルは制限する
    if (file.size > 3 * 1024 * 1024) {
      showAlert('ファイルサイズが大きすぎます（3MB以下にしてください）。大きい資料はGoogleドライブ等のリンクを本文に貼る方法をおすすめします。');
      e.target.value = '';
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setEditing(prev => ({ ...prev, files: [...(prev.files || []), { id: Date.now(), name: file.name, data: dataUrl }] }));
    e.target.value = '';
  };

  const removeFile = (fileId) => {
    setEditing(prev => ({ ...prev, files: (prev.files || []).filter(f => f.id !== fileId) }));
  };

  if (editing) {
    return (
      <div className="max-w-2xl space-y-4">
        <FormField label="タイトル" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">フラグ（複数選択可）</label>
          <div className="flex flex-wrap gap-2">
            {knowledgeTags.map(t => {
              const active = (editing.tags || []).includes(t.name);
              return (
                <button key={t.id} onClick={() => toggleTag(t.name)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${active ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                  {t.name}
                </button>
              );
            })}
            {knowledgeTags.length === 0 && <p className="text-xs text-slate-400">フラグが未登録です。「設定・管理」から追加できます。</p>}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">担当者</label>
          <select value={editing.assignedTo || ''} onChange={e => setEditing({ ...editing, assignedTo: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">未設定</option>
            {members.map(m => <option key={m.id} value={m.displayName}>{m.displayName}</option>)}
          </select>
        </div>

        <FormField label="YouTubeリンク（任意）" value={editing.ytLink || ''} onChange={e => setEditing({ ...editing, ytLink: e.target.value })} placeholder="https://www.youtube.com/watch?v=..." />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">資料（PDFなど・1ファイル3MBまで）</label>
          {(editing.files || []).length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {(editing.files || []).map(f => (
                <li key={f.id} className="flex justify-between items-center px-3 py-2 bg-slate-50 rounded-lg text-xs">
                  <span className="flex items-center gap-1.5 truncate"><FileText className="w-3.5 h-3.5 shrink-0" />{f.name}</span>
                  <button onClick={() => removeFile(f.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold cursor-pointer self-start">
            <Upload className="w-3.5 h-3.5" />資料を追加
            <input type="file" onChange={handleFileAdd} className="hidden" />
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">内容</label>
          <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={16}
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono" />
        </div>
        <div className="flex gap-2">
          <button onClick={save} className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700">保存する</button>
          <button onClick={() => setEditing(null)} className="px-5 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">キャンセル</button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="max-w-2xl space-y-4">
        <button onClick={() => setSelected(null)} className="text-sm text-teal-600 font-semibold flex items-center gap-1"><ChevronLeft className="w-4 h-4" />一覧に戻る</button>
        <div className="bg-white rounded-xl border border-slate-100 p-6">
          <div className="flex justify-between items-start mb-3">
            <h3 className="text-lg font-bold text-slate-800">{selected.title}</h3>
            {canEdit && (
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(selected)} className="p-1.5 text-slate-300 hover:text-teal-600"><Edit className="w-4 h-4" /></button>
                <button onClick={() => remove(selected.id)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
          {(selected.tags || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(selected.tags || []).map(t => (
                <span key={t} className="px-2.5 py-1 bg-teal-50 text-teal-700 rounded-full text-[11px] font-bold">{t}</span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400 mb-4">
            最終更新: {selected.updatedAt}（{selected.updatedBy}）
            {selected.assignedTo ? ` ・ 担当: ${selected.assignedTo}` : ''}
          </p>
          {selected.ytLink && (
            <a href={selected.ytLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mb-4 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100">
              <Video className="w-4 h-4" />YouTubeで動画を見る
            </a>
          )}
          {(selected.files || []).length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-500 mb-2">添付資料</p>
              <ul className="space-y-1.5">
                {(selected.files || []).map(f => (
                  <li key={f.id}>
                    <a href={f.data} download={f.name} className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100">
                      <FileText className="w-3.5 h-3.5" />{f.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{selected.body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="タイトルで検索"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white" />
          </div>
          <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">すべてのフラグ</option>
            {knowledgeTags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        {canEdit && (
          <button onClick={() => setEditing({ id: null, title: '', body: '', ytLink: '', tags: [], files: [], assignedTo: '' })} className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700">
            <Plus className="w-4 h-4" />新しい記事
          </button>
        )}
      </div>

      {knowledgeTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setTagFilter('')} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${!tagFilter ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200'}`}>すべて</button>
          {knowledgeTags.map(t => (
            <button key={t.id} onClick={() => setTagFilter(t.name)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${tagFilter === t.name ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">該当する記事がありません。</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(a => (
            <button key={a.id} onClick={() => setSelected(a)} className="text-left bg-white rounded-xl border border-slate-100 p-4 hover:shadow-md hover:border-teal-200 transition">
              <p className="font-bold text-slate-800 flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-teal-600" />{a.title}
                {a.ytLink && <Video className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                {(a.files || []).length > 0 && <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
              </p>
              {(a.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(a.tags || []).map(t => <span key={t} className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full text-[10px] font-bold">{t}</span>)}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1.5">{a.updatedAt}（{a.updatedBy}）{a.assignedTo ? ` ・ 担当: ${a.assignedTo}` : ''}</p>
              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{a.body}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 権限管理（役職ごとの公開設定） ----------
function RolePermissionsView({ rolePermissions, setRolePermissions }) {
  const toggle = (role, key) => {
    setRolePermissions(prev => ({
      ...prev,
      [role]: { ...(prev[role] || {}), [key]: !(prev[role]?.[key]) },
    }));
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
      <h3 className="font-bold text-slate-700 mb-1 flex items-center gap-2"><Settings className="w-4 h-4" />役職ごとの権限管理</h3>
      <p className="text-xs text-slate-400 mb-4">オーナーはすべての権限を常に持っています（変更できません）。各役職ごとに、機能の利用可否を設定してください。</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-3 py-2">機能</th>
              {EDITABLE_ROLES.map(role => <th key={role} className="px-3 py-2 text-center">{ROLE_LABELS[role]}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_DEFS.map(p => (
              <tr key={p.key} className="border-b border-slate-50">
                <td className="px-3 py-2.5 text-slate-700">{p.label}</td>
                {EDITABLE_ROLES.map(role => (
                  <td key={role} className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={!!rolePermissions?.[role]?.[p.key]}
                      onChange={() => toggle(role, p.key)}
                      className="w-4 h-4 accent-teal-600 cursor-pointer"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 設定・管理（オーナー専用：報告フォーマット／商品・フラグ／メンバー／データ運用） ----------
function SettingsView({
  reportTemplates, setReportTemplates, dailyReportTemplates, setDailyReportTemplates,
  products, setProducts, activityTypes, setActivityTypes, associationTypes, setAssociationTypes,
  knowledgeTags, setKnowledgeTags, departments, setDepartments,
  rolePermissions, setRolePermissions, isOwner,
  token, currentUser, showAlert, showConfirm,
}) {
  const [innerTab, setInnerTab] = useState('templates');
  const [editingTpl, setEditingTpl] = useState(null); // { kind: 'report' | 'daily', ...tpl }

  const saveTpl = (tpl) => {
    const setter = tpl.kind === 'daily' ? setDailyReportTemplates : setReportTemplates;
    setter(prev => {
      const exists = prev.some(p => p.id === tpl.id);
      const clean = { id: tpl.id, name: tpl.name, body: tpl.body };
      return exists ? prev.map(p => p.id === tpl.id ? clean : p) : [...prev, clean];
    });
    setEditingTpl(null);
  };

  const deleteTpl = (kind, id) => {
    const setter = kind === 'daily' ? setDailyReportTemplates : setReportTemplates;
    showConfirm('このフォーマットを削除しますか？', () => setter(prev => prev.filter(p => p.id !== id)));
  };

  const TABS = [
    ['templates', '報告フォーマット'],
    ['products', '商品・フラグ管理'],
    ...(isOwner ? [['members', 'メンバー管理'], ['permissions', '権限管理']] : []),
    ['data', 'データ運用'],
  ];

  return (
    <div>
      <div className="flex gap-2 mb-5 flex-wrap">
        {TABS.map(([v, l]) => (
          <button key={v} onClick={() => setInnerTab(v)} className={`px-4 py-2 rounded-lg text-sm font-bold ${innerTab === v ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{l}</button>
        ))}
      </div>

      {innerTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><ClipboardList className="w-4 h-4" />顧客向け報告フォーマット</h3>
            <button onClick={() => setEditingTpl({ kind: 'report', id: null, name: '', body: '' })} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold mb-3">
              <Plus className="w-4 h-4" />新しいフォーマット
            </button>
            <ul className="space-y-2">
              {reportTemplates.map(t => (
                <li key={t.id} className="bg-slate-50 rounded-lg p-3 flex justify-between items-start">
                  <p className="text-sm font-bold text-slate-700">{t.name}</p>
                  <div className="flex gap-1">
                    <button onClick={() => setEditingTpl({ kind: 'report', ...t })} className="p-1.5 text-slate-400 hover:text-teal-600"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => deleteTpl('report', t.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400 pt-3">利用可能な変数: {'{{法人名}} {{園名}} {{理事長}} {{園長}} {{住所}} {{TEL}} {{HPリンク}} {{メモ}} {{結果}}'}</p>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" />日報フォーマット</h3>
            <button onClick={() => setEditingTpl({ kind: 'daily', id: null, name: '', body: '' })} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold mb-3">
              <Plus className="w-4 h-4" />新しいフォーマット
            </button>
            <ul className="space-y-2">
              {dailyReportTemplates.map(t => (
                <li key={t.id} className="bg-slate-50 rounded-lg p-3 flex justify-between items-start">
                  <p className="text-sm font-bold text-slate-700">{t.name}</p>
                  <div className="flex gap-1">
                    <button onClick={() => setEditingTpl({ kind: 'daily', ...t })} className="p-1.5 text-slate-400 hover:text-teal-600"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => deleteTpl('daily', t.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400 pt-3">利用可能な変数: {'{{日付}} {{テレアポ件数}} {{初回訪問件数}} {{営業件数}} {{受注件数}} {{台数}} {{営業P}} {{自由記述}}'}</p>
          </div>
        </div>
      )}

      {innerTab === 'products' && (
        <ProductsAndFlagsView products={products} setProducts={setProducts} activityTypes={activityTypes} setActivityTypes={setActivityTypes} associationTypes={associationTypes} setAssociationTypes={setAssociationTypes} knowledgeTags={knowledgeTags} setKnowledgeTags={setKnowledgeTags} departments={departments} setDepartments={setDepartments} showConfirm={showConfirm} />
      )}

      {innerTab === 'members' && (
        <MembersManagement token={token} currentUser={currentUser} departments={departments} showAlert={showAlert} showConfirm={showConfirm} />
      )}

      {innerTab === 'permissions' && (
        <RolePermissionsView rolePermissions={rolePermissions} setRolePermissions={setRolePermissions} />
      )}

      {innerTab === 'data' && (
        <div className="space-y-6">
          <GoogleCalendarStatusCard token={token} />

          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Globe className="w-4 h-4" />スプレッドシートとの連携について</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              このアプリはデータをデータベースに保存する仕組みのため、Googleスプレッドシートと自動で常時同期することはできません。
            </p>
            <p className="text-sm text-slate-600 leading-relaxed mt-2">
              代わりに「顧客リスト」画面の <strong>CSV出力</strong> ボタンで最新データをダウンロードし、スプレッドシートに貼り付けてください。逆にスプレッドシート側の情報をこのアプリに取り込みたい場合は、スプレッドシートを「CSV形式（UTF-8）」で書き出し、<strong>CSVインポート</strong> ボタンから読み込んでください。
            </p>
          </div>
        </div>
      )}

      {editingTpl && (
        <Modal title={editingTpl.id ? 'フォーマットを編集' : '新しいフォーマット'} onClose={() => setEditingTpl(null)}>
          <div className="space-y-3">
            <FormField label="フォーマット名" value={editingTpl.name} onChange={e => setEditingTpl({ ...editingTpl, name: e.target.value })} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">本文</label>
              <textarea value={editingTpl.body} onChange={e => setEditingTpl({ ...editingTpl, body: e.target.value })} rows={8}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm resize-y max-h-72" />
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
function ProductsAndFlagsView({ products, setProducts, activityTypes, setActivityTypes, associationTypes, setAssociationTypes, knowledgeTags, setKnowledgeTags, departments, setDepartments, showConfirm }) {
  const [newProduct, setNewProduct] = useState('');
  const [newType, setNewType] = useState('');
  const [flagDraft, setFlagDraft] = useState({});
  const [newAssociationType, setNewAssociationType] = useState('');
  const [newKnowledgeTag, setNewKnowledgeTag] = useState('');
  const [newDepartment, setNewDepartment] = useState('');

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

  const removeType = (typeId, typeName) => {
    showConfirm(`活動種別「${typeName}」を削除しますか？\nこの種別を使った過去の記録は残りますが、選択肢からは無くなります。`, () => {
      setActivityTypes(activityTypes.filter(a => a.id !== typeId));
    });
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

  const addAssociationType = () => {
    if (!newAssociationType.trim()) return;
    setAssociationTypes([...associationTypes, { id: Date.now(), name: newAssociationType.trim() }]);
    setNewAssociationType('');
  };

  const addKnowledgeTag = () => {
    if (!newKnowledgeTag.trim()) return;
    setKnowledgeTags([...(knowledgeTags || []), { id: Date.now(), name: newKnowledgeTag.trim() }]);
    setNewKnowledgeTag('');
  };

  const addDepartment = () => {
    if (!newDepartment.trim()) return;
    setDepartments([...(departments || []), { id: Date.now(), name: newDepartment.trim() }]);
    setNewDepartment('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Package className="w-4 h-4" />商品管理</h3>
        <div className="flex gap-2 mb-4">
          <input value={newProduct} onChange={e => setNewProduct(e.target.value)} placeholder="新しい商品名" autoComplete="off"
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
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><ClipboardList className="w-4 h-4" />協会の種類管理</h3>
        <p className="text-xs text-slate-400 mb-3">ここで登録した選択肢が、顧客登録フォームの「協会の種類」プルダウンに反映されます。</p>
        <div className="flex gap-2 mb-4">
          <input value={newAssociationType} onChange={e => setNewAssociationType(e.target.value)} placeholder="例：〇〇県私立幼稚園協会" autoComplete="off"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addAssociationType} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold">追加</button>
        </div>
        <ul className="space-y-1.5">
          {associationTypes.map(a => (
            <li key={a.id} className="flex justify-between items-center px-3 py-2 bg-slate-50 rounded-lg text-sm">
              {a.name}
              <button onClick={() => setAssociationTypes(associationTypes.filter(x => x.id !== a.id))} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 lg:col-span-2">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Users className="w-4 h-4" />課の管理</h3>
        <p className="text-xs text-slate-400 mb-3">ここで登録した課が、メンバー管理の「課」プルダウンとHOME画面の集計切り替えに反映されます。</p>
        <div className="flex gap-2 mb-4">
          <input value={newDepartment} onChange={e => setNewDepartment(e.target.value)} placeholder="例：WEB営業　東京　１課" autoComplete="off"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addDepartment} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold">追加</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(departments || []).map(d => (
            <span key={d.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-full text-sm">
              {d.name}
              <button onClick={() => setDepartments((departments || []).filter(x => x.id !== d.id))} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
          {(departments || []).length === 0 && <p className="text-xs text-slate-400">課が未登録です。</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 lg:col-span-2">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><BookOpen className="w-4 h-4" />営業ノウハウのフラグ管理</h3>
        <p className="text-xs text-slate-400 mb-3">ここで登録したフラグが、営業ノウハウページの記事に付けられるようになります。</p>
        <div className="flex gap-2 mb-4">
          <input value={newKnowledgeTag} onChange={e => setNewKnowledgeTag(e.target.value)} placeholder="例：テレアポ" autoComplete="off"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addKnowledgeTag} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold">追加</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(knowledgeTags || []).map(t => (
            <span key={t.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-full text-sm">
              {t.name}
              <button onClick={() => setKnowledgeTags((knowledgeTags || []).filter(x => x.id !== t.id))} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
          {(knowledgeTags || []).length === 0 && <p className="text-xs text-slate-400">フラグが未登録です。</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 lg:col-span-2">
        <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Filter className="w-4 h-4" />活動種別・結果フラグ管理</h3>
        <div className="flex gap-2 mb-4">
          <input value={newType} onChange={e => setNewType(e.target.value)} placeholder="新しい活動種別" autoComplete="off"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addType} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold">追加</button>
        </div>
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {activityTypes.map(a => (
            <div key={a.id} className="border border-slate-100 rounded-lg p-3">
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-bold text-slate-700">{a.name}</p>
                <button onClick={() => removeType(a.id, a.name)} className="p-1 text-slate-300 hover:text-red-500" title="この活動種別を削除">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
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
                  placeholder="フラグを追加" autoComplete="off" className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs" />
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
  const { token, user, authLoading, login, logout, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [members, setMembers] = useState([]);
  const [alertMsg, setAlertMsg] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customerFilters, setCustomerFilters] = useState({
    search: '', addressFilter: '', statusFilter: '', associationFilter: '',
    activityTypeFilter: '', flagFilter: '', assigneeFilter: '', viewMode: 'card', firstVisitFilter: '', excludeCompanyOverlap: false, excludeUser: false,
  });
  const [pendingViewCustomerId, setPendingViewCustomerId] = useState(null);
  const openCustomerFromHome = (customerId) => {
    setPendingViewCustomerId(customerId);
    setActiveTab('customers');
  };
  const [accountOpen, setAccountOpen] = useState(false);

  const showAlert = (msg) => setAlertMsg(msg);
  const showConfirm = (msg, onConfirm) => setConfirmState({ msg, onConfirm });
  const isOwner = user?.role === 'owner';

  const { data, makeSetter, loaded: dataLoaded, syncError } = useSyncedData({
    customers: [], records: [], products: initialProducts, activityTypes: initialActivityTypes,
    goals: initialGoals, emailTemplates: initialEmailTemplates, reportTemplates: initialReportTemplates,
    dailyReportTemplates: initialDailyReportTemplates, associationTypes: initialAssociationTypes, dailyReportLogs: [],
    caseStudies: initialCaseStudies, knowledgeArticles: initialKnowledgeArticles,
    knowledgeTags: initialKnowledgeTags, departments: initialDepartments,
    rolePermissions: initialRolePermissions,
  }, token, logout);

  const { customers, records, products, activityTypes, goals, emailTemplates, reportTemplates, dailyReportTemplates, associationTypes, dailyReportLogs, caseStudies, knowledgeArticles, rolePermissions, knowledgeTags, departments } = data;
  const canViewSettings = isOwner || hasPermission(user?.role, 'viewSettings', rolePermissions);
  const canDeleteCustomer = isOwner || hasPermission(user?.role, 'deleteCustomer', rolePermissions);
  const canBulkEdit = isOwner || hasPermission(user?.role, 'bulkEdit', rolePermissions);
  const canEditCaseStudies = isOwner || hasPermission(user?.role, 'editCaseStudies', rolePermissions);
  const canEditKnowledge = isOwner || hasPermission(user?.role, 'editKnowledge', rolePermissions);
  const setCustomers = makeSetter('customers');
  const setRecords = makeSetter('records');
  const setProducts = makeSetter('products');
  const setActivityTypes = makeSetter('activityTypes');
  const setGoals = makeSetter('goals');
  const setEmailTemplates = makeSetter('emailTemplates');
  const setReportTemplates = makeSetter('reportTemplates');
  const setDailyReportTemplates = makeSetter('dailyReportTemplates');
  const setAssociationTypes = makeSetter('associationTypes');
  const setDailyReportLogs = makeSetter('dailyReportLogs');
  const setCaseStudies = makeSetter('caseStudies');
  const setKnowledgeArticles = makeSetter('knowledgeArticles');
  const setRolePermissions = makeSetter('rolePermissions');
  const setKnowledgeTags = makeSetter('knowledgeTags');
  const setDepartments = makeSetter('departments');

  // メンバー一覧（担当者選択・絞り込み用）を取得
  useEffect(() => {
    if (!token) return;
    fetch('/api/members', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(list => setMembers(Array.isArray(list) ? list : []))
      .catch(() => setMembers([]));
  }, [token]);

  // 権限のないタブ（設定・管理）に一般メンバーが残ってしまっていたらHOMEへ戻す
  useEffect(() => {
    if (activeTab === 'settings' && !canViewSettings) setActiveTab('home');
  }, [activeTab, canViewSettings]);

  const menuItems = [
    { id: 'home', icon: <Home className="w-4 h-4" />, label: 'HOME' },
    { id: 'customers', icon: <Users className="w-4 h-4" />, label: '顧客リスト' },
    { id: 'calendar', icon: <CalendarDays className="w-4 h-4" />, label: 'カレンダー' },
    { id: 'teleappt_stats', icon: <BarChart className="w-4 h-4" />, label: 'テレアポ集計' },
    { id: 'daily_report', icon: <FileText className="w-4 h-4" />, label: '日報' },
    { id: 'email', icon: <Mail className="w-4 h-4" />, label: 'メール制作' },
    { id: 'case_studies', icon: <Briefcase className="w-4 h-4" />, label: 'ユーザー管理' },
    { id: 'knowledge', icon: <BookOpen className="w-4 h-4" />, label: '営業ノウハウ' },
    { id: 'ai', icon: <Sparkles className="w-4 h-4" />, label: 'AIアシスタント' },
    ...(canViewSettings ? [{ id: 'settings', icon: <Settings className="w-4 h-4" />, label: '設定・管理' }] : []),
  ];

  const titles = {
    home: 'HOME', customers: '顧客リスト', calendar: 'カレンダー', teleappt_stats: 'テレアポ集計', daily_report: '日報',
    email: 'メール制作', case_studies: 'ユーザー管理（導入事例）', knowledge: '営業ノウハウ', ai: 'AIアシスタント', settings: '設定・管理',
  };

  // 未ログイン
  if (authLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-50 flex-col">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mb-4" />
        <p className="text-slate-400 font-bold text-sm">読み込み中...</p>
      </div>
    );
  }
  if (!user) {
    return <LoginView onLogin={login} />;
  }

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
        <button onClick={() => setAccountOpen(true)} className="p-0.5"><Avatar photo={user.photo} name={user.displayName} size="w-7 h-7" /></button>
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
        <button onClick={() => setAccountOpen(true)} className="mx-3 mb-2 px-3 py-2.5 bg-slate-700/60 hover:bg-slate-700 rounded-lg text-left flex items-center gap-2.5">
          <Avatar photo={user.photo} name={user.displayName} size="w-8 h-8" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{user.displayName}</p>
            <p className="text-[10px] text-slate-400">{ROLE_LABELS[user.role] || '一般'} ・ アカウント設定</p>
          </div>
        </button>
        <div className="px-5 pb-4 text-[10px] flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${syncError ? 'bg-red-400' : 'bg-teal-400'}`} />
          <span className={syncError ? 'text-red-300' : 'text-slate-500'}>{syncError ? '保存に失敗しました（通信を確認してください）' : 'サーバーと同期中'}</span>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-16 md:pt-8">
        <h2 className="hidden md:block text-xl font-bold text-slate-800 mb-6">{titles[activeTab]}</h2>
        {activeTab === 'home' && (
          <HomeView records={records} customers={customers} goals={goals} setGoals={setGoals} currentUser={user} isOwner={isOwner} members={members} departments={departments || []} onNavigate={setActiveTab} onOpenCustomer={openCustomerFromHome} />
        )}
        {activeTab === 'customers' && (
          <CustomersView
            customers={customers} setCustomers={setCustomers}
            records={records} setRecords={setRecords}
            activityTypes={activityTypes} products={products}
            reportTemplates={reportTemplates} associationTypes={associationTypes}
            members={members} currentUser={user} isOwner={isOwner} token={token}
            canDeleteCustomer={canDeleteCustomer} canBulkEdit={canBulkEdit}
            showAlert={showAlert} showConfirm={showConfirm}
            filters={customerFilters} setFilters={setCustomerFilters}
            pendingViewCustomerId={pendingViewCustomerId} clearPendingViewCustomer={() => setPendingViewCustomerId(null)}
          />
        )}
        {activeTab === 'teleappt_stats' && <TeleApptStatsView records={records} customers={customers} activityTypes={activityTypes} members={members} currentUser={user} isOwner={isOwner} />}
        {activeTab === 'calendar' && <CalendarView records={records} customers={customers} members={members} currentUser={user} isOwner={isOwner} />}
        {activeTab === 'daily_report' && (
          <DailyReportView
            records={records} customers={customers} currentUser={user}
            dailyReportLogs={dailyReportLogs} setDailyReportLogs={setDailyReportLogs}
            showAlert={showAlert}
          />
        )}
        {activeTab === 'email' && (
          <EmailBuilderView customers={customers} emailTemplates={emailTemplates} setEmailTemplates={setEmailTemplates} showAlert={showAlert} showConfirm={showConfirm} />
        )}
        {activeTab === 'case_studies' && (
          <CaseStudiesView caseStudies={caseStudies} setCaseStudies={setCaseStudies} products={products} members={members} currentUser={user} showConfirm={showConfirm} canEdit={canEditCaseStudies} />
        )}
        {activeTab === 'knowledge' && (
          <KnowledgeBaseView articles={knowledgeArticles} setArticles={setKnowledgeArticles} knowledgeTags={knowledgeTags || []} members={members} currentUser={user} showConfirm={showConfirm} showAlert={showAlert} canEdit={canEditKnowledge} />
        )}
        {activeTab === 'ai' && <AIAssistantView customers={customers} records={records} />}
        {activeTab === 'settings' && canViewSettings && (
          <SettingsView
            reportTemplates={reportTemplates} setReportTemplates={setReportTemplates}
            dailyReportTemplates={dailyReportTemplates} setDailyReportTemplates={setDailyReportTemplates}
            products={products} setProducts={setProducts}
            activityTypes={activityTypes} setActivityTypes={setActivityTypes}
            associationTypes={associationTypes} setAssociationTypes={setAssociationTypes}
            rolePermissions={rolePermissions} setRolePermissions={setRolePermissions} isOwner={isOwner}
            knowledgeTags={knowledgeTags || []} setKnowledgeTags={setKnowledgeTags}
            departments={departments || []} setDepartments={setDepartments}
            token={token} currentUser={user}
            showAlert={showAlert} showConfirm={showConfirm}
          />
        )}
      </main>

      {accountOpen && (
        <AccountModal user={user} token={token} onLogout={logout} onClose={() => setAccountOpen(false)} showAlert={showAlert} onPhotoUpdated={(photo) => updateUser({ photo })} />
      )}

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

// ---------- アカウント設定（パスワード変更・ログアウト） ----------
function AccountModal({ user, token, onLogout, onClose, showAlert, onPhotoUpdated }) {
  const [password, setPassword] = useState('');
  const [photo, setPhoto] = useState(user.photo || '');

  const changePassword = async () => {
    if (password.length < 4) { showAlert('パスワードは4文字以上にしてください。'); return; }
    try {
      const res = await fetch('/api/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '変更に失敗しました');
      setPassword('');
      showAlert('パスワードを変更しました。');
    } catch (err) {
      showAlert(err.message);
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showAlert('画像サイズが大きすぎます（2MB以下にしてください）。'); return; }
    const dataUrl = await readFileAsDataUrl(file);
    setPhoto(dataUrl);
    try {
      const res = await fetch('/api/me/photo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ photo: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '写真の更新に失敗しました');
      onPhotoUpdated && onPhotoUpdated(dataUrl);
      showAlert('写真を更新しました。');
    } catch (err) {
      showAlert(err.message);
    }
  };

  return (
    <Modal title="アカウント設定" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar photo={photo} name={user.displayName} size="w-14 h-14" />
          <div>
            <p className="text-sm font-bold text-slate-700">{user.displayName}</p>
            <p className="text-xs text-slate-400">{ROLE_LABELS[user.role] || '一般'}{user.department ? ` ・ ${user.department}` : ''}</p>
            <label className="inline-block mt-1 text-xs text-teal-600 font-semibold cursor-pointer">
              写真を変更
              <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
            </label>
          </div>
        </div>
        <FormField label="新しいパスワード" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button onClick={changePassword} className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">パスワードを変更する</button>
        <button onClick={onLogout} className="w-full py-2.5 border border-red-200 text-red-600 rounded-lg font-bold hover:bg-red-50">ログアウト</button>
      </div>
    </Modal>
  );
}

function LayoutMenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

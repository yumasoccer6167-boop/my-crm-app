import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Home, Users, PenTool, Plus, Search, Edit, ChevronDown, ChevronLeft, ChevronRight,
  X, Target, Phone, Briefcase, Award, MapPin, Upload, Download, Package, Trash2, Save,
  Clock, TrendingUp, Monitor, Coins, Mail, Copy, Sparkles, Bot, Settings,
  FileText, Send, Menu, CheckCircle, LayoutGrid, List, Filter, BarChart, Link as LinkIcon, Star, Share2, Globe
} from 'lucide-react';

// --- 初期データ ---
const initialProducts = [{ id: 1, name: "SP-MEO" }, { id: 2, name: "SP" }];

const initialActivityTypes = [
  { id: 1, name: "テレアポ", flags: ["時間設定", "再コール", "拒否", "廃業", "接触済み拒否", "当日確認案件", "長期見込み"] },
  { id: 2, name: "初回訪問", flags: ["営業時間設定", "資料メール送り"] },
  { id: 3, name: "営業", flags: ["受注", "返事待ち", "返事待ちNG", "NG"] },
  { id: 4, name: "過去ログ登録", flags: ["ユーザー", "過去営業履歴あり", "他者見込み", "営業提案NG"] }
];

const initialMonthlyGoals = { [new Date().toISOString().substring(0, 7)]: { timeSetting: 50, firstVisit: 20, sales: 10, order: 5, quantity: 10, profit: 500000 } };
const initialEmailTemplates = [{ id: 1, name: "初回訪問後の御礼", subject: "【御礼】お打ち合わせについて（{{学園名}} {{園名}} 様）", body: "{{学園名}}\n{{園名}}\n{{理事長}} 様\n\nいつも大変お世話になっております。\n\n本日はお忙しい中、お時間をいただき誠にありがとうございました。\n次回のご提案を準備してまいります。\n\n引き続き何卒よろしくお願い申し上げます。" }];

const initialReportTemplates = [
  { id: 1, name: "基本報告フォーマット", body: "《法人》{{学園名}}\n《園名》{{園名}}\n《代表》{{理事長}}\n《担当》\n《住所》{{住所}}\n《URL》{{HPリンク}}\n《連絡先》{{TEL}}\n\n【5W1H】\n{{メモ}}\n\n【結果】\n{{結果}}" },
  { id: 2, name: "アポ獲得（初回訪問用）", body: "【アポ獲得】{{園名}}\n《日時》{{予定日時}}\n《対応者》\n《連絡先》{{TEL}}\n\n【詳細メモ】\n{{メモ}}" }
];

const getCurrentDateTime = () => {
  const now = new Date();
  return {
    date: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'),
    time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  };
};

const getRoundedTime = () => {
  const now = new Date();
  let m = now.getMinutes();
  let h = now.getHours();
  if (m < 15) m = 0;
  else if (m < 45) m = 30;
  else { m = 0; h = (h + 1) % 24; }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const timeOptions = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

const isWaitingDateNeeded = (type, flag) => {
  return (type === '営業' && ['返事待ち', '返事待ちNG'].includes(flag)) || 
         (type === '初回訪問' && flag === '営業時間設定') ||
         (type === 'テレアポ' && flag === '時間設定');
};

function GunmaBackground() {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center opacity-5 overflow-hidden select-none">
      <img src="https://upload.wikimedia.org/wikipedia/commons/c/ca/Map_of_Gunma_Prefecture_ja.svg" alt="群馬県の形" className="w-[150%] md:w-[90%] lg:w-[70%] object-contain grayscale" />
    </div>
  );
}

export default function App() {
  const [dataLoaded, setDataLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // ステート群
  const [customers, setCustomers] = useState([]);
  const [records, setRecords] = useState([]);
  const [products, setProducts] = useState(initialProducts);
  const [activityTypes, setActivityTypes] = useState(initialActivityTypes);
  const [emailTemplates, setEmailTemplates] = useState(initialEmailTemplates);
  const [reportTemplates, setReportTemplates] = useState(initialReportTemplates);
  const [monthlyGoals, setMonthlyGoals] = useState(initialMonthlyGoals);

  // カスタムダイアログ用
  const [alertDialog, setAlertDialog] = useState({ isOpen: false, message: '' });
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, message: '', onConfirm: null });

  const showAlert = (message) => setAlertDialog({ isOpen: true, message: String(message) });
  const showConfirm = (message, onConfirm) => setConfirmDialog({ isOpen: true, message: String(message), onConfirm });

  // Pythonサーバーからデータを読み込む
  useEffect(() => {
    fetch('/api/sync')
      .then(res => res.json())
      .then(data => {
        if (data.customers) setCustomers(data.customers);
        if (data.records) setRecords(data.records);
        setDataLoaded(true);
      })
      .catch(err => {
        console.error("サーバーからのデータ取得エラー:", err);
        setDataLoaded(true);
      });
  }, []);

  // Pythonサーバーへデータを保存する
  useEffect(() => {
    if (!dataLoaded) return;
    fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customers, records })
    }).catch(e => console.log('スプレッドシートへの保存エラー:', e));
  }, [customers, records, dataLoaded]);

  const handleSaveCustomer = (customerData) => {
    if (customerData.id) {
      setCustomers(customers.map(c => c.id === customerData.id ? customerData : c));
      showAlert("顧客情報を更新しました。");
    } else {
      setCustomers([...customers, { ...customerData, id: Date.now() }]);
      showAlert("新規顧客を登録しました。");
    }
  };

  const handleDeleteCustomer = (id) => {
    showConfirm("本当にこの顧客を削除しますか？\n関連する活動履歴も一緒に削除されます。", () => {
      setCustomers(customers.filter(c => c.id !== id));
      setRecords(records.filter(r => r.customerId !== id));
      showAlert("顧客を削除しました。");
    });
  };

  const handleAddRecord = (recordData, redirectToHome = true) => {
    setRecords([...records, { ...recordData, id: Date.now() }]);
    showAlert('記録を保存しました。');
    if (redirectToHome) setActiveTab('home'); 
  };

  const handleNavClick = (tabId) => {
    setActiveTab(tabId);
    setIsMobileMenuOpen(false);
  };

  const menuItems = [
    { id: 'home', icon: <Home className="w-5 h-5"/>, label: "HOME" },
    { id: 'teleappt_stats', icon: <BarChart className="w-5 h-5"/>, label: "テレアポ集計" },
    { id: 'customers', icon: <Users className="w-5 h-5"/>, label: "顧客リスト" },
    { id: 'record', icon: <PenTool className="w-5 h-5"/>, label: "記録登録" },
    { id: 'email', icon: <Mail className="w-5 h-5"/>, label: "メール制作" },
    { id: 'settings', icon: <Settings className="w-5 h-5"/>, label: "設定・管理" },
    { id: 'products', icon: <Package className="w-5 h-5"/>, label: "商品管理" },
    { id: 'ai', icon: <Sparkles className="w-5 h-5"/>, label: "AIアシスタント" }
  ];

  if (!dataLoaded) return (
    <div className="flex h-[100dvh] items-center justify-center bg-gray-50 flex-col">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
      <p className="text-gray-500 font-bold">データを読み込み中...</p>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-gray-50 text-gray-800 font-sans flex-col md:flex-row overflow-hidden relative">
      <GunmaBackground />

      <header className="md:hidden flex justify-between items-center p-4 bg-slate-800 text-white shadow-md z-20 shrink-0 relative">
        <div className="flex items-center">
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 mr-2 hover:bg-slate-700 rounded-md"><Menu className="w-6 h-6" /></button>
          <h1 className="font-bold text-lg tracking-wider">協会CRM</h1>
        </div>
      </header>

      {/* モバイルメニュー */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black opacity-50" onClick={() => setIsMobileMenuOpen(false)}></div>
          <div className="w-64 bg-slate-800 text-white flex flex-col relative z-10 shadow-2xl h-full">
            <div className="p-4 flex justify-between items-center border-b border-slate-700">
              <span className="font-bold tracking-wider">MENU</span>
              <button onClick={() => setIsMobileMenuOpen(false)} className="p-1"><X className="w-6 h-6"/></button>
            </div>
            <nav className="flex-1 py-2 overflow-y-auto">
              {menuItems.map(item => (
                <NavItem key={item.id} icon={item.icon} label={item.label} isActive={activeTab === item.id} onClick={() => handleNavClick(item.id)} />
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* サイドメニュー（PC用） */}
      <div className="hidden md:flex w-64 bg-slate-800 text-white flex-col shrink-0 relative z-20 shadow-xl">
        <div className="p-6 text-xl font-bold tracking-wider border-b border-slate-700">
          協会アプローチ用<br/>CRMシステム
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {menuItems.map(item => (
            <NavItem key={item.id} icon={item.icon} label={item.label} isActive={activeTab === item.id} onClick={() => handleNavClick(item.id)} />
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative z-10">
        <header className="hidden md:flex bg-white/90 backdrop-blur-sm shadow-sm p-4 justify-between items-center shrink-0 z-10">
          <h1 className="text-xl font-bold text-gray-700">{menuItems.find(m => m.id === activeTab)?.label}</h1>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200"><Users className="w-3 h-3 mr-1"/> スプレッドシート連携中</span>
            {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 w-full max-w-7xl mx-auto">
          {/* ここで各画面を切り替えています */}
          {activeTab === 'home' && <HomeView records={records} customers={customers} />}
          {activeTab === 'teleappt_stats' && <TeleApptStatsView records={records} />}
          {activeTab === 'customers' && <CustomersView customers={customers} onSaveCustomer={handleSaveCustomer} onDeleteCustomer={handleDeleteCustomer} />}
          {activeTab === 'record' && <RecordView customers={customers} onSave={(data) => handleAddRecord(data, true)} />}
          {activeTab === 'email' && <EmailBuilderView templates={emailTemplates} />}
          {activeTab === 'settings' && <SettingsView />}
          {activeTab === 'products' && <ProductsAndFlagsView products={products} />}
          {activeTab === 'ai' && <AIAssistantView />}
        </main>
      </div>

      {/* ダイアログコンポーネント群 */}
      {alertDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-gray-800 font-medium mb-6 whitespace-pre-wrap">{alertDialog.message}</p>
            <button onClick={() => setAlertDialog({ isOpen: false, message: '' })} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold">OK</button>
          </div>
        </div>
      )}

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <p className="text-gray-800 font-medium mb-6 whitespace-pre-wrap leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setConfirmDialog({ isOpen: false, message: '', onConfirm: null })} className="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50">キャンセル</button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog({ isOpen: false, message: '', onConfirm: null }); }} className="px-5 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">実行する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center px-6 py-3 text-left transition-colors ${
        isActive ? 'bg-slate-700 border-l-4 border-blue-400 text-blue-100' : 'hover:bg-slate-700 text-slate-300 border-l-4 border-transparent'
      }`}
    >
      <span className="mr-3">{icon}</span>
      <span className="font-medium text-sm md:text-base">{label}</span>
    </button>
  );
}

// ==============================================================================
// 🔽🔽🔽 ここから下が各ページの画面データです 🔽🔽🔽
// ==============================================================================

// ----------------------------------------------------
// 【1】HOME画面
// ----------------------------------------------------
function HomeView({ records, customers }) {
  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg"><Users className="w-8 h-8" /></div>
          <div>
            <p className="text-sm text-gray-500 font-bold">総顧客数</p>
            <p className="text-2xl font-black">{customers.length}<span className="text-sm font-normal text-gray-500 ml-1">件</span></p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
          <div className="p-3 bg-green-100 text-green-600 rounded-lg"><PenTool className="w-8 h-8" /></div>
          <div>
            <p className="text-sm text-gray-500 font-bold">総活動記録</p>
            <p className="text-2xl font-black">{records.length}<span className="text-sm font-normal text-gray-500 ml-1">件</span></p>
          </div>
        </div>
      </div>
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-700 mb-4 flex items-center"><Clock className="w-5 h-5 mr-2 text-blue-500"/>最近の活動記録</h2>
        {records.length === 0 ? (
          <p className="text-gray-500 text-sm">記録はまだありません。</p>
        ) : (
          <ul className="space-y-3">
            {records.slice(-5).reverse().map(r => (
              <li key={r.id} className="p-4 bg-gray-50 rounded-lg border border-gray-100 text-sm">
                <div className="flex justify-between font-bold text-gray-700 mb-1">
                  <span>{r.activityType} - {r.flag}</span>
                  <span className="text-gray-500">{r.date}</span>
                </div>
                <p className="text-gray-600 line-clamp-2">{r.memo || 'メモなし'}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 【2】テレアポ集計画面
// ----------------------------------------------------
function TeleApptStatsView({ records }) {
  const teleapptRecords = records.filter(r => r.activityType === 'テレアポ');
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-in fade-in">
      <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center"><BarChart className="w-6 h-6 mr-2 text-blue-500"/>テレアポ集計データ</h2>
      <p className="text-gray-600 mb-6">テレアポの架電数やアポ獲得率の分析画面です。</p>
      <div className="p-6 bg-blue-50 rounded-lg border border-blue-100 text-center max-w-sm mx-auto">
        <p className="text-blue-800 font-bold mb-2">総架電件数</p>
        <p className="text-4xl font-black text-blue-600">{teleapptRecords.length} <span className="text-lg">件</span></p>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 【3】顧客リスト画面
// ----------------------------------------------------
function CustomersView({ customers, onSaveCustomer, onDeleteCustomer }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-in fade-in">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-700 flex items-center"><Users className="w-6 h-6 mr-2 text-blue-500"/>顧客リスト</h2>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center text-sm shadow hover:bg-blue-700"><Plus className="w-4 h-4 mr-1"/>新規登録</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700 border-b-2 border-gray-200">
              <th className="p-3 font-bold">法人名・園名</th>
              <th className="p-3 font-bold">担当者</th>
              <th className="p-3 font-bold">電話番号</th>
              <th className="p-3 font-bold text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr><td colSpan="4" className="p-4 text-center text-gray-500">顧客データがありません</td></tr>
            ) : customers.map(c => (
              <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="p-3">{c.schoolName} {c.kindergartenName}</td>
                <td className="p-3">{c.directorName}</td>
                <td className="p-3">{c.phone}</td>
                <td className="p-3 text-center">
                  <button onClick={() => onDeleteCustomer(c.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors"><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 【4】記録登録画面
// ----------------------------------------------------
function RecordView({ customers, onSave }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 max-w-2xl mx-auto animate-in fade-in">
      <h2 className="text-xl font-bold text-gray-700 mb-6 flex items-center"><PenTool className="w-6 h-6 mr-2 text-blue-500"/>新規記録の登録</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">対象の顧客</label>
          <select className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white">
            <option>顧客を選択してください...</option>
            {customers.map(c => <option key={c.id}>{c.schoolName} {c.kindergartenName}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">活動内容</label>
          <textarea rows="4" className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white" placeholder="活動のメモや結果を入力..."></textarea>
        </div>
        <button className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow">記録を保存する</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 【5】メール制作画面
// ----------------------------------------------------
function EmailBuilderView({ templates }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-in fade-in">
      <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center"><Mail className="w-6 h-6 mr-2 text-blue-500"/>メール制作アシスト</h2>
      <p className="text-gray-600">テンプレートを選択して、素早くメールを作成できます。</p>
    </div>
  );
}

// ----------------------------------------------------
// 【6】設定・管理画面
// ----------------------------------------------------
function SettingsView() {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-in fade-in">
      <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center"><Settings className="w-6 h-6 mr-2 text-blue-500"/>設定・管理</h2>
      <p className="text-gray-600">システムの設定やテンプレートの管理を行います。</p>
    </div>
  );
}

// ----------------------------------------------------
// 【7】商品・フラグ管理画面
// ----------------------------------------------------
function ProductsAndFlagsView({ products }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-in fade-in">
      <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center"><Package className="w-6 h-6 mr-2 text-blue-500"/>商品・フラグ管理</h2>
      <p className="text-gray-600">取り扱い商品や、活動のフラグ（ステータス）を編集できます。</p>
    </div>
  );
}

// ----------------------------------------------------
// 【8】AIアシスタント画面
// ----------------------------------------------------
function AIAssistantView() {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-in fade-in">
      <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center"><Sparkles className="w-6 h-6 mr-2 text-blue-500"/>AIアシスタント</h2>
      <p className="text-gray-600">過去の履歴から最適なアプローチ方法をAIが提案します。</p>
    </div>
  );
}
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Home, Users, PenTool, Plus, Search, Edit, ChevronDown, ChevronLeft, ChevronRight,
  X, Target, Phone, Briefcase, Award, MapPin, Upload, Download, Package, Trash2, Save,
  Clock, TrendingUp, Monitor, Coins, Mail, Instagram, Copy, Sparkles, Bot, Settings,
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
        // ローカル環境など、サーバーがない場合は空でスタート
        setDataLoaded(true);
      });
  }, []);

  // Pythonサーバーへデータを保存する（スプレッドシートへ同期）
  useEffect(() => {
    if (!dataLoaded) return;
    
    // データが更新されるたびにPythonサーバーへ送る
    fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customers, records })
    }).catch(e => console.log('スプレッドシートへの保存エラー:', e));
  }, [customers, records, dataLoaded]);

  // 操作ハンドラ
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

  const handleDeleteMultipleCustomers = (ids) => {
    showConfirm(`${ids.length}件の顧客を本当に削除しますか？\n関連する活動履歴も一緒に削除されます。`, () => {
      setCustomers(customers.filter(c => !ids.includes(c.id)));
      setRecords(records.filter(r => !ids.includes(r.customerId)));
      showAlert(`${ids.length}件の顧客を削除しました。`);
    });
  };

  const handleAddRecord = (recordData, redirectToHome = true) => {
    setRecords([...records, { ...recordData, id: Date.now() }]);
    showAlert('記録を保存しました。');
    if (redirectToHome) setActiveTab('home'); 
  };

  const handleUpdateRecord = (updatedRecord) => {
    setRecords(records.map(r => r.id === updatedRecord.id ? updatedRecord : r));
    showAlert('記録を更新しました。');
  };

  const handleDeleteRecord = (id) => {
    showConfirm("この記録を削除しますか？", () => {
      setRecords(records.filter(r => r.id !== id));
      showAlert('記録を削除しました。');
    });
  };

  const handleImportCustomers = (newCustomers, newRecords = []) => {
    setCustomers(prev => {
      const existingIds = new Set(prev.map(c => c.id));
      const merged = [...prev];
      newCustomers.forEach(nc => {
        if(!existingIds.has(nc.id)) {
          merged.push(nc);
          existingIds.add(nc.id);
        }
      });
      return merged;
    });
    if (newRecords.length > 0) setRecords(prev => [...prev, ...newRecords]);
    showAlert(`${newCustomers.length}件の顧客データと ${newRecords.length}件の活動履歴をインポートしました。`);
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
    { id: 'products', icon: <Package className="w-5 h-5"/>, label: "商品・フラグ管理" },
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
          <h1 className="font-bold text-lg tracking-wider">協会アプローチ用CRM</h1>
        </div>
      </header>

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

      <div className="hidden md:flex w-64 bg-slate-800 text-white flex-col shrink-0 relative z-20 shadow-xl">
        <div className="p-6 text-xl font-bold tracking-wider border-b border-slate-700">
          協会アプローチ用<br/>CRMシステム
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {menuItems.map(item => (
            <NavItem key={item.id} icon={item.icon} label={item.label} isActive={activeTab === item.id} onClick={() => handleNavClick(item.id)} />
          ))}
        </nav>
        <div className="p-4 text-xs text-slate-400">© 2026 協会アプローチ用CRMシステム</div>
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
          {activeTab === 'home' && <HomeView records={records} monthlyGoals={monthlyGoals} onUpdateGoals={(m, g) => setMonthlyGoals({...monthlyGoals, [m]: g})} showAlert={showAlert} />}
          {activeTab === 'teleappt_stats' && <TeleApptStatsView records={records} activityTypes={activityTypes} showAlert={showAlert} />}
          {activeTab === 'customers' && <CustomersView customers={customers} records={records} products={products} onSaveCustomer={handleSaveCustomer} onDeleteCustomer={handleDeleteCustomer} onDeleteMultipleCustomers={handleDeleteMultipleCustomers} onImport={handleImportCustomers} onUpdateRecord={handleUpdateRecord} onDeleteRecord={handleDeleteRecord} onAddRecord={(data) => handleAddRecord(data, false)} showAlert={showAlert} showConfirm={showConfirm} activityTypes={activityTypes} reportTemplates={reportTemplates} />}
          {activeTab === 'record' && <RecordView customers={customers} products={products} reportTemplates={reportTemplates} activityTypes={activityTypes} onSave={(data) => handleAddRecord(data, true)} showAlert={showAlert} />}
          {activeTab === 'email' && <EmailBuilderView customers={customers} records={records} templates={emailTemplates} setTemplates={setEmailTemplates} showConfirm={showConfirm} showAlert={showAlert}/>}
          {activeTab === 'settings' && <SettingsView templates={reportTemplates} setTemplates={setReportTemplates} showConfirm={showConfirm} showAlert={showAlert}/>}
          {activeTab === 'products' && <ProductsAndFlagsView products={products} setProducts={setProducts} activityTypes={activityTypes} setActivityTypes={setActivityTypes} showAlert={showAlert}/>}
          {activeTab === 'ai' && <AIAssistantView customers={customers} records={records} />}
        </main>
      </div>

      {alertDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[100] p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-gray-800 font-medium mb-6 whitespace-pre-wrap">{alertDialog.message}</p>
            <button onClick={() => setAlertDialog({ isOpen: false, message: '' })} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors">OK</button>
          </div>
        </div>
      )}

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[100] p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <p className="text-gray-800 font-medium mb-6 whitespace-pre-wrap leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setConfirmDialog({ isOpen: false, message: '', onConfirm: null })} className="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors">キャンセル</button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog({ isOpen: false, message: '', onConfirm: null }); }} className="px-5 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors">実行する</button>
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

// -----------------------------------------------------------------------------
// ※以下、各画面のコンポーネント（HomeViewなど）は長いため簡易表示としています。
// 実際のファイルでは以前のコードの中身がそのまま入ります。
// （Python通信部分は上記の useEffect に集約されているため、下部のコンポーネントは
// 　見た目用のまま変更不要です。エラーを防ぐためダミーを置いています）
// -----------------------------------------------------------------------------

function HomeView() { return <div className="p-6 bg-white rounded-xl shadow-sm">Home (Pythonサーバー連携版)</div>; }
function TeleApptStatsView() { return <div className="p-6 bg-white rounded-xl shadow-sm">テレアポ集計</div>; }
function CustomersView() { return <div className="p-6 bg-white rounded-xl shadow-sm">顧客リスト</div>; }
function RecordView() { return <div className="p-6 bg-white rounded-xl shadow-sm">記録登録</div>; }
function EmailBuilderView() { return <div className="p-6 bg-white rounded-xl shadow-sm">メール制作</div>; }
function SettingsView() { return <div className="p-6 bg-white rounded-xl shadow-sm">設定・管理</div>; }
function ProductsAndFlagsView() { return <div className="p-6 bg-white rounded-xl shadow-sm">商品管理</div>; }
function AIAssistantView() { return <div className="p-6 bg-white rounded-xl shadow-sm">AIアシスタント</div>; }

function FormGroup({ label, value, onChange, type = "text", required = false, className = "", min, max, step }) {
  return (
    <div className={`flex flex-col space-y-1 ${className}`}>
      <label className="text-xs font-bold text-gray-700">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
      <input type={type} value={value} onChange={onChange} required={required} min={min} max={max} step={step} className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors" />
    </div>
  );
}
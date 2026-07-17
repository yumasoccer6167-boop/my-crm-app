import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Home, Users, PenTool, Plus, Search, Edit, ChevronDown, ChevronLeft, ChevronRight,
  X, Target, Phone, Briefcase, Award, MapPin, Upload, Download, Package, Trash2, Save,
  Clock, TrendingUp, Monitor, Coins, Mail, Instagram, Copy, Sparkles, Bot, Settings,
  FileText, Send, Menu, CheckCircle, LayoutGrid, List, Filter, BarChart, Link as LinkIcon, Star, Share2, Globe
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Firebase Cloud Storage Setup ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- 初期データ ---
const initialProducts = [{ id: 1, name: "SP-MEO" }, { id: 2, name: "SP" }];

const initialActivityTypes = [
  { id: 1, name: "テレアポ", flags: ["時間設定", "再コール", "拒否", "廃業", "接触済み拒否", "当日確認案件", "長期見込み"] },
  { id: 2, name: "初回訪問", flags: ["営業時間設定", "資料メール送り"] },
  { id: 3, name: "営業", flags: ["受注", "返事待ち", "返事待ちNG", "NG"] },
  { id: 4, name: "過去ログ登録", flags: ["ユーザー", "過去営業履歴あり", "他者見込み", "営業提案NG"] }
];

const initialCustomers = [
  { id: 1, schoolName: "学校法人清心学園", kindergartenName: "清心幼稚園", chairman: "黒田とめ子", principal: "栗原千代子", address: "群馬県前橋市大手町3-1-21", tel: "027-231-2415", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 2, schoolName: "学校法人森本学園", kindergartenName: "わかくさ幼稚園", chairman: "小林一博", principal: "小林　一博", address: "群馬県前橋市嶺町1365-5", tel: "027-264-0600", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 3, schoolName: "学校法人昌賢学園", kindergartenName: "群馬医療福祉大学附属認定こども園鈴蘭幼稚園", chairman: "鈴木 利定", principal: "田中 輝幸", address: "群馬県前橋市元総社町152", tel: "027-251-2180", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 4, schoolName: "学校法人共愛学園", kindergartenName: "共愛学園こども園", chairman: "跡部洋一", principal: "天川　正", address: "群馬県前橋市小屋原町1121-2", tel: "027-266-1010", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 5, schoolName: "学校法人冷泉学園", kindergartenName: "明星幼稚園", chairman: "熊田　俊道", principal: "熊田　俊道", address: "群馬県前橋市南町1-21-28", tel: "027-223-0804", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 6, schoolName: "学校法人小林学園", kindergartenName: "静和幼稚園", chairman: "小林薫", principal: "小林　勝", address: "群馬県前橋市文京町1-29-18", tel: "027-221-7452", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 7, schoolName: "高崎健康福祉大学", kindergartenName: "高崎健康福祉大学附属幼稚園", chairman: "須藤賢一", principal: "岡田秀昭", address: "群馬県高崎市中大類町506-1", tel: "027-352-3461", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 8, schoolName: "学校法人柘植学園", kindergartenName: "中居幼稚園", chairman: "柘植（ほうじん）　美幸", principal: "神戸　秀明", address: "群馬県高崎市中居町3-33", tel: "027-352-1721", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 9, schoolName: "学校法人桃ヶ丘学園", kindergartenName: "八幡幼稚園", chairman: "中曽根　啓二", principal: "中曽根　啓之", address: "群馬県高崎市剣崎町409-4", tel: "027-343-3908", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 10, schoolName: "学校法人北村学園", kindergartenName: "こだま幼稚園", chairman: "北村　久美子", principal: "北村　久美子", address: "群馬県高崎市下豊岡町242-2", tel: "027-326-3055", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 11, schoolName: "学校法人松山学園", kindergartenName: "いちごばたけ幼稚園", chairman: "山口一期", principal: "山口一期", address: "群馬県高崎市箕郷町西明屋67-2", tel: "027-371-5900", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" },
  { id: 12, schoolName: "学校法人狩野学園", kindergartenName: "ひばり幼稚園", chairman: "狩野（かのう）　史子", principal: "狩野　史子", address: "群馬県高崎市中里町334-1", tel: "027-373-6579", email: "", hpLink: "", instagramUrl: "", association: "群私幼", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" }
];

const initialRecords = [
  { id: 1, customerId: 1, type: "テレアポ", teleApptResult: "時間設定", date: "2026-07-01", time: "10:00", memo: "園長先生と通話。10日に訪問のお時間をいただいた。" },
  { id: 2, customerId: 2, type: "テレアポ", teleApptResult: "再コール", date: "2026-07-02", time: "14:30", memo: "不在のため、明日再コール予定。" },
  { id: 3, customerId: 3, type: "過去ログ登録", pastLogResult: "過去営業履歴あり", date: "2026-06-01", time: "15:26", memo: "女性が電話対応。今忙しくて対応が出来ない。ご挨拶は結構です、と拒否気味。" },
  { id: 4, customerId: 4, type: "テレアポ", teleApptResult: "再コール", date: "2026-06-04", time: "09:55", memo: "さとみ先生・女性が電話対応。松倉園長先生は忙しい。日にちをあけて連絡。" }
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

const sanitizeForFirestore = (data) => JSON.parse(JSON.stringify(data));

// 背景用の群馬県シルエットコンポーネント
function GunmaBackground() {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center opacity-5 overflow-hidden select-none">
      <img 
        src="https://upload.wikimedia.org/wikipedia/commons/c/ca/Map_of_Gunma_Prefecture_ja.svg" 
        alt="群馬県の形" 
        className="w-[150%] md:w-[90%] lg:w-[70%] object-contain grayscale"
      />
    </div>
  );
}

export default function App() {
  const [dataLoaded, setDataLoaded] = useState(false);
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // ステート群
  const [customers, setCustomers] = useState(initialCustomers);
  const [records, setRecords] = useState(initialRecords);
  const [products, setProducts] = useState(initialProducts);
  const [activityTypes, setActivityTypes] = useState(initialActivityTypes);
  const [emailTemplates, setEmailTemplates] = useState(initialEmailTemplates);
  const [reportTemplates, setReportTemplates] = useState(initialReportTemplates);
  const [monthlyGoals, setMonthlyGoals] = useState(initialMonthlyGoals);
  const [webhookUrl, setWebhookUrl] = useState('');

  // カスタムダイアログ用
  const [alertDialog, setAlertDialog] = useState({ isOpen: false, message: '' });
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, message: '', onConfirm: null });

  const showAlert = (message) => setAlertDialog({ isOpen: true, message: String(message) });
  const showConfirm = (message, onConfirm) => setConfirmDialog({ isOpen: true, message: String(message), onConfirm });

  // 認証の初期化
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Auth error", e);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // クラウドからのデータ読み込み (Firestore)
  useEffect(() => {
    if (!user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'crmData', 'main');
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const parsed = docSnap.data();
        if(parsed.customers) setCustomers(parsed.customers);
        if(parsed.records) setRecords(parsed.records);
        if(parsed.products) setProducts(parsed.products);
        if(parsed.activityTypes) {
           const migratedTypes = parsed.activityTypes.map(t => {
              if (t.name === 'テレアポ' && !t.flags.includes('長期見込み')) {
                 return { ...t, flags: [...t.flags, '長期見込み'] };
              }
              if (t.name === '営業' && !t.flags.includes('返事待ちNG')) {
                 return { ...t, flags: [...t.flags, '返事待ちNG'] };
              }
              return t;
           });
           setActivityTypes(migratedTypes);
        }
        if(parsed.emailTemplates) setEmailTemplates(parsed.emailTemplates);
        if(parsed.reportTemplates) {
          if (parsed.reportTemplates.length === 1 && parsed.reportTemplates[0].name === "基本報告フォーマット") {
            setReportTemplates(initialReportTemplates); // 新規テンプレをマージ
          } else {
            setReportTemplates(parsed.reportTemplates);
          }
        }
        if(parsed.monthlyGoals) setMonthlyGoals(parsed.monthlyGoals);
        if(parsed.webhookUrl) setWebhookUrl(parsed.webhookUrl);
      } else {
        // 初回ロード時、クラウドにデータがなければ初期データを保存
        setDoc(docRef, sanitizeForFirestore({
           customers: initialCustomers,
           records: initialRecords,
           products: initialProducts,
           activityTypes: initialActivityTypes,
           emailTemplates: initialEmailTemplates,
           reportTemplates: initialReportTemplates,
           monthlyGoals: initialMonthlyGoals,
           webhookUrl: ''
        })).catch(console.error);
      }
      setDataLoaded(true);
    }, (error) => {
      console.error("Firestore error:", error);
      setDataLoaded(true); // エラー時もとりあえず画面表示を優先
    });

    return () => unsubscribe();
  }, [user]);

  // クラウドへのデータ自動保存 (Firestore)
  useEffect(() => {
    if (!dataLoaded || !user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'crmData', 'main');
    const saveData = sanitizeForFirestore({
      customers, records, products, activityTypes, emailTemplates, reportTemplates, monthlyGoals, webhookUrl
    });
    setDoc(docRef, saveData).catch(console.error);

    // スプレッドシート自動同期（Webhook）
    if (webhookUrl && webhookUrl.startsWith('https://script.google.com/')) {
      fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors', // CORS制約回避
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ customers, records })
      }).catch(e => console.log('Sync error:', e));
    }
  }, [customers, records, products, activityTypes, emailTemplates, reportTemplates, monthlyGoals, webhookUrl, dataLoaded, user]);

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
    
    if (newRecords.length > 0) {
      setRecords(prev => [...prev, ...newRecords]);
    }
    
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
      <p className="text-gray-500 font-bold">クラウドデータを同期中...</p>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-gray-50 text-gray-800 font-sans flex-col md:flex-row overflow-hidden relative">
      <GunmaBackground />

      <header className="md:hidden flex justify-between items-center p-4 bg-slate-800 text-white shadow-md z-20 shrink-0 relative">
        <div className="flex items-center">
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 mr-2 hover:bg-slate-700 rounded-md">
            <Menu className="w-6 h-6" />
          </button>
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
          <h1 className="text-xl font-bold text-gray-700">
            {menuItems.find(m => m.id === activeTab)?.label}
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200"><Users className="w-3 h-3 mr-1"/> 共有クラウド同期中</span>
            {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 w-full max-w-7xl mx-auto">
          {activeTab === 'home' && <HomeView records={records} monthlyGoals={monthlyGoals} onUpdateGoals={(m, g) => setMonthlyGoals({...monthlyGoals, [m]: g})} showAlert={showAlert} />}
          {activeTab === 'teleappt_stats' && <TeleApptStatsView records={records} activityTypes={activityTypes} showAlert={showAlert} />}
          {activeTab === 'customers' && <CustomersView customers={customers} records={records} products={products} onSaveCustomer={handleSaveCustomer} onDeleteCustomer={handleDeleteCustomer} onDeleteMultipleCustomers={handleDeleteMultipleCustomers} onImport={handleImportCustomers} onUpdateRecord={handleUpdateRecord} onDeleteRecord={handleDeleteRecord} onAddRecord={(data) => handleAddRecord(data, false)} showAlert={showAlert} showConfirm={showConfirm} activityTypes={activityTypes} reportTemplates={reportTemplates} />}
          {activeTab === 'record' && <RecordView customers={customers} products={products} reportTemplates={reportTemplates} activityTypes={activityTypes} onSave={(data) => handleAddRecord(data, true)} showAlert={showAlert} />}
          {activeTab === 'email' && <EmailBuilderView customers={customers} records={records} templates={emailTemplates} setTemplates={setEmailTemplates} showConfirm={showConfirm} showAlert={showAlert}/>}
          {activeTab === 'settings' && <SettingsView templates={reportTemplates} setTemplates={setReportTemplates} webhookUrl={webhookUrl} setWebhookUrl={setWebhookUrl} showConfirm={showConfirm} showAlert={showAlert}/>}
          {activeTab === 'products' && <ProductsAndFlagsView products={products} setProducts={setProducts} activityTypes={activityTypes} setActivityTypes={setActivityTypes} showAlert={showAlert}/>}
          {activeTab === 'ai' && <AIAssistantView customers={customers} records={records} />}
        </main>
      </div>

      {alertDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[100] p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-gray-800 font-medium mb-6 whitespace-pre-wrap">{alertDialog.message}</p>
            <button onClick={() => setAlertDialog({ isOpen: false, message: '' })} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors">
              OK
            </button>
          </div>
        </div>
      )}

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[100] p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <p className="text-gray-800 font-medium mb-6 whitespace-pre-wrap leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setConfirmDialog({ isOpen: false, message: '', onConfirm: null })} className="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors">
                キャンセル
              </button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog({ isOpen: false, message: '', onConfirm: null }); }} className="px-5 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors">
                実行する
              </button>
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

// --- Home View ---
function HomeView({ records, monthlyGoals, onUpdateGoals, showAlert }) {
  const todayStr = new Date().toISOString().substring(0, 7);
  
  const availableMonths = useMemo(() => {
    const months = new Set();
    months.add(todayStr); 
    const baseMonths = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
    baseMonths.forEach(m => months.add(m));
    records.forEach(r => {
      if (r.date && r.date.length >= 7) {
        const m = r.date.substring(0, 7);
        if (m >= '2026-05') months.add(m);
      }
    });
    return Array.from(months).sort(); 
  }, [records, todayStr]);

  const [period, setPeriod] = useState(() => todayStr >= '2026-05' ? todayStr : 'all'); 
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);

  const filteredRecords = useMemo(() => {
    if (period === 'all') return records;
    return records.filter(r => {
      if (!r.date) return false;
      if (period === 'past') return r.date < '2026-05-01';
      return r.date.startsWith(period);
    });
  }, [records, period]);

  const actuals = useMemo(() => {
    const timeSetting = filteredRecords.filter(r => r.type === "テレアポ" && r.teleApptResult === "時間設定").length;
    const firstVisit = filteredRecords.filter(r => r.type === "初回訪問").length;
    const sales = filteredRecords.filter(r => r.type === "営業").length;
    
    const order = filteredRecords.filter(r => r.type === "営業" && r.salesResult === "受注").length;
    
    const quantity = filteredRecords.filter(r => (r.type === "営業" && r.salesResult === "受注") || (r.type === "過去ログ登録" && r.pastLogResult === "ユーザー")).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    const profit = filteredRecords.filter(r => (r.type === "営業" && r.salesResult === "受注") || (r.type === "過去ログ登録" && r.pastLogResult === "ユーザー")).reduce((sum, r) => sum + (Number(r.profit) || 0), 0);
    
    const salesConversionRate = firstVisit > 0 ? Math.round((sales / firstVisit) * 100) : 0;
    
    return { timeSetting, firstVisit, sales, order, quantity, profit, salesConversionRate };
  }, [filteredRecords]);

  const currentGoals = monthlyGoals[period] || { timeSetting: 0, firstVisit: 0, sales: 0, order: 0, quantity: 0, profit: 0 };
  const targetConversionRate = currentGoals.firstVisit > 0 ? Math.round((currentGoals.sales / currentGoals.firstVisit) * 100) : 0;
  const isAll = period === 'all';

  const getPeriodLabel = (p) => {
    if (p === 'all') return '全期間';
    if (p === 'past') return '過去ログ';
    if (p.length === 7) return `${p.split('-')[0]}年${parseInt(p.split('-')[1], 10)}月`;
    return p;
  };

  const handleGenerateReport = () => {
    const label = period === 'all' ? '全期間' : period === 'past' ? '過去ログ' : `${parseInt(period.split('-')[1], 10)}月`;
    const calcRate = (act, tgt) => tgt > 0 ? Math.round((act / tgt) * 100) : 0;
    const formatMoney = (val) => {
      if (val >= 10000) {
        const man = val / 10000;
        return Number.isInteger(man) ? man + '万' : man.toFixed(1).replace(/\.0$/, '') + '万';
      }
      return val.toLocaleString();
    };

    const text = `${label}稼働結果\n【時間設定】予算${currentGoals.timeSetting}件、実績${actuals.timeSetting}件、${calcRate(actuals.timeSetting, currentGoals.timeSetting)}％\n【初回訪問】予算${currentGoals.firstVisit}件、実績${actuals.firstVisit}件、${calcRate(actuals.firstVisit, currentGoals.firstVisit)}％\n【商談件数】予算${currentGoals.sales}件、実績${actuals.sales}件、${calcRate(actuals.sales, currentGoals.sales)}％\n【受注件数】予算${currentGoals.order}件、実績${actuals.order}件、${calcRate(actuals.order, currentGoals.order)}％\n【粗利】予算${formatMoney(currentGoals.profit)}、実績${formatMoney(actuals.profit)}、${calcRate(actuals.profit, currentGoals.profit)}％`;

    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showAlert("レポートをクリップボードにコピーしました！\n\n" + text);
    } catch (err) {
      showAlert("コピーに失敗しました。");
    }
    document.body.removeChild(ta);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-l-4 border-blue-500 pl-3">
        <h2 className="text-lg font-bold text-gray-700">目標と実績</h2>
        <div className="flex space-x-2 items-center w-full md:w-auto">
          <select value={period} onChange={e => setPeriod(e.target.value)} className="flex-1 md:flex-none px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium bg-white">
            <option value="all">全期間</option>
            <option value="past">過去ログ</option>
            {availableMonths.map(m => <option key={m} value={m}>{getPeriodLabel(m)}</option>)}
          </select>
          <button onClick={handleGenerateReport} className="flex items-center space-x-1 bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-md text-sm hover:bg-gray-50 transition-colors shadow-sm shrink-0">
            <FileText className="w-4 h-4" /><span className="hidden sm:inline">レポート出力</span>
          </button>
          {!isAll && (
            <button onClick={() => setIsGoalModalOpen(true)} className="flex items-center space-x-1 bg-blue-600 border border-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 transition-colors shadow-sm shrink-0">
              <Edit className="w-4 h-4" /><span className="hidden sm:inline">目標設定</span>
            </button>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <GoalCard title="時間設定" icon={<Clock className="text-blue-500 w-5 h-5" />} target={currentGoals.timeSetting} actual={actuals.timeSetting} color="bg-blue-500" isAll={isAll} unit="件" />
        <GoalCard title="初回訪問" icon={<MapPin className="text-indigo-500 w-5 h-5" />} target={currentGoals.firstVisit} actual={actuals.firstVisit} color="bg-indigo-500" isAll={isAll} unit="件" />
        <GoalCard title="営業" icon={<Briefcase className="text-purple-500 w-5 h-5" />} target={currentGoals.sales} actual={actuals.sales} color="bg-purple-500" isAll={isAll} unit="件" />
        <GoalCard title="受注" icon={<Award className="text-yellow-500 w-5 h-5" />} target={currentGoals.order} actual={actuals.order} color="bg-yellow-500" isAll={isAll} unit="件" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-2">
        <GoalCard title="営業昇華率" icon={<TrendingUp className="text-emerald-500 w-5 h-5" />} target={targetConversionRate} actual={actuals.salesConversionRate} color="bg-emerald-500" isAll={isAll} unit="%" />
        <GoalCard title="獲得台数" icon={<Monitor className="text-orange-500 w-5 h-5" />} target={currentGoals.quantity} actual={actuals.quantity} color="bg-orange-500" isAll={isAll} unit="台" />
        <GoalCard title="営業粗利(P)" icon={<Coins className="text-red-500 w-5 h-5" />} target={currentGoals.profit} actual={actuals.profit} color="bg-red-500" isAll={isAll} unit="P" />
      </div>

      {isGoalModalOpen && <GoalModal monthLabel={getPeriodLabel(period)} currentGoals={currentGoals} onClose={() => setIsGoalModalOpen(false)} onSave={(newGoals) => { onUpdateGoals(period, newGoals); setIsGoalModalOpen(false); }} />}
    </div>
  );
}

function GoalCard({ title, icon, target, actual, color, isAll, unit = "" }) {
  const percentage = target > 0 ? Math.min(Math.round((actual / target) * 100), 100) : 0;
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 relative overflow-hidden">
      {isAll && <div className="absolute top-0 right-0 bg-gray-100 text-gray-500 text-[9px] px-2 py-0.5 rounded-bl-lg font-bold">ALL TIME</div>}
      <div className="flex justify-between items-center mb-3 mt-1">
        <div className="flex items-center space-x-1.5 md:space-x-2">
          {icon}
          <h3 className="font-medium text-gray-700 text-xs md:text-sm">{title}</h3>
        </div>
        <span className="text-lg md:text-xl font-bold text-gray-800">
          {actual.toLocaleString()}<span className="text-[10px] md:text-xs ml-0.5">{unit}</span>
          {!isAll && <span className="text-[10px] font-normal text-gray-500 block text-right mt-[-4px]">/ {target.toLocaleString()}{unit}</span>}
        </span>
      </div>
      {!isAll && (
        <>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1">
            <div className={`h-1.5 rounded-full ${color} transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
          </div>
          <div className="text-right text-[10px] text-gray-500 font-medium">達成率: {percentage}%</div>
        </>
      )}
    </div>
  );
}

function GoalModal({ monthLabel, currentGoals, onClose, onSave }) {
  const [formData, setFormData] = useState(currentGoals);
  const handleSubmit = (e) => { e.preventDefault(); onSave({ timeSetting: Number(formData.timeSetting), firstVisit: Number(formData.firstVisit), sales: Number(formData.sales), order: Number(formData.order), quantity: Number(formData.quantity), profit: Number(formData.profit) }); };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-[70] md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl w-full max-w-lg rounded-t-2xl overflow-hidden pb-safe">
        <div className="flex justify-between items-center p-4 border-b bg-gray-50">
          <h2 className="text-base font-bold text-gray-800">{monthLabel}の目標設定</h2>
          <button onClick={onClose} className="text-gray-500 p-1 bg-white rounded-full shadow-sm"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="時間設定 (件)" type="number" value={formData.timeSetting} onChange={e => setFormData({...formData, timeSetting: e.target.value})} required min="0" />
            <FormGroup label="初回訪問 (件)" type="number" value={formData.firstVisit} onChange={e => setFormData({...formData, firstVisit: e.target.value})} required min="0" />
            <FormGroup label="営業 (件)" type="number" value={formData.sales} onChange={e => setFormData({...formData, sales: e.target.value})} required min="0" />
            <FormGroup label="受注 (件)" type="number" value={formData.order} onChange={e => setFormData({...formData, order: e.target.value})} required min="0" />
            <FormGroup label="台数 (台)" type="number" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} required min="0" />
            <FormGroup label="営業粗利 (P)" type="number" value={formData.profit} onChange={e => setFormData({...formData, profit: e.target.value})} required min="0" />
          </div>
          <div className="pt-6 mt-4 flex justify-end space-x-3">
            <button type="button" onClick={onClose} className="px-5 py-2.5 border rounded-lg text-gray-600 font-medium w-full md:w-auto">キャンセル</button>
            <button type="submit" className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-bold w-full md:w-auto shadow-md">保存する</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- TeleAppt Stats View ---
function TeleApptStatsView({ records, activityTypes, showAlert }) {
  const [viewType, setViewType] = useState('day'); 

  const teleApptRecords = useMemo(() => records.filter(r => r.type === 'テレアポ'), [records]);
  const teleApptFlags = useMemo(() => activityTypes.find(t => t.name === 'テレアポ')?.flags || [], [activityTypes]);

  const getStartOfWeek = (dateString) => {
    if (!dateString) return '';
    const [y, m, d] = dateString.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(date.setDate(diff));
    const sy = start.getFullYear();
    const sm = String(start.getMonth() + 1).padStart(2, '0');
    const sd = String(start.getDate()).padStart(2, '0');
    return `${sy}-${sm}-${sd}`;
  };

  const aggregatedData = useMemo(() => {
    const data = {};
    
    teleApptRecords.forEach(r => {
      if (!r.date) return;
      
      let key = r.date; 
      if (viewType === 'month') {
        key = r.date.substring(0, 7);
      } else if (viewType === 'week') {
        key = getStartOfWeek(r.date);
      }

      if (!data[key]) {
        data[key] = { total: 0 };
        teleApptFlags.forEach(f => data[key][f] = 0);
        data[key]['その他'] = 0; 
      }
      
      data[key].total += 1;
      const actualFlag = r.teleApptResult || r.resultFlag || 'その他';
      
      if (teleApptFlags.includes(actualFlag)) {
        data[key][actualFlag] += 1;
      } else {
        data[key]['その他'] += 1;
      }
    });

    return Object.keys(data).sort((a, b) => b.localeCompare(a)).map(k => ({
      key: k,
      ...data[k]
    }));
  }, [teleApptRecords, viewType, teleApptFlags]);

  const formatKey = (key, type) => {
    if (type === 'month') return `${key.substring(0, 4)}年${parseInt(key.substring(5, 7))}月`;
    if (type === 'week') {
       const [y, m, d] = key.split('-');
       return `${y}年${parseInt(m)}月${parseInt(d)}日〜`;
    }
    const [y, m, d] = key.split('-');
    return `${y}年${parseInt(m)}月${parseInt(d)}日`;
  };

  const handleCopySingleRow = (row) => {
    let text = `【テレアポ集計レポート: ${formatKey(row.key, viewType)}】\n`;
    text += `総件数: ${row.total}件\n`;
    teleApptFlags.forEach(f => {
      if (row[f] > 0) {
        text += `・${f}: ${row[f]}件 (${Math.round((row[f]/row.total)*100)}%)\n`;
      }
    });
    if (row['その他'] > 0) {
      text += `・その他: ${row['その他']}件\n`;
    }
    
    const ta = document.createElement("textarea");
    ta.value = text.trim();
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showAlert(`${formatKey(row.key, viewType)} の集計レポートをコピーしました！\n\n` + text.trim());
    } catch (err) {
      showAlert("コピーに失敗しました。");
    }
    document.body.removeChild(ta);
  };

  const handleGenerateReport = () => {
    let text = `【テレアポ集計レポート: ${viewType === 'day' ? '日別' : viewType === 'week' ? '週別' : '月別'}】\n\n`;
    if (aggregatedData.length === 0) {
      text += "対象の記録がありません。";
    } else {
      aggregatedData.forEach(row => {
        text += `■ ${formatKey(row.key, viewType)}\n`;
        text += `総件数: ${row.total}件\n`;
        teleApptFlags.forEach(f => {
          if (row[f] > 0) {
            text += `・${f}: ${row[f]}件 (${Math.round((row[f]/row.total)*100)}%)\n`;
          }
        });
        if (row['その他'] > 0) {
          text += `・その他: ${row['その他']}件\n`;
        }
        text += '\n';
      });
    }
    
    const ta = document.createElement("textarea");
    ta.value = text.trim();
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showAlert("集計レポートをクリップボードにコピーしました！\n\n" + text.trim());
    } catch (err) {
      showAlert("コピーに失敗しました。");
    }
    document.body.removeChild(ta);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 mt-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-center border-b pb-2 mb-6">
          <h2 className="text-xl font-bold text-gray-800 flex items-center">
            <BarChart className="w-6 h-6 mr-2 text-blue-600" />テレアポ集計
          </h2>
          <button onClick={handleGenerateReport} className="flex items-center space-x-1 bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-md text-sm hover:bg-gray-50 transition-colors shadow-sm">
            <FileText className="w-4 h-4" /><span className="hidden sm:inline">全体レポート出力</span>
          </button>
        </div>
        
        <div className="flex bg-gray-100 p-1 rounded-lg w-fit mb-6 shadow-inner">
          <button onClick={() => setViewType('day')} className={`px-6 py-2 text-sm font-bold rounded-md transition-colors ${viewType === 'day' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>日別</button>
          <button onClick={() => setViewType('week')} className={`px-6 py-2 text-sm font-bold rounded-md transition-colors ${viewType === 'week' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>週別</button>
          <button onClick={() => setViewType('month')} className={`px-6 py-2 text-sm font-bold rounded-md transition-colors ${viewType === 'month' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>月別</button>
        </div>

        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-100 border-b border-gray-200 text-gray-700 font-bold">
              <tr>
                <th className="px-4 py-3 sticky left-0 bg-gray-100 z-10 border-r border-gray-200">期間</th>
                <th className="px-4 py-3 text-right">総件数</th>
                {teleApptFlags.map(f => <th key={f} className="px-4 py-3 text-right">{f}</th>)}
                <th className="px-4 py-3 text-right">その他</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aggregatedData.map(row => (
                <tr key={row.key} className="group hover:bg-blue-50 transition-colors">
                  <td className="px-4 py-3 font-bold text-gray-800 sticky left-0 bg-white group-hover:bg-blue-50 z-10 border-r border-gray-100">
                    <div className="flex items-center justify-between">
                      <span>{formatKey(row.key, viewType)}</span>
                      <button onClick={() => handleCopySingleRow(row)} className="p-1.5 text-gray-400 hover:text-blue-600 bg-gray-50 hover:bg-blue-100 rounded-md transition-colors ml-2 shadow-sm border border-gray-200" title="この期間のレポートをコピー">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-extrabold text-blue-600 text-base">{row.total}</td>
                  {teleApptFlags.map(f => (
                    <td key={f} className="px-4 py-3 text-right">
                      <span className="font-bold text-gray-800 text-base">{row[f]}</span>
                      {row.total > 0 && <span className="text-[10px] text-gray-500 ml-1">({Math.round((row[f]/row.total)*100)}%)</span>}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <span className="font-bold text-gray-800">{row['その他']}</span>
                  </td>
                </tr>
              ))}
              {aggregatedData.length === 0 && (
                <tr>
                  <td colSpan={teleApptFlags.length + 3} className="px-4 py-8 text-center text-gray-500">
                    対象の記録がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- Customers View ---
function CustomersView({ customers, records, products, onSaveCustomer, onDeleteCustomer, onDeleteMultipleCustomers, onImport, onUpdateRecord, onDeleteRecord, onAddRecord, showAlert, showConfirm, activityTypes, reportTemplates }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAddress, setFilterAddress] = useState('');
  const [filterActivityType, setFilterActivityType] = useState('all');
  const [filterResultFlag, setFilterResultFlag] = useState('all');
  const [viewMode, setViewMode] = useState('card'); 
  const fileInputRef = useRef(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isDetailRecordFormOpen, setIsDetailRecordFormOpen] = useState(false);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editingCustomerData, setEditingCustomerData] = useState(null);
  
  const [selectedIds, setSelectedIds] = useState(new Set());

  const customersWithStatus = useMemo(() => {
    return customers.map(c => {
      const crecords = records.filter(r => r.customerId === c.id).sort((a,b) => new Date(b.date) - new Date(a.date));
      let statusStr = '未対応';
      
      const isUser = crecords.some(r => (r.type === '営業' && r.salesResult === '受注') || (r.type === '過去ログ登録' && r.pastLogResult === 'ユーザー'));
      const isSalesDone = crecords.some(r => r.type === '営業' && ['NG', '返事待ち', '返事待ちNG'].includes(r.salesResult));
      const isVisitTimeSet = crecords.some(r => r.type === '初回訪問' && r.visitResult === '営業時間設定');
      const isVisited = crecords.some(r => r.type === '初回訪問');
      const isTeleAppt = crecords.some(r => r.type === 'テレアポ');

      if (isUser) statusStr = 'ユーザー';
      else if (isSalesDone) statusStr = '営業済み';
      else if (isVisitTimeSet) statusStr = '初回訪問(時間設定)';
      else if (isVisited) statusStr = '初回訪問';
      else if (isTeleAppt) statusStr = 'テレアポ中';

      const latestRecord = crecords[0];
      return { ...c, crecords, latestRecord, statusStr, isUser, isSalesDone, isVisitTimeSet, isVisited, isTeleAppt };
    });
  }, [customers, records]);

  const filteredCustomers = useMemo(() => {
    return customersWithStatus.filter(c => {
      const matchSearch = c.kindergartenName.includes(searchTerm) || (c.schoolName && c.schoolName.includes(searchTerm));
      const matchAddress = filterAddress === '' || (c.address && c.address.includes(filterAddress));
      
      let matchStatus = true;
      if (filterStatus === 'user') matchStatus = c.isUser;
      else if (filterStatus === 'sales') matchStatus = !c.isUser && c.isSalesDone;
      else if (filterStatus === 'visit') matchStatus = !c.isUser && !c.isSalesDone && (c.isVisited || c.isVisitTimeSet);
      else if (filterStatus === 'teleappt') matchStatus = !c.isUser && !c.isSalesDone && !c.isVisited && c.isTeleAppt;
      else if (filterStatus === 'none') matchStatus = c.statusStr === '未対応';

      let matchActivityType = true;
      if (filterActivityType !== 'all') {
        matchActivityType = c.latestRecord && c.latestRecord.type === filterActivityType;
      }
      
      let matchResultFlag = true;
      if (filterResultFlag !== 'all') {
        matchResultFlag = c.latestRecord && (() => {
           const r = c.latestRecord;
           const flag = r.resultFlag || r.teleApptResult || r.visitResult || r.salesResult || r.pastLogResult || '';
           return flag === filterResultFlag;
        })();
      }

      return matchSearch && matchAddress && matchStatus && matchActivityType && matchResultFlag;
    });
  }, [customersWithStatus, searchTerm, filterAddress, filterStatus, filterActivityType, filterResultFlag]);

  const availableResultFlags = useMemo(() => {
    if (filterActivityType === 'all') {
      const allFlags = new Set();
      activityTypes.forEach(t => t.flags.forEach(f => allFlags.add(f)));
      return Array.from(allFlags);
    } else {
      const targetType = activityTypes.find(t => t.name === filterActivityType);
      return targetType ? targetType.flags : [];
    }
  }, [filterActivityType, activityTypes]);

  const availableAddresses = useMemo(() => {
    const addrs = new Set();
    customers.forEach(c => {
      if(c.address) {
        const match = c.address.match(/(.+?[都道府県])/);
        if(match) addrs.add(match[1]);
        else addrs.add(c.address.substring(0, 3)); 
      }
    });
    return Array.from(addrs).sort();
  }, [customers]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      processCSV(event.target.result);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file); 
  };

  const processCSV = (text) => {
    const lines = text.split(/\r\n|\n/);
    if (lines.length < 2) return showAlert("CSVのデータが不足しているか、空のファイルです。");
    const parseCSVLine = (t) => {
      const res = []; let curr = '', inQ = false;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '"' && t[i+1] === '"') { curr += '"'; i++; }
        else if (t[i] === '"') inQ = !inQ;
        else if (t[i] === ',' && !inQ) { res.push(curr); curr = ''; }
        else curr += t[i];
      }
      res.push(curr); return res;
    };
    const headers = parseCSVLine(lines[0]).map(h => h.trim());
    
    // Check if CSV has record fields to import
    const hasRecordFields = headers.includes('ログ1_活動種別');

    const newCustomers = [];
    const newRecords = [];

    const formatDateStr = (d) => {
      if (!d) return '';
      const parts = d.replace(/\//g, '-').split('-');
      if (parts.length === 3) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }
      return d.replace(/\//g, '-');
    };

    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      const values = parseCSVLine(lines[i]);
      const getVal = (n) => { const idx = headers.indexOf(n); return idx !== -1 && values[idx] ? values[idx].trim() : ""; };
      
      const kindergartenName = getVal("園名");
      if (!kindergartenName) continue; 
      
      const newCustomerId = Date.now() + i;
      newCustomers.push({ 
        id: newCustomerId, 
        schoolName: getVal("学園名"), 
        kindergartenName, 
        chairman: getVal("理事長"), 
        principal: getVal("園長"), 
        address: getVal("住所"), 
        tel: getVal("TEL"), 
        email: getVal("メールアドレス"), 
        hpLink: getVal("HPリンク"), 
        instagramUrl: getVal("Instagram"), 
        association: getVal("協会関係"), 
        hpVendor: getVal("HP業者"), 
        gbpLink: getVal("GBPリンク"), 
        reviewRating: getVal("口コミ評価"), 
        reviewCount: getVal("口コミ数") 
      });

      if (hasRecordFields) {
        // Extract up to 3 logs per customer if present
        for (let j = 1; j <= 3; j++) {
          const type = getVal(`ログ${j}_活動種別`);
          if (type) {
            newRecords.push({
              id: Date.now() + i * 10 + j,
              customerId: newCustomerId,
              type: type,
              resultFlag: '',
              teleApptResult: type === 'テレアポ' ? getVal(`ログ${j}_結果フラグ`) : '',
              visitResult: type === '初回訪問' ? getVal(`ログ${j}_結果フラグ`) : '',
              salesResult: type === '営業' ? getVal(`ログ${j}_結果フラグ`) : '',
              pastLogResult: type === '過去ログ登録' ? getVal(`ログ${j}_結果フラグ`) : '',
              date: formatDateStr(getVal(`ログ${j}_日付`)),
              time: getVal(`ログ${j}_時間`),
              memo: getVal(`ログ${j}_メモ`),
              waitingDate: formatDateStr(getVal(`ログ${j}_予定日付`)),
              waitingTime: getVal(`ログ${j}_予定時間`)
            });
          }
        }
      }
    }

    if (newCustomers.length > 0) onImport(newCustomers, newRecords);
    else showAlert("インポートできるデータが見つかりませんでした。");
  };

  const handleExportCSV = () => {
    const headers = [
      "学園名", "園名", "理事長", "園長", "住所", "TEL", "メールアドレス", 
      "HPリンク", "Instagram", "協会関係", "HP業者", "GBPリンク", "口コミ評価", "口コミ数",
      "ログ1_活動種別", "ログ1_結果フラグ", "ログ1_日付", "ログ1_時間", "ログ1_メモ", "ログ1_予定日付", "ログ1_予定時間",
      "ログ2_活動種別", "ログ2_結果フラグ", "ログ2_日付", "ログ2_時間", "ログ2_メモ", "ログ2_予定日付", "ログ2_予定時間",
      "ログ3_活動種別", "ログ3_結果フラグ", "ログ3_日付", "ログ3_時間", "ログ3_メモ", "ログ3_予定日付", "ログ3_予定時間"
    ];
    
    const rows = customers.map(c => {
      const crecords = records.filter(r => r.customerId === c.id).sort((a,b) => new Date(b.date) - new Date(a.date));
      const baseInfo = [`"${c.schoolName || ''}"`,`"${c.kindergartenName || ''}"`,`"${c.chairman || ''}"`,`"${c.principal || ''}"`,`"${c.address || ''}"`,`"${c.tel || ''}"`,`"${c.email || ''}"`,`"${c.hpLink || ''}"`,`"${c.instagramUrl || ''}"`,`"${c.association || ''}"`,`"${c.hpVendor || ''}"`,`"${c.gbpLink || ''}"`,`"${c.reviewRating || ''}"`,`"${c.reviewCount || ''}"`];
      
      const logInfo = [];
      for (let i = 0; i < 3; i++) {
        const r = crecords[i];
        if (r) {
          const flag = r.teleApptResult || r.visitResult || r.salesResult || r.pastLogResult || '';
          logInfo.push(`"${r.type || ''}"`, `"${flag}"`, `"${r.date || ''}"`, `"${r.time || ''}"`, `"${(r.memo || '').replace(/"/g, '""')}"`, `"${r.waitingDate || ''}"`, `"${r.waitingTime || ''}"`);
        } else {
          logInfo.push('""', '""', '""', '""', '""', '""', '""'); // empty values for missing logs
        }
      }

      return [...baseInfo, ...logInfo].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `顧客リスト_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openEditModal = (c = null) => {
    setEditingCustomerData(c);
    setIsEditingModalOpen(true);
  };

  const toggleSelection = (id) => {
    const newIds = new Set(selectedIds);
    if (newIds.has(id)) newIds.delete(id);
    else newIds.add(id);
    setSelectedIds(newIds);
  };

  const toggleAllSelection = () => {
    if (selectedIds.size === filteredCustomers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCustomers.map(c => c.id)));
    }
  };

  const handleDeleteSelected = () => {
    onDeleteMultipleCustomers(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  return (
    <div className="bg-transparent md:bg-white md:rounded-xl md:shadow-sm md:border border-gray-200 flex flex-col h-full">
      <div className="p-0 pb-4 md:p-4 border-b flex flex-col gap-3 bg-transparent md:bg-gray-50 shrink-0">
        <div className="flex flex-col xl:flex-row justify-between items-stretch xl:items-center gap-3 w-full">
          <div className="flex flex-col md:flex-row flex-wrap gap-2 w-full xl:w-auto">
            <div className="relative w-full md:w-64">
              <input type="text" placeholder="園名、学園名で検索..." className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <Search className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
            </div>
            
            <div className="flex gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:flex-none md:w-36">
                <Filter className="absolute left-2.5 top-2.5 text-gray-400 w-3.5 h-3.5" />
                <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="w-full pl-8 pr-2 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none shadow-sm appearance-none cursor-pointer">
                  <option value="all">全ステータス</option>
                  <option value="user">ユーザー</option>
                  <option value="sales">営業済み</option>
                  <option value="visit">初回訪問</option>
                  <option value="teleappt">テレアポ中</option>
                  <option value="none">未対応</option>
                </select>
              </div>
              <div className="relative flex-1 md:flex-none md:w-36">
                <MapPin className="absolute left-2.5 top-2.5 text-gray-400 w-3.5 h-3.5" />
                <select value={filterAddress} onChange={e=>setFilterAddress(e.target.value)} className="w-full pl-8 pr-2 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none shadow-sm appearance-none cursor-pointer">
                  <option value="">全地域</option>
                  {availableAddresses.map((addr, i) => <option key={i} value={addr}>{addr}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:flex-none md:w-36">
                <PenTool className="absolute left-2.5 top-2.5 text-gray-400 w-3.5 h-3.5" />
                <select value={filterActivityType} onChange={e=>{setFilterActivityType(e.target.value); setFilterResultFlag('all');}} className="w-full pl-8 pr-2 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none shadow-sm appearance-none cursor-pointer">
                  <option value="all">全活動種別</option>
                  {activityTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div className="relative flex-1 md:flex-none md:w-36">
                <Target className="absolute left-2.5 top-2.5 text-gray-400 w-3.5 h-3.5" />
                <select value={filterResultFlag} onChange={e=>setFilterResultFlag(e.target.value)} className="w-full pl-8 pr-2 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none shadow-sm appearance-none cursor-pointer">
                  <option value="all">全結果フラグ</option>
                  {availableResultFlags.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-end xl:items-center space-y-2 md:space-y-0 space-x-0 md:space-x-2 shrink-0">
            <div className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-md border border-gray-200 w-full md:w-auto text-center">
              該当: {filteredCustomers.length} 件
            </div>
            <div className="flex w-full md:w-auto overflow-x-auto pb-1 xl:pb-0 gap-1.5">
              {selectedIds.size > 0 && (
                <button onClick={handleDeleteSelected} className="flex-1 md:flex-none flex justify-center items-center px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-sm shrink-0">
                  <Trash2 className="w-3.5 h-3.5 mr-1" /><span className="hidden md:inline">{selectedIds.size}件削除</span>
                </button>
              )}
              <div className="flex bg-white border border-gray-300 rounded-lg shadow-sm overflow-hidden shrink-0">
                <button onClick={() => setViewMode('card')} className={`px-2.5 py-2 transition-colors ${viewMode === 'card' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`} title="カード表示"><LayoutGrid className="w-4 h-4" /></button>
                <button onClick={() => setViewMode('list')} className={`px-2.5 py-2 transition-colors border-l border-gray-300 ${viewMode === 'list' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`} title="リスト表示"><List className="w-4 h-4" /></button>
              </div>
              <button onClick={handleExportCSV} className="flex-1 md:flex-none flex justify-center items-center px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-xs font-bold shadow-sm shrink-0"><Download className="w-3.5 h-3.5 mr-1" /><span className="hidden md:inline">出力</span></button>
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 md:flex-none flex justify-center items-center px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm shrink-0"><Upload className="w-3.5 h-3.5 mr-1" /><span className="hidden md:inline">追加</span></button>
              <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
              <button onClick={() => openEditModal()} className="flex-1 md:flex-none flex justify-center items-center px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm shrink-0"><Plus className="w-3.5 h-3.5 mr-1" /><span className="hidden md:inline">登録</span></button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto md:p-6 bg-transparent md:bg-gray-50">
        {viewMode === 'list' ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-gray-100 border-b border-gray-200 text-gray-700 font-bold">
                <tr>
                  <th className="px-4 py-3 w-10 text-center">
                    <input type="checkbox" checked={filteredCustomers.length > 0 && selectedIds.size === filteredCustomers.length} onChange={toggleAllSelection} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                  </th>
                  <th className="px-4 py-3 min-w-[140px]">ステータス</th>
                  <th className="px-4 py-3">園名</th>
                  <th className="px-4 py-3">学園名</th>
                  <th className="px-4 py-3">TEL</th>
                  <th className="px-4 py-3 min-w-[200px]">住所</th>
                  <th className="px-4 py-3 min-w-[200px]">最新ログ</th>
                  <th className="px-4 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCustomers.map(c => {
                  const latestRecord = c.latestRecord;
                  let badges = [];
                  let rowStyle = 'hover:bg-blue-50';

                  if (c.isUser) {
                    badges.push({ text: 'ユーザー', color: 'bg-orange-500' });
                    rowStyle = 'bg-orange-50/30 hover:bg-orange-50';
                  } else if (c.isSalesDone) {
                    badges.push({ text: '営業実行済み', color: 'bg-blue-600' });
                  } else if (c.isVisitTimeSet) {
                    badges.push({ text: '初回訪問', color: 'bg-purple-600' });
                    badges.push({ text: '営業時間設定', color: 'bg-purple-700' });
                  } else if (c.isVisited) {
                    badges.push({ text: '初回訪問', color: 'bg-purple-500' });
                  } else if (c.isTeleAppt) {
                    badges.push({ text: 'テレアポ', color: 'bg-pink-500' });
                    rowStyle = 'bg-pink-50/30 hover:bg-pink-50';
                    if(latestRecord && latestRecord.type === 'テレアポ' && latestRecord.teleApptResult) {
                      badges.push({ text: latestRecord.teleApptResult, color: 'bg-pink-600' });
                    }
                  }

                  const hasPastSalesHistory = c.crecords.some(r => r.type === '過去ログ登録' && r.pastLogResult === '過去営業履歴あり');
                  const isCompetitorProspect = c.crecords.some(r => r.type === '過去ログ登録' && r.pastLogResult === '他者見込み');

                  if (!c.isUser && hasPastSalesHistory) badges.push({ text: '過去営業履歴', color: 'bg-teal-500' });
                  if (!c.isUser && isCompetitorProspect) badges.push({ text: '他者見込み', color: 'bg-slate-500' });

                  return (
                    <tr key={c.id} onClick={() => { setSelectedCustomer(c); setIsDetailRecordFormOpen(false); }} className={`cursor-pointer transition-colors ${rowStyle}`}>
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelection(c.id)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          {badges.length > 0 ? badges.map((b, i) => <span key={i} className={`${b.color} text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm`}>{b.text}</span>) : <span className="text-gray-400 text-xs">-</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-extrabold text-gray-800">{c.kindergartenName}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{c.schoolName || '-'}</td>
                      <td className="px-4 py-3"><a href={`tel:${c.tel}`} target="_top" className="text-blue-600 font-medium hover:underline" onClick={e=>e.stopPropagation()}>{c.tel || '-'}</a></td>
                      <td className="px-4 py-3 text-gray-600 text-xs truncate max-w-[250px]" title={c.address}>
                        {c.address || '-'}
                        <div className="flex items-center gap-3 mt-1 text-gray-500 flex-wrap">
                          {(c.reviewRating || c.reviewCount) && (
                            <div className="flex items-center"><Star className="w-3 h-3 mr-1 text-yellow-500"/> {c.reviewRating || '-'} ({c.reviewCount || 0})</div>
                          )}
                          {c.hpLink && (
                            <a href={c.hpLink.startsWith('http') ? c.hpLink : `http://${c.hpLink}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="text-blue-600 hover:underline flex items-center"><Globe className="w-3 h-3 mr-0.5"/>HP</a>
                          )}
                          {c.instagramUrl && (
                            <a href={c.instagramUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="text-pink-600 hover:underline flex items-center"><Instagram className="w-3 h-3 mr-0.5"/>Insta</a>
                          )}
                          {c.gbpLink && (
                            <a href={c.gbpLink} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="text-emerald-600 hover:underline flex items-center"><LinkIcon className="w-3 h-3 mr-0.5"/>GBP</a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs truncate max-w-[300px]">
                        {latestRecord ? (
                          <div className="flex items-center" title={latestRecord.memo}>
                            <span className="font-bold text-gray-800 mr-2 shrink-0">{latestRecord.date}</span>
                            <span className="truncate">{latestRecord.type}: {latestRecord.memo}</span>
                          </div>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center space-x-1">
                          <button onClick={(e) => { e.stopPropagation(); setSelectedCustomer(c); setIsDetailRecordFormOpen(true); }} className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-md" title="記録登録"><PenTool className="w-4 h-4" /></button>
                          <button onClick={(e) => { e.stopPropagation(); openEditModal(c); }} className="p-1.5 text-blue-500 hover:bg-blue-100 rounded-md" title="編集"><Edit className="w-4 h-4" /></button>
                          <button onClick={(e) => { e.stopPropagation(); onDeleteCustomer(c.id); }} className="p-1.5 text-red-500 hover:bg-red-100 rounded-md" title="削除"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredCustomers.length === 0 && <div className="p-8 text-center text-gray-500">該当する顧客が見つかりません。</div>}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredCustomers.map(c => {
              const latestRecord = c.latestRecord;
              
              let cardStyle = 'bg-white border-gray-200';
              let headerStyle = 'bg-white';
              let badges = [];

              if (c.isUser) {
                cardStyle = 'bg-orange-50 border-orange-300 shadow-sm'; headerStyle = 'bg-orange-50';
                badges.push({ text: 'ユーザー', color: 'bg-orange-500' });
              } else if (c.isSalesDone) {
                cardStyle = 'bg-blue-50 border-blue-400 shadow-sm'; headerStyle = 'bg-blue-100';
                badges.push({ text: '営業実行済み', color: 'bg-blue-600' });
              } else if (c.isVisitTimeSet) {
                cardStyle = 'bg-purple-100 border-purple-500 shadow-sm'; headerStyle = 'bg-purple-200';
                badges.push({ text: '初回訪問済み', color: 'bg-purple-600' });
                badges.push({ text: '営業時間設定', color: 'bg-purple-700' });
              } else if (c.isVisited) {
                cardStyle = 'bg-purple-50 border-purple-300 shadow-sm'; headerStyle = 'bg-purple-100';
                badges.push({ text: '初回訪問済み', color: 'bg-purple-500' });
              } else if (c.isTeleAppt) {
                cardStyle = 'bg-pink-50 border-pink-300 shadow-sm'; headerStyle = 'bg-pink-100';
                badges.push({ text: 'テレアポ', color: 'bg-pink-500' });
                if(latestRecord && latestRecord.type === 'テレアポ' && latestRecord.teleApptResult) {
                  badges.push({ text: latestRecord.teleApptResult, color: 'bg-pink-600' });
                }
              }

              const hasPastSalesHistory = c.crecords.some(r => r.type === '過去ログ登録' && r.pastLogResult === '過去営業履歴あり');
              const isCompetitorProspect = c.crecords.some(r => r.type === '過去ログ登録' && r.pastLogResult === '他者見込み');

              if (!c.isUser && hasPastSalesHistory) {
                badges.push({ text: '過去営業履歴', color: 'bg-teal-500' });
                if (cardStyle === 'bg-white border-gray-200') {
                   cardStyle = 'bg-teal-50 border-teal-200 shadow-sm'; headerStyle = 'bg-teal-50';
                }
              }
              if (!c.isUser && isCompetitorProspect) {
                badges.push({ text: '他者見込み', color: 'bg-slate-500' });
              }

              return (
                <div key={c.id} onClick={() => { setSelectedCustomer(c); setIsDetailRecordFormOpen(false); }} className={`rounded-2xl border transition-all relative group flex flex-col overflow-hidden h-full cursor-pointer hover:shadow-md ${cardStyle}`}>
                  <div className={`p-4 md:p-5 flex-1 relative ${headerStyle}`}>
                    <div className="absolute top-3 left-3 z-10" onClick={e => e.stopPropagation()}>
                       <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelection(c.id)} className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer shadow-sm" />
                    </div>
                    <div className="absolute top-3 right-3 flex space-x-1 z-10">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedCustomer(c); setIsDetailRecordFormOpen(true); }} className="p-1.5 bg-white/60 hover:bg-white rounded-full text-emerald-600 shadow-sm" title="記録登録"><PenTool className="w-4 h-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); openEditModal(c); }} className="p-1.5 bg-white/60 hover:bg-white rounded-full text-gray-500 shadow-sm" title="編集"><Edit className="w-4 h-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); onDeleteCustomer(c.id); }} className="p-1.5 bg-white/60 hover:bg-white rounded-full text-red-500 shadow-sm" title="削除"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="mb-3 pl-6 pr-16">
                      <h3 className="text-lg font-extrabold text-gray-800 leading-tight mb-1">{c.kindergartenName}</h3>
                      <p className="text-xs text-gray-600 font-medium">{c.schoolName || '学園名未登録'}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {badges.map((b, i) => <span key={i} className={`${b.color} text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm`}>{b.text}</span>)}
                      </div>
                    </div>
                    <div className="space-y-2.5 text-sm mt-4 bg-white/60 p-3 rounded-lg border border-white/40">
                      <div className="flex items-center text-gray-700"><Phone className="w-4 h-4 mr-2 text-blue-500 shrink-0" /><a href={`tel:${c.tel}`} target="_top" className="text-blue-600 font-bold hover:underline" onClick={(e) => e.stopPropagation()}>{c.tel || '-'}</a></div>
                      <div className="flex items-start text-gray-600"><MapPin className="w-4 h-4 mr-2 text-gray-400 mt-0.5 shrink-0" /><span className="text-xs leading-tight">{c.address || '-'}</span></div>
                      {(c.reviewRating || c.reviewCount) && (
                        <div className="flex items-center text-gray-600"><Star className="w-4 h-4 mr-2 text-yellow-500 shrink-0" /><span className="text-xs font-bold text-gray-700">{c.reviewRating || '-'}</span><span className="text-[10px] ml-1">({c.reviewCount || 0}件)</span></div>
                      )}
                      
                      {/* 追加リンクエリア */}
                      <div className="flex gap-3 pt-1.5 border-t border-gray-200/60 mt-1.5">
                        {c.hpLink && (
                          <a href={c.hpLink.startsWith('http') ? c.hpLink : `http://${c.hpLink}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline flex items-center text-xs font-medium"><Globe className="w-3.5 h-3.5 mr-1"/>HP</a>
                        )}
                        {c.instagramUrl && (
                          <a href={c.instagramUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-pink-600 hover:underline flex items-center text-xs font-medium"><Instagram className="w-3.5 h-3.5 mr-1"/>Insta</a>
                        )}
                        {c.gbpLink && (
                          <a href={c.gbpLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-emerald-600 hover:underline flex items-center text-xs font-medium"><LinkIcon className="w-3.5 h-3.5 mr-1"/>GBP</a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="p-3 border-t bg-white/50 shrink-0">
                    <div className="flex items-center mb-1.5 text-gray-600"><PenTool className="w-3.5 h-3.5 mr-1" /><span className="text-[11px] font-bold">最新ログ</span></div>
                    {latestRecord ? (
                      <div className="text-xs">
                        <div className="font-bold text-gray-800 mb-0.5">{latestRecord.date} <span className="px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded ml-1 text-[9px]">{latestRecord.type}</span></div>
                        <p className="line-clamp-2 text-gray-600 leading-relaxed">{latestRecord.memo}</p>
                        {latestRecord.waitingDate && (
                          <div className="mt-1.5 text-[10px] text-blue-600 font-bold flex items-center">
                            <Clock className="w-3 h-3 mr-1" /> 予定: {latestRecord.waitingDate} {latestRecord.waitingTime || ''}
                          </div>
                        )}
                        {((latestRecord.type === '営業' && latestRecord.salesResult === '受注') || (latestRecord.type === '過去ログ登録' && latestRecord.pastLogResult === 'ユーザー')) && (
                          <div className="mt-1.5 text-[10px] bg-yellow-50 p-1.5 rounded border border-yellow-100 text-gray-700 truncate">
                            商品:{latestRecord.productName || '-'} | {latestRecord.monthlyFee || 0}円 | 年数:{latestRecord.years || 0} | 粗利:{latestRecord.profit || 0}P | 台数:{latestRecord.quantity || 0}台
                          </div>
                        )}
                      </div>
                    ) : <div className="text-[11px] text-gray-400 py-1">記録なし</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedCustomer && <CustomerDetailModal customer={selectedCustomer} records={records} activityTypes={activityTypes} products={products} onClose={() => { setSelectedCustomer(null); setIsDetailRecordFormOpen(false); }} onEdit={() => { setSelectedCustomer(null); openEditModal(selectedCustomer); setIsDetailRecordFormOpen(false); }} onDelete={() => { setSelectedCustomer(null); onDeleteCustomer(selectedCustomer.id); setIsDetailRecordFormOpen(false); }} onUpdateRecord={onUpdateRecord} onDeleteRecord={onDeleteRecord} onAddRecord={onAddRecord} showAlert={showAlert} showConfirm={showConfirm} defaultExpandRecordForm={isDetailRecordFormOpen} reportTemplates={reportTemplates} />}
      {isEditingModalOpen && <CustomerModal customer={editingCustomerData} onClose={() => setIsEditingModalOpen(false)} onSave={(data) => { onSaveCustomer(data); setIsEditingModalOpen(false); }} />}
    </div>
  );
}

// 顧客詳細モーダル
function CustomerDetailModal({ customer, records, activityTypes, products, onClose, onEdit, onDelete, onUpdateRecord, onDeleteRecord, onAddRecord, showAlert, showConfirm, defaultExpandRecordForm = false, reportTemplates = [] }) {
  const customerRecords = records.filter(r => r.customerId === customer.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [isAddingRecord, setIsAddingRecord] = useState(defaultExpandRecordForm);
  
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAiAnalysis('');
    try {
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const prompt = `以下の顧客情報と過去の営業履歴を読み込み、以下の3点を提供してください。
      1. これまでの経緯の簡単な要約（箇条書き）
      2. 次に行うべきおすすめのアクション（電話、メール、訪問など）
      3. その際に使えるフォローアップメール、またはトークスクリプトの草案

      【顧客情報】
      園名: ${customer.kindergartenName}
      学園名: ${customer.schoolName}
      連絡先: ${customer.tel} / ${customer.email}

      【活動履歴】
      ${customerRecords.map(r => `${r.date} [${r.type}]: ${r.memo}`).join('\n')}
      `;

      const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      setAiAnalysis(data.candidates?.[0]?.content?.parts?.[0]?.text || '分析結果を取得できませんでした。');
    } catch (e) {
      setAiAnalysis("分析中にエラーが発生しました。");
    }
    setIsAnalyzing(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end md:items-center justify-center z-[60] md:p-4 animate-in fade-in">
      <div className="bg-gray-50 md:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden rounded-t-2xl pb-safe">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center p-4 md:p-5 border-b bg-white shrink-0 gap-3">
          <h2 className="text-lg md:text-xl font-extrabold text-gray-800 flex items-center w-full md:w-auto pr-8 md:pr-0">
            <Briefcase className="w-5 h-5 md:w-6 md:h-6 mr-2 text-blue-600 shrink-0" />
            <span className="truncate">{customer.kindergartenName}</span>
          </h2>
          <button onClick={onClose} className="absolute top-4 right-4 md:static text-gray-400 bg-gray-100 hover:bg-gray-200 p-1.5 rounded-full"><X className="w-5 h-5"/></button>
          
          <div className="flex w-full md:w-auto space-x-2 mt-2 md:mt-0">
            <button onClick={handleAnalyze} disabled={isAnalyzing} className="flex-1 md:flex-none justify-center text-purple-700 bg-purple-100 hover:bg-purple-200 px-3 py-2 rounded-lg text-sm flex items-center font-bold transition-colors disabled:opacity-50">
              <Sparkles className="w-4 h-4 mr-1.5" />{isAnalyzing ? '分析中...' : 'AI分析'}
            </button>
            <button onClick={onEdit} className="flex-1 md:flex-none justify-center text-blue-700 bg-blue-100 hover:bg-blue-200 px-3 py-2 rounded-lg text-sm flex items-center font-bold transition-colors">
              <Edit className="w-4 h-4 mr-1.5" />編集
            </button>
            <button onClick={onDelete} className="flex-1 md:flex-none justify-center text-red-700 bg-red-100 hover:bg-red-200 px-3 py-2 rounded-lg text-sm flex items-center font-bold transition-colors">
              <Trash2 className="w-4 h-4 mr-1.5" />削除
            </button>
          </div>
        </div>
        
        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          {aiAnalysis && (
            <div className="mb-6 bg-purple-50 p-5 rounded-xl border border-purple-200 shadow-sm relative">
              <button onClick={() => setAiAnalysis('')} className="absolute top-3 right-3 text-purple-400 hover:text-purple-600"><X className="w-5 h-5"/></button>
              <h3 className="font-bold text-md text-purple-800 mb-3 flex items-center"><Sparkles className="w-5 h-5 mr-2"/>AI 分析・アクション提案</h3>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {aiAnalysis}
              </div>
            </div>
          )}
          
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="flex flex-col md:flex-row gap-4 justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-gray-500 text-sm">{customer.schoolName}</h3>
                <div className="text-xs text-gray-400 mt-1">{customer.association || '協会未登録'}</div>
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <a href={`tel:${customer.tel}`} target="_top" className="flex-1 md:flex-none text-center bg-green-500 text-white font-bold py-2 px-4 rounded-lg shadow-sm flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                   <Phone className="w-4 h-4 mr-2"/>発信
                </a>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-4 text-sm text-gray-700 bg-gray-50 p-4 rounded-lg">
              <div className="flex items-start"><Phone className="w-4 h-4 mr-2 text-gray-400 mt-0.5" /><span className="font-medium">{customer.tel || '-'}</span></div>
              <div className="flex items-start"><Mail className="w-4 h-4 mr-2 text-gray-400 mt-0.5" />{customer.email || '-'}</div>
              <div className="flex items-start"><Users className="w-4 h-4 mr-2 text-gray-400 mt-0.5" />理: {customer.chairman || '-'} / 園: {customer.principal || '-'}</div>
              <div className="flex items-start"><MapPin className="w-4 h-4 mr-2 text-gray-400 mt-0.5" />{customer.address || '-'}</div>
              <div className="flex items-start md:col-span-2 mt-1 flex-wrap gap-x-4 gap-y-1">
                <div className="flex items-center text-gray-600 mr-2">
                  <Star className="w-4 h-4 mr-2 text-yellow-500 shrink-0" />
                  <span>GBP評価: <span className="font-bold text-gray-800">{customer.reviewRating || '-'}</span></span>
                  <span className="text-gray-600 ml-2">({customer.reviewCount || '-'}件)</span>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-4 md:col-span-2 pt-2 border-t border-gray-200 text-xs font-bold">
                {customer.hpLink && (
                  <a href={customer.hpLink.startsWith('http') ? customer.hpLink : `http://${customer.hpLink}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center"><Globe className="w-4 h-4 mr-1"/>HPリンクを開く</a>
                )}
                {customer.instagramUrl && (
                  <a href={customer.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-pink-600 hover:underline flex items-center"><Instagram className="w-4 h-4 mr-1"/>Instagramを開く</a>
                )}
                {customer.gbpLink && (
                  <a href={customer.gbpLink} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline flex items-center"><LinkIcon className="w-4 h-4 mr-1"/>GBPリンクを開く</a>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-slate-800 text-white p-3 md:p-4 flex justify-between items-center">
              <div className="flex items-center"><PenTool className="w-4 h-4 mr-2" /><h4 className="font-bold text-sm">活動履歴 ({customerRecords.length}件)</h4></div>
              <button onClick={() => setIsAddingRecord(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center transition-colors shadow-sm">
                <Plus className="w-3.5 h-3.5 mr-1" />記録を追加
              </button>
            </div>
            
            {isAddingRecord && (
              <div className="p-4 border-b border-gray-200 bg-blue-50/50">
                <h5 className="font-bold text-blue-800 text-sm mb-3 flex items-center"><PenTool className="w-4 h-4 mr-1.5"/>新規記録の追加</h5>
                <RecordEditForm 
                  record={{
                    customerId: customer.id,
                    type: activityTypes[0]?.name || "",
                    resultFlag: "",
                    date: getCurrentDateTime().date,
                    time: getCurrentDateTime().time,
                    memo: "",
                    waitingDate: "",
                    waitingTime: "",
                    productName: "",
                    monthlyFee: "",
                    years: "",
                    profit: "",
                    quantity: "",
                    audioData: "",
                    audioName: "",
                    audioLink: "",
                    audioMemo: ""
                  }}
                  activityTypes={activityTypes}
                  products={products}
                  onSave={(newRecord) => {
                    const recordToSave = { ...newRecord };
                    if (!isWaitingDateNeeded(recordToSave.type, recordToSave.resultFlag)) {
                      delete recordToSave.waitingDate;
                      delete recordToSave.waitingTime;
                    }
                    if (!((recordToSave.type === '営業' && recordToSave.resultFlag === '受注') || (recordToSave.type === '過去ログ登録' && recordToSave.resultFlag === 'ユーザー'))) {
                      delete recordToSave.productName;
                      delete recordToSave.monthlyFee;
                      delete recordToSave.years;
                      delete recordToSave.profit;
                      delete recordToSave.quantity;
                    }
                    if (recordToSave.type !== 'テレアポ') {
                      delete recordToSave.audioData;
                      delete recordToSave.audioName;
                      delete recordToSave.audioLink;
                      delete recordToSave.audioMemo;
                    }
                    if (recordToSave.type === 'テレアポ') recordToSave.teleApptResult = recordToSave.resultFlag;
                    if (recordToSave.type === '初回訪問') recordToSave.visitResult = recordToSave.resultFlag;
                    if (recordToSave.type === '営業') recordToSave.salesResult = recordToSave.resultFlag;
                    if (recordToSave.type === '過去ログ登録') recordToSave.pastLogResult = recordToSave.resultFlag;

                    onAddRecord(recordToSave);
                    setIsAddingRecord(false);
                  }}
                  onCancel={() => setIsAddingRecord(false)}
                  isNew={true}
                  showAlert={showAlert}
                  selectedCustomer={customer}
                  reportTemplates={reportTemplates}
                />
              </div>
            )}

            <div className="p-4 md:p-5 space-y-5">
              {customerRecords.length === 0 ? <div className="text-center py-6 text-gray-400">記録はまだありません。</div> : (
                customerRecords.map((record) => (
                  <div key={record.id} className="relative pl-6 pb-2 border-l-2 border-gray-100 last:border-l-0">
                    <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-white border-2 border-blue-400"></div>
                    {editingRecordId === record.id ? (
                      <RecordEditForm 
                        record={record}
                        activityTypes={activityTypes}
                        products={products}
                        onSave={(updated) => { 
                          const rec = {...updated};
                          if (rec.type === 'テレアポ') rec.teleApptResult = rec.resultFlag;
                          if (rec.type === '初回訪問') rec.visitResult = rec.resultFlag;
                          if (rec.type === '営業') rec.salesResult = rec.resultFlag;
                          if (rec.type === '過去ログ登録') rec.pastLogResult = rec.resultFlag;
                          if (rec.type !== 'テレアポ') { 
                            delete rec.audioData; delete rec.audioName; delete rec.audioLink; delete rec.audioMemo;
                          }
                          onUpdateRecord(rec); 
                          setEditingRecordId(null); 
                        }} 
                        onCancel={() => setEditingRecordId(null)}
                        showAlert={showAlert}
                        selectedCustomer={customer}
                        reportTemplates={reportTemplates}
                      />
                    ) : (
                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 shadow-sm">
                        <div className="flex flex-wrap justify-between items-start mb-2 gap-2">
                          <div>
                            <span className="font-extrabold text-gray-800 mr-2">{record.date} {record.time}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-white border-gray-300 text-gray-700">
                              {record.type} {record.teleApptResult ? `(${record.teleApptResult})`: record.visitResult ? `(${record.visitResult})`: record.salesResult ? `(${record.salesResult})` : record.pastLogResult ? `(${record.pastLogResult})` : ''}
                            </span>
                          </div>
                          <div className="flex space-x-1 shrink-0">
                            <button onClick={() => setEditingRecordId(record.id)} className="p-1.5 text-blue-600 bg-blue-50 rounded-md"><Edit className="w-3.5 h-3.5" /></button>
                            <button onClick={() => onDeleteRecord(record.id)} className="p-1.5 text-red-600 bg-red-50 rounded-md"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <p className="text-gray-700 text-sm whitespace-pre-wrap leading-relaxed mt-2">{record.memo}</p>
                        
                        {record.audioData && (
                          <div className="mt-3" onClick={e => e.stopPropagation()}>
                            <audio src={record.audioData} controls className="h-8 w-full max-w-sm outline-none" />
                          </div>
                        )}
                        {record.audioLink && (
                          <div className="mt-2 text-xs">
                            <a href={record.audioLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center" onClick={e => e.stopPropagation()}>
                              <LinkIcon className="w-3.5 h-3.5 mr-1" /> 音声リンクを開く
                            </a>
                          </div>
                        )}
                        {record.audioMemo && (
                          <div className="mt-1 text-xs text-gray-500 bg-gray-100 p-2 rounded border border-gray-200">
                            <span className="font-bold mr-1">音声メモ:</span>{record.audioMemo}
                          </div>
                        )}

                        {record.waitingDate && (
                          <div className="mt-2 p-2 bg-blue-100 border border-blue-200 rounded-lg text-xs text-blue-800 font-medium flex items-center w-fit">
                            <Clock className="w-3.5 h-3.5 mr-1.5" /> 予定日時: {record.waitingDate} {record.waitingTime || ''}
                          </div>
                        )}
                        {((latestRecord.type === '営業' && latestRecord.salesResult === '受注') || (latestRecord.type === '過去ログ登録' && latestRecord.pastLogResult === 'ユーザー')) && (
                          <div className="mt-1.5 text-[10px] bg-yellow-50 p-1.5 rounded border border-yellow-100 text-gray-700 truncate">
                            商品:{latestRecord.productName || '-'} | {latestRecord.monthlyFee || 0}円 | 年数:{latestRecord.years || 0} | 粗利:{latestRecord.profit || 0}P | 台数:{latestRecord.quantity || 0}台
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordEditForm({ record, activityTypes, products, onSave, onCancel, isNew = false, showAlert, selectedCustomer, reportTemplates }) {
  const getInitialResultFlag = (rec) => {
    if (rec.resultFlag) return rec.resultFlag;
    if (rec.type === 'テレアポ') return rec.teleApptResult || "";
    if (rec.type === '初回訪問') return rec.visitResult || "";
    if (rec.type === '営業') return rec.salesResult || "";
    if (rec.type === '過去ログ登録') return rec.pastLogResult || "";
    return "";
  };

  const [formData, setFormData] = useState({
    ...record,
    resultFlag: getInitialResultFlag(record),
    audioData: record.audioData || "",
    audioName: record.audioName || "",
    audioLink: record.audioLink || "",
    audioMemo: record.audioMemo || ""
  });
  
  const currentTypeConfig = activityTypes.find(t => t.name === formData.type) || { flags: [] };

  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState('');
  const [reportText, setReportText] = useState('');
  const [isAiFormatting, setIsAiFormatting] = useState(false);

  const isReportEligible = formData.type === '初回訪問' || (formData.type === 'テレアポ' && formData.resultFlag === '時間設定');

  useEffect(() => { 
    if (isReportEligible && reportTemplates && reportTemplates.length > 0 && !selectedReportTemplateId) {
      const defaultTemplate = reportTemplates.find(t => t.name.includes('アポ獲得')) || reportTemplates[0];
      setSelectedReportTemplateId(defaultTemplate.id); 
    }
  }, [isReportEligible, reportTemplates, selectedReportTemplateId]);

  useEffect(() => {
    if (selectedReportTemplateId && selectedCustomer && reportTemplates) {
      const template = reportTemplates.find(t => t.id === Number(selectedReportTemplateId));
      if (template) {
        let b = template.body;
        const resultVal = formData.resultFlag;
        const waitingStr = formData.waitingDate ? `${formData.waitingDate} ${formData.waitingTime || ''}`.trim() : '未定';
        const map = { 
          '{{学園名}}': selectedCustomer.schoolName || '', 
          '{{園名}}': selectedCustomer.kindergartenName || '', 
          '{{理事長}}': selectedCustomer.chairman || '', 
          '{{園長}}': selectedCustomer.principal || '', 
          '{{住所}}': selectedCustomer.address || '', 
          '{{HPリンク}}': selectedCustomer.hpLink || '', 
          '{{TEL}}': selectedCustomer.tel || '', 
          '{{メール}}': selectedCustomer.email || '', 
          '{{メモ}}': formData.memo || '', 
          '{{結果}}': resultVal || '',
          '{{予定日時}}': waitingStr
        };
        for (const [key, val] of Object.entries(map)) b = b.replaceAll(key, val);
        setReportText(b);
      }
    } else setReportText('');
  }, [selectedReportTemplateId, selectedCustomer, formData.memo, formData.resultFlag, formData.type, formData.waitingDate, formData.waitingTime, reportTemplates]);

  const handleFormatMemoWithAI = async () => {
    if (!formData.memo) return;
    setIsAiFormatting(true);
    try {
      const promptText = `以下の営業メモの殴り書きを、社内報告用に読みやすく整理してください。「状況」「顧客の反応」「ネクストアクション」などの項目に分けて簡潔にまとめてください。事実を変えたり、憶測を追加したりしないでください。Markdown表記（*や#）は極力使わずにプレーンなテキストで出力してください。\n\n【元のメモ】\n${formData.memo}`;
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const payload = { contents: [{ parts: [{ text: promptText }] }] };
      const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      setFormData(prev => ({ ...prev, memo: data.candidates[0].content.parts[0].text }));
      showAlert('✨ AIによるメモの整形が完了しました！');
    } catch(e) {
      console.error(e);
      showAlert('メモの整形に失敗しました。');
    } finally {
      setIsAiFormatting(false);
    }
  };

  const handleAudioUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { 
         if (showAlert) showAlert("ファイルサイズが大きすぎます。2MB以下の音声ファイルを選択してください。");
         return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData({ ...formData, audioData: event.target.result, audioName: file.name });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCopyReport = () => {
    const ta = document.createElement("textarea");
    ta.value = reportText;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (showAlert) showAlert('レポートをコピーしました！\n別のツールへ貼り付けて報告してください。');
    } catch (err) {
      if (showAlert) showAlert("コピーに失敗しました。");
    }
    document.body.removeChild(ta);
  };

  const handleShareReport = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: '活動報告',
          text: reportText,
        });
      } catch (err) {
        console.log('Share failed:', err);
      }
    } else {
      handleCopyReport();
    }
  };

  const handleTypeChange = (e) => {
    const newType = e.target.value;
    setFormData({
      ...formData, 
      type: newType, 
      resultFlag: "", 
      audioData: "", 
      audioName: "", 
      audioLink: "", 
      audioMemo: "",
      waitingDate: "",
      waitingTime: ""
    });
  };

  const handleFlagChange = (e) => {
    const newFlag = e.target.value;
    const needsWaiting = isWaitingDateNeeded(formData.type, newFlag);
    
    setFormData({
      ...formData, 
      resultFlag: newFlag,
      waitingDate: needsWaiting ? (formData.waitingDate || getCurrentDateTime().date) : "",
      waitingTime: needsWaiting ? (formData.waitingTime || getRoundedTime()) : ""
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.customerId) return;
    
    const recordToSave = { ...formData };
    
    const needsWaitingDate = isWaitingDateNeeded(recordToSave.type, recordToSave.resultFlag);

    // フラグのクリアとセット
    recordToSave.teleApptResult = "";
    recordToSave.visitResult = "";
    recordToSave.salesResult = "";
    recordToSave.pastLogResult = "";

    if (recordToSave.type === 'テレアポ') recordToSave.teleApptResult = recordToSave.resultFlag;
    if (recordToSave.type === '初回訪問') recordToSave.visitResult = recordToSave.resultFlag;
    if (recordToSave.type === '営業') recordToSave.salesResult = recordToSave.resultFlag;
    if (recordToSave.type === '過去ログ登録') recordToSave.pastLogResult = recordToSave.resultFlag;
    delete recordToSave.resultFlag;
    
    if (recordToSave.type !== 'テレアポ') {
      delete recordToSave.audioData;
      delete recordToSave.audioName;
      delete recordToSave.audioLink;
      delete recordToSave.audioMemo;
    }

    if (!needsWaitingDate) {
      delete recordToSave.waitingDate;
      delete recordToSave.waitingTime;
    }

    const isSalesOrder = recordToSave.type === '営業' && recordToSave.salesResult === '受注';
    const isPastUser = recordToSave.type === '過去ログ登録' && recordToSave.pastLogResult === 'ユーザー';

    if (!isSalesOrder && !isPastUser) {
      delete recordToSave.productName; delete recordToSave.monthlyFee; delete recordToSave.years; delete recordToSave.profit; delete recordToSave.quantity;
    }

    onSave(recordToSave);
  };

  return (
    <div className="bg-white rounded-xl p-4 border border-blue-200 shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold text-gray-700">活動種別</label>
          <select value={formData.type} onChange={handleTypeChange} className="p-2 text-sm border rounded bg-gray-50 focus:bg-white">
            {activityTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold text-gray-700">結果フラグ</label>
          <select value={formData.resultFlag} onChange={handleFlagChange} className="p-2 text-sm border rounded bg-gray-50 focus:bg-white">
            <option value="">選択</option>
            {currentTypeConfig.flags.map((f, i) => <option key={i} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold text-gray-700">日付</label>
          <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="p-2 text-sm border rounded bg-gray-50 focus:bg-white" />
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold text-gray-700">時間</label>
          <input type="time" value={formData.time || ''} onChange={e => setFormData({...formData, time: e.target.value})} className="p-2 text-sm border rounded bg-gray-50 focus:bg-white" />
        </div>
      </div>

      {formData.type === 'テレアポ' && (
        <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          <label className="text-xs font-bold text-gray-700 flex items-center"><Monitor className="w-3.5 h-3.5 mr-1"/>音声データ・関連情報</label>
          
          <div className="flex flex-col space-y-1">
            <span className="text-[10px] text-gray-500 font-bold">ファイル添付 (2MB以下)</span>
            <div className="flex items-center space-x-2">
              <input type="file" accept="audio/*" id={`audioUpload-${record.id || 'new'}`} className="hidden" onChange={handleAudioUpload} />
              <button type="button" onClick={() => document.getElementById(`audioUpload-${record.id || 'new'}`).click()} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50 flex items-center shadow-sm">
                <Upload className="w-3.5 h-3.5 mr-1" /> ファイルを選択
              </button>
              {formData.audioName && <span className="text-xs text-gray-600 truncate max-w-[150px]">{formData.audioName}</span>}
              {formData.audioData && <button type="button" onClick={() => setFormData({...formData, audioData: '', audioName: ''})} className="p-1 text-red-500 hover:bg-red-50 rounded"><X className="w-3.5 h-3.5"/></button>}
            </div>
            {formData.audioData && <audio src={formData.audioData} controls className="h-8 w-full max-w-sm mt-2 outline-none" />}
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[10px] text-gray-500 font-bold">音声リンク (URL)</span>
            <input type="url" value={formData.audioLink} onChange={e => setFormData({...formData, audioLink: e.target.value})} placeholder="https://..." className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[10px] text-gray-500 font-bold">音声に関するメモ</span>
            <input type="text" value={formData.audioMemo} onChange={e => setFormData({...formData, audioMemo: e.target.value})} placeholder="パスワードなど" className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
          </div>
        </div>
      )}
      
      {isWaitingDateNeeded(formData.type, formData.resultFlag) && (
        <div className="grid grid-cols-2 gap-3 mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="text-xs font-bold text-gray-700 col-span-2 flex items-center"><Clock className="w-3.5 h-3.5 mr-1"/>予定日時設定</div>
          <input type="date" value={formData.waitingDate || ''} onChange={e => setFormData({...formData, waitingDate: e.target.value})} className="p-2 text-sm border rounded bg-white" />
          <select value={formData.waitingTime || ''} onChange={e => setFormData({...formData, waitingTime: e.target.value})} className="p-2 text-sm border rounded bg-white appearance-none cursor-pointer">
            <option value="">選択</option>
            {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      {((formData.type === '営業' && formData.resultFlag === '受注') || (formData.type === '過去ログ登録' && formData.resultFlag === 'ユーザー')) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">商品名</label>
            <select name="productName" value={formData.productName || ''} onChange={e=>setFormData({...formData, productName: e.target.value})} className="p-1.5 text-xs border rounded bg-white">
              <option value="">選択</option>
              {products && products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">月額</label><input type="number" value={formData.monthlyFee || ''} onChange={e=>setFormData({...formData, monthlyFee: e.target.value})} className="p-1.5 text-xs border rounded bg-white" /></div>
          <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">回数(年数)</label><input type="number" value={formData.years || ''} onChange={e=>setFormData({...formData, years: e.target.value})} className="p-1.5 text-xs border rounded bg-white" /></div>
          <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">粗利(P)</label><input type="number" value={formData.profit || ''} onChange={e=>setFormData({...formData, profit: e.target.value})} className="p-1.5 text-xs border rounded bg-white" /></div>
          <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">台数</label><input type="number" value={formData.quantity || ''} onChange={e=>setFormData({...formData, quantity: e.target.value})} className="p-1.5 text-xs border rounded bg-white" /></div>
        </div>
      )}
      
      <textarea value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} rows={4} className="w-full p-2 text-sm border rounded mb-3 resize-y bg-gray-50 focus:bg-white" placeholder="詳細メモ..."/>
      
      {isReportEligible && selectedCustomer && reportTemplates && (
        <div className="p-4 mb-3 bg-indigo-50 border border-indigo-200 rounded-xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
            <h3 className="text-xs font-bold text-indigo-800">報告フォーマット</h3>
            <select 
              value={selectedReportTemplateId} 
              onChange={e => setSelectedReportTemplateId(Number(e.target.value))}
              className="px-2 py-1.5 text-xs border border-indigo-300 rounded bg-white max-w-xs focus:outline-none"
            >
              {reportTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <button type="button" onClick={handleCopyReport} className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors flex justify-center items-center"><Copy className="w-3.5 h-3.5 mr-1" />コピー</button>
              <button type="button" onClick={handleShareReport} className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors flex justify-center items-center"><Share2 className="w-3.5 h-3.5 mr-1" />共有・報告</button>
            </div>
          </div>
          <textarea readOnly value={reportText} rows={8} className="w-full p-3 border border-indigo-200 rounded-lg text-xs bg-white focus:outline-none" />
        </div>
      )}

      <div className="flex justify-end space-x-2">
        <button onClick={onCancel} className="px-4 py-2 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 transition-colors">キャンセル</button>
        <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors">{isNew ? '追加する' : '更新する'}</button>
      </div>
    </div>
  );
}

function RecordView({ customers, products, reportTemplates, activityTypes, onSave, showAlert }) {
  const initDateTime = getCurrentDateTime();
  const [formData, setFormData] = useState({ customerId: "", type: activityTypes[0]?.name || "テレアポ", resultFlag: "", productName: "", monthlyFee: "", years: "", profit: "", quantity: "", date: initDateTime.date, time: initDateTime.time, memo: "", waitingDate: "", waitingTime: "", audioData: "", audioName: "", audioLink: "", audioMemo: "" });
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isAiFormatting, setIsAiFormatting] = useState(false);
  const dropdownRef = useRef(null);

  const isReportEligible = formData.type === '初回訪問' || (formData.type === 'テレアポ' && formData.resultFlag === '時間設定');
  const selectedCustomer = customers.find(c => c.id === formData.customerId);
  const currentTypeConfig = activityTypes.find(t => t.name === formData.type) || { flags: [] };

  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState('');
  const [reportText, setReportText] = useState('');

  useEffect(() => { 
    if (isReportEligible && reportTemplates && reportTemplates.length > 0 && !selectedReportTemplateId) {
      const defaultTemplate = reportTemplates.find(t => t.name.includes('アポ獲得')) || reportTemplates[0];
      setSelectedReportTemplateId(defaultTemplate.id); 
    }
  }, [isReportEligible, reportTemplates, selectedReportTemplateId]);

  useEffect(() => {
    if (selectedReportTemplateId && selectedCustomer && reportTemplates) {
      const template = reportTemplates.find(t => t.id === Number(selectedReportTemplateId));
      if (template) {
        let b = template.body;
        const resultVal = formData.resultFlag;
        const waitingStr = formData.waitingDate ? `${formData.waitingDate} ${formData.waitingTime || ''}`.trim() : '未定';
        const map = { 
          '{{学園名}}': selectedCustomer.schoolName || '', 
          '{{園名}}': selectedCustomer.kindergartenName || '', 
          '{{理事長}}': selectedCustomer.chairman || '', 
          '{{園長}}': selectedCustomer.principal || '', 
          '{{住所}}': selectedCustomer.address || '', 
          '{{HPリンク}}': selectedCustomer.hpLink || '', 
          '{{TEL}}': selectedCustomer.tel || '', 
          '{{メール}}': selectedCustomer.email || '', 
          '{{メモ}}': formData.memo || '', 
          '{{結果}}': resultVal || '',
          '{{予定日時}}': waitingStr
        };
        for (const [key, val] of Object.entries(map)) b = b.replaceAll(key, val);
        setReportText(b);
      }
    } else setReportText('');
  }, [selectedReportTemplateId, selectedCustomer, formData.memo, formData.resultFlag, formData.type, formData.waitingDate, formData.waitingTime, reportTemplates]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setIsDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFormatMemoWithAI = async () => {
    if (!formData.memo) return;
    setIsAiFormatting(true);
    try {
      const promptText = `以下の営業メモの殴り書きを、社内報告用に読みやすく整理してください。「状況」「顧客の反応」「ネクストアクション」などの項目に分けて簡潔にまとめてください。事実を変えたり、憶測を追加したりしないでください。Markdown表記（*や#）は極力使わずにプレーンなテキストで出力してください。\n\n【元のメモ】\n${formData.memo}`;
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const payload = { contents: [{ parts: [{ text: promptText }] }] };
      const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      setFormData(prev => ({ ...prev, memo: data.candidates[0].content.parts[0].text }));
      showAlert('✨ AIによるメモの整形が完了しました！');
    } catch(e) {
      console.error(e);
      showAlert('メモの整形に失敗しました。');
    } finally {
      setIsAiFormatting(false);
    }
  };

  const handleAudioUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { 
         showAlert("ファイルサイズが大きすぎます。2MB以下の音声ファイルを選択してください。");
         return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData({ ...formData, audioData: event.target.result, audioName: file.name });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCopyReport = () => {
    const ta = document.createElement("textarea");
    ta.value = reportText;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (showAlert) showAlert('レポートをコピーしました！\n別のツールへ貼り付けて報告してください。');
    } catch (err) {
      if (showAlert) showAlert("コピーに失敗しました。");
    }
    document.body.removeChild(ta);
  };

  const handleShareReport = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: '活動報告',
          text: reportText,
        });
      } catch (err) {
        console.log('Share failed:', err);
      }
    } else {
      handleCopyReport();
    }
  };

  const handleTypeChange = (e) => {
    const newType = e.target.value;
    setFormData({
      ...formData, 
      type: newType, 
      resultFlag: "", 
      audioData: "", 
      audioName: "", 
      audioLink: "", 
      audioMemo: "",
      waitingDate: "",
      waitingTime: ""
    });
  };

  const handleFlagChange = (e) => {
    const newFlag = e.target.value;
    const needsWaiting = isWaitingDateNeeded(formData.type, newFlag);
    
    setFormData({
      ...formData, 
      resultFlag: newFlag,
      waitingDate: needsWaiting ? (formData.waitingDate || getCurrentDateTime().date) : "",
      waitingTime: needsWaiting ? (formData.waitingTime || getRoundedTime()) : ""
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.customerId) return showAlert("顧客を選択してください。");
    
    const recordToSave = { ...formData };
    
    const needsWaitingDate = isWaitingDateNeeded(recordToSave.type, recordToSave.resultFlag);

    recordToSave.teleApptResult = "";
    recordToSave.visitResult = "";
    recordToSave.salesResult = "";
    recordToSave.pastLogResult = "";

    if (recordToSave.type === 'テレアポ') recordToSave.teleApptResult = recordToSave.resultFlag;
    if (recordToSave.type === '初回訪問') recordToSave.visitResult = recordToSave.resultFlag;
    if (recordToSave.type === '営業') recordToSave.salesResult = recordToSave.resultFlag;
    if (recordToSave.type === '過去ログ登録') recordToSave.pastLogResult = recordToSave.resultFlag;
    delete recordToSave.resultFlag;
    
    if (recordToSave.type !== 'テレアポ') {
      delete recordToSave.audioData;
      delete recordToSave.audioName;
      delete recordToSave.audioLink;
      delete recordToSave.audioMemo;
    }

    if (!needsWaitingDate) {
      delete recordToSave.waitingDate;
      delete recordToSave.waitingTime;
    }

    const isSalesOrder = recordToSave.type === '営業' && recordToSave.salesResult === '受注';
    const isPastUser = recordToSave.type === '過去ログ登録' && recordToSave.pastLogResult === 'ユーザー';

    if (!isSalesOrder && !isPastUser) {
      delete recordToSave.productName; delete recordToSave.monthlyFee; delete recordToSave.years; delete recordToSave.profit; delete recordToSave.quantity;
    }

    onSave(recordToSave);
    const resetDateTime = getCurrentDateTime();
    setFormData({ ...formData, customerId: "", memo: "", resultFlag: "", waitingDate: "", waitingTime: "", productName: "", monthlyFee: "", years: "", profit: "", quantity: "", audioData: "", audioName: "", audioLink: "", audioMemo: "", date: resetDateTime.date, time: resetDateTime.time }); 
  };

  const filteredCustomers = customers.filter(c => c.kindergartenName.includes(customerSearchTerm) || (c.schoolName && c.schoolName.includes(customerSearchTerm)));

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6 mb-8">
      <h2 className="text-xl font-bold mb-6 text-gray-800 border-b pb-3">活動記録の登録</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex flex-col space-y-1 relative" ref={dropdownRef}>
          <label className="text-xs font-bold text-gray-700">対象顧客 (必須)</label>
          <div className="relative">
            <div className="px-4 py-3 border border-gray-300 rounded-lg text-sm bg-gray-50 cursor-pointer flex justify-between items-center" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
              <span className={selectedCustomer ? "text-gray-900 font-bold" : "text-gray-400"}>{selectedCustomer ? `${selectedCustomer.kindergartenName}` : "顧客を検索・選択してください"}</span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </div>
            {isDropdownOpen && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-[300px] flex flex-col">
                <div className="p-2 border-b bg-gray-50"><input type="text" className="w-full px-3 py-2 border rounded text-sm focus:outline-none" placeholder="園名で検索..." value={customerSearchTerm} onChange={(e) => setCustomerSearchTerm(e.target.value)} /></div>
                <ul className="overflow-y-auto flex-1 p-1">
                  {filteredCustomers.map(c => (
                    <li key={c.id} className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer rounded" onClick={() => { setFormData({...formData, customerId: c.id}); setIsDropdownOpen(false); }}>
                      <div className="font-bold text-gray-800">{c.kindergartenName}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col space-y-1">
            <label className="text-xs font-bold text-gray-700">活動種別</label>
            <select value={formData.type} onChange={handleTypeChange} className="px-3 py-3 border border-gray-300 rounded-lg text-sm bg-gray-50 appearance-none">
              {activityTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-xs font-bold text-gray-700">結果フラグ</label>
            <select value={formData.resultFlag} onChange={handleFlagChange} className="px-3 py-3 border border-gray-300 rounded-lg text-sm bg-gray-50 appearance-none">
              <option value="">選択</option>
              {currentTypeConfig.flags.map((f, i) => <option key={i} value={f}>{f}</option>)}
            </select>
          </div>

          {formData.type === 'テレアポ' && (
            <div className="md:col-span-2 flex flex-col space-y-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <label className="text-xs font-bold text-gray-700 flex items-center"><Monitor className="w-3.5 h-3.5 mr-1"/>音声データ・関連情報</label>
              
              <div className="flex flex-col space-y-1">
                <span className="text-[10px] text-gray-500 font-bold">ファイル添付 (2MB以下)</span>
                <div className="flex items-center space-x-2">
                  <input type="file" accept="audio/*" id="mainAudioUpload" className="hidden" onChange={handleAudioUpload} />
                  <button type="button" onClick={() => document.getElementById('mainAudioUpload').click()} className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-100 flex items-center shadow-sm transition-colors">
                    <Upload className="w-4 h-4 mr-1" /> ファイルを選択
                  </button>
                  {formData.audioName && <span className="text-xs text-gray-600 truncate max-w-[200px]">{formData.audioName}</span>}
                  {formData.audioData && <button type="button" onClick={() => setFormData({...formData, audioData: '', audioName: ''})} className="p-1.5 text-red-500 hover:bg-red-100 rounded-md transition-colors"><X className="w-4 h-4"/></button>}
                </div>
                {formData.audioData && <audio src={formData.audioData} controls className="h-8 w-full max-w-sm mt-3 outline-none" />}
              </div>

              <div className="flex flex-col space-y-1">
                <span className="text-[10px] text-gray-500 font-bold">音声リンク (URL)</span>
                <input type="url" value={formData.audioLink} onChange={e => setFormData({...formData, audioLink: e.target.value})} placeholder="https://..." className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
              </div>

              <div className="flex flex-col space-y-1">
                <span className="text-[10px] text-gray-500 font-bold">音声に関するメモ</span>
                <input type="text" value={formData.audioMemo} onChange={e => setFormData({...formData, audioMemo: e.target.value})} placeholder="録音のパスワードや特記事項など" className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
              </div>
            </div>
          )}
          
          {isWaitingDateNeeded(formData.type, formData.resultFlag) && (
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-bold text-gray-700 flex items-center"><Clock className="w-3.5 h-3.5 mr-1" />予定 日付</label>
                <input type="date" value={formData.waitingDate || ''} onChange={e=>setFormData({...formData, waitingDate: e.target.value})} className="px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white" />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-bold text-gray-700 flex items-center"><Clock className="w-3.5 h-3.5 mr-1" />予定 時間</label>
                <select value={formData.waitingTime || ''} onChange={e=>setFormData({...formData, waitingTime: e.target.value})} className="px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white appearance-none cursor-pointer">
                  <option value="">選択</option>
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}

          {((formData.type === '営業' && formData.resultFlag === '受注') || (formData.type === '過去ログ登録' && formData.resultFlag === 'ユーザー')) && (
            <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-5 gap-3 mt-2 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-gray-700">商品名</label>
                <select name="productName" value={formData.productName || ''} onChange={e=>setFormData({...formData, productName: e.target.value})} className="px-2 py-2 border border-gray-300 rounded text-sm bg-white">
                  <option value="">選択</option>
                  {products && products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">月額</label><input type="number" name="monthlyFee" value={formData.monthlyFee} onChange={e=>setFormData({...formData, monthlyFee: e.target.value})} className="px-2 py-2 border border-gray-300 rounded text-sm bg-white" /></div>
              <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">回数(年数)</label><input type="number" name="years" value={formData.years} onChange={e=>setFormData({...formData, years: e.target.value})} className="px-2 py-2 border border-gray-300 rounded text-sm bg-white" /></div>
              <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">営業粗利(P)</label><input type="number" name="profit" value={formData.profit} onChange={e=>setFormData({...formData, profit: e.target.value})} className="px-2 py-2 border border-gray-300 rounded text-sm bg-white" /></div>
              <div className="flex flex-col space-y-1"><label className="text-[10px] font-bold text-gray-700">台数</label><input type="number" name="quantity" value={formData.quantity} onChange={e=>setFormData({...formData, quantity: e.target.value})} className="px-2 py-2 border border-gray-300 rounded text-sm bg-white" /></div>
            </div>
          )}

          <div className="flex flex-col space-y-1"><label className="text-xs font-bold text-gray-700">記録日付</label><input type="date" value={formData.date} onChange={e=>setFormData({...formData, date: e.target.value})} required className="px-3 py-3 border border-gray-300 rounded-lg text-sm bg-gray-50" /></div>
          <div className="flex flex-col space-y-1"><label className="text-xs font-bold text-gray-700">記録時間</label><input type="time" value={formData.time} onChange={e=>setFormData({...formData, time: e.target.value})} className="px-3 py-3 border border-gray-300 rounded-lg text-sm bg-gray-50" /></div>
        </div>

        <div className="flex flex-col space-y-1">
          <div className="flex justify-between items-end">
            <label className="text-xs font-bold text-gray-700">結果・詳細メモ</label>
            <button type="button" onClick={handleFormatMemoWithAI} disabled={isAiFormatting || !formData.memo} className="text-[10px] bg-purple-100 text-purple-700 hover:bg-purple-200 px-2 py-1 rounded flex items-center font-bold transition-colors disabled:opacity-50">
              <Sparkles className="w-3 h-3 mr-1" /> {isAiFormatting ? '整形中...' : 'AIで綺麗に整形'}
            </button>
          </div>
          <textarea value={formData.memo} onChange={e=>setFormData({...formData, memo: e.target.value})} rows={4} placeholder="メモを入力..." className="px-3 py-3 border border-gray-300 rounded-lg text-sm bg-gray-50 resize-y" />
        </div>

        {isReportEligible && selectedCustomer && reportTemplates && (
          <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
              <h3 className="text-xs font-bold text-indigo-800">報告フォーマット</h3>
              <select 
                value={selectedReportTemplateId} 
                onChange={e => setSelectedReportTemplateId(Number(e.target.value))}
                className="px-2 py-1.5 text-xs border border-indigo-300 rounded bg-white max-w-xs focus:outline-none"
              >
                {reportTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                <button type="button" onClick={handleCopyReport} className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors flex justify-center items-center"><Copy className="w-3.5 h-3.5 mr-1" />コピー</button>
                <button type="button" onClick={handleShareReport} className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors flex justify-center items-center"><Share2 className="w-3.5 h-3.5 mr-1" />共有・報告</button>
              </div>
            </div>
            <textarea readOnly value={reportText} rows={8} className="w-full p-3 border border-indigo-200 rounded-lg text-xs bg-white focus:outline-none" />
          </div>
        )}

        <div className="pt-4"><button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md text-lg hover:bg-blue-700">保存する</button></div>
      </form>
    </div>
  );
}

function EmailBuilderView({ customers, records, templates, setTemplates, showAlert }) { 
  const [viewMode, setViewMode] = useState('compose');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  
  const [draftTo, setDraftTo] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  const filteredCustomers = customers.filter(c => c.kindergartenName.includes(customerSearchTerm) || (c.schoolName && c.schoolName.includes(customerSearchTerm)));
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [manageForm, setManageForm] = useState({ name: '', subject: '', body: '' });

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setIsDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!selectedCustomerId || !selectedTemplateId) return;
    const customer = customers.find(c => c.id === selectedCustomerId);
    const template = templates.find(t => t.id === selectedTemplateId);
    if (customer && template) {
      let s = template.subject;
      let b = template.body;
      const map = { 
        '{{学園名}}': customer.schoolName || '', 
        '{{園名}}': customer.kindergartenName || '', 
        '{{理事長}}': customer.chairman || '', 
        '{{園長}}': customer.principal || '',
        '{{住所}}': customer.address || '', 
        '{{TEL}}': customer.tel || '', 
        '{{メール}}': customer.email || ''
      };
      for (const [key, val] of Object.entries(map)) { s = s.replaceAll(key, val); b = b.replaceAll(key, val); }
      setDraftTo(customer.email || ''); setDraftSubject(s); setDraftBody(b);
    }
  }, [selectedCustomerId, selectedTemplateId, customers, templates]);

  const handleCopy = (text, label) => { navigator.clipboard.writeText(text).then(() => showAlert(`${label}をコピーしました。`)); };
  const handleMailto = () => { window.location.href = `mailto:${encodeURIComponent(draftTo)}?subject=${encodeURIComponent(draftSubject)}&body=${encodeURIComponent(draftBody)}`; };

  const generateEmailWithAI = async () => {
    if (!selectedCustomerId || !aiPrompt) return;
    setIsGeneratingEmail(true);
    try {
      const customer = customers.find(c => c.id === selectedCustomerId);
      const customerRecords = records.filter(r => r.customerId === selectedCustomerId).sort((a,b) => new Date(b.date) - new Date(a.date));
      const promptText = `あなたは優秀な営業担当者です。\n以下の顧客情報と活動履歴を踏まえ、指示に従ってビジネスメールを作成してください。\n【顧客情報】\n園名: ${customer.kindergartenName}\n担当者: ${customer.chairman}\n【活動履歴】\n${customerRecords.map(r => `${r.date} [${r.type}]: ${r.memo}`).join('\n')}\n【指示】\n${aiPrompt}\n出力形式はJSON形式 {"subject": "件名", "body": "本文"}`;
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const payload = { contents: [{ parts: [{ text: promptText }] }], generationConfig: { responseMimeType: "application/json" } };
      const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
      setDraftSubject(parsed.subject || ''); setDraftBody(parsed.body || '');
      if(!draftTo && customer.email) setDraftTo(customer.email);
      showAlert('✨ AIによるメール生成が完了しました！');
    } catch(e) {
      console.error(e);
      showAlert('メール生成に失敗しました。');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleSaveTemplate = () => {
    if (!manageForm.name.trim() || !manageForm.subject.trim() || !manageForm.body.trim()) return;
    if (editingTemplateId) setTemplates(templates.map(t => t.id === editingTemplateId ? { ...t, ...manageForm } : t));
    else setTemplates([...templates, { id: Date.now(), ...manageForm }]);
    setManageForm({ name: '', subject: '', body: '' }); setEditingTemplateId(null); showAlert('保存しました。');
  };

  const deleteTemplate = (id) => { setTemplates(templates.filter(t => t.id !== id)); showAlert('削除しました。'); };

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mt-4">
      <div className="flex border-b">
        <button className={`flex-1 py-3 text-sm font-bold flex items-center justify-center transition-colors ${viewMode === 'compose' ? 'border-b-2 border-blue-600 text-blue-600 bg-blue-50' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setViewMode('compose')}><Mail className="w-4 h-4 mr-2" /> メール制作</button>
        <button className={`flex-1 py-3 text-sm font-bold flex items-center justify-center transition-colors ${viewMode === 'manage' ? 'border-b-2 border-blue-600 text-blue-600 bg-blue-50' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setViewMode('manage')}><Settings className="w-4 h-4 mr-2" /> フォーマット管理</button>
      </div>

      {viewMode === 'compose' && (
        <div className="p-4 md:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1 relative" ref={dropdownRef}>
              <label className="text-sm font-medium text-gray-700">対象法人・顧客検索</label>
              <div className="relative">
                <div className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white cursor-pointer flex justify-between items-center" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
                  <span className={selectedCustomer ? "text-gray-900 truncate pr-2 font-bold" : "text-gray-400"}>{selectedCustomer ? `${selectedCustomer.kindergartenName}` : "法人名・園名で検索..."}</span>
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                </div>
                {isDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-[300px] overflow-hidden flex flex-col">
                    <div className="p-2 border-b bg-gray-50 shrink-0">
                      <div className="relative"><input type="text" className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none" placeholder="検索..." value={customerSearchTerm} onChange={(e) => setCustomerSearchTerm(e.target.value)} onClick={(e) => e.stopPropagation()} autoFocus /><Search className="absolute left-2.5 top-2 w-4 h-4 text-gray-400" /></div>
                    </div>
                    <ul className="overflow-y-auto flex-1">
                      {filteredCustomers.map(c => (
                        <li key={c.id} className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50" onClick={() => { setSelectedCustomerId(c.id); setIsDropdownOpen(false); setCustomerSearchTerm(''); }}>
                          <div className="font-bold text-gray-800">{c.kindergartenName}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-sm font-medium text-gray-700">メールフォーマット</label>
              <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(Number(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white appearance-none">
                <option value="" disabled>フォーマットを選択してください</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-5 mt-4">
            <div className="flex flex-col space-y-2 bg-purple-50 p-4 rounded-xl border border-purple-100">
              <label className="text-sm font-bold text-purple-800 flex items-center"><Sparkles className="w-4 h-4 mr-1.5"/> AIでメール文案を生成</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="text" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="要件を入力 (例: 次回デモの打診)" className="flex-1 px-3 py-2 border border-purple-300 rounded-lg text-sm focus:outline-none" />
                <button onClick={generateEmailWithAI} disabled={isGeneratingEmail || !selectedCustomerId || !aiPrompt} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-bold text-sm flex items-center justify-center shrink-0">
                  {isGeneratingEmail ? '生成中...' : '✨ 自動生成する'}
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6 space-y-4">
            <div className="flex justify-between items-center mb-2">
               <h3 className="text-sm font-bold text-gray-700 flex items-center"><FileText className="w-4 h-4 mr-1"/>生成されたメール</h3>
               <button onClick={handleMailto} disabled={!draftTo && !draftSubject} className="flex items-center px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                   <Send className="w-3.5 h-3.5 mr-1" />メーラーを起動
               </button>
            </div>
            <div className="flex flex-col space-y-1">
              <div className="flex justify-between"><label className="text-xs font-bold text-gray-500">宛先 (To)</label><button onClick={() => handleCopy(draftTo, '宛先')} className="text-[10px] text-blue-500 hover:underline">コピー</button></div>
              <input type="email" value={draftTo} onChange={e => setDraftTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full" />
            </div>
            <div className="flex flex-col space-y-1">
              <div className="flex justify-between"><label className="text-xs font-bold text-gray-500">件名 (Subject)</label><button onClick={() => handleCopy(draftSubject, '件名')} className="text-[10px] text-blue-500 hover:underline">コピー</button></div>
              <input type="text" value={draftSubject} onChange={e => setDraftSubject(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full" />
            </div>
            <div className="flex flex-col space-y-1">
              <div className="flex justify-between"><label className="text-xs font-bold text-gray-500">本文 (Body)</label><button onClick={() => handleCopy(draftBody, '本文')} className="text-[10px] text-blue-500 hover:underline">コピー</button></div>
              <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={12} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full resize-y" />
            </div>
          </div>
        </div>
      )}

      {viewMode === 'manage' && (
        <div className="p-4 md:p-6 bg-gray-50">
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm mb-6">
            <h3 className="font-bold text-gray-700 mb-4 flex items-center"><Edit className="w-4 h-4 mr-2"/>{editingTemplateId ? 'フォーマットの編集' : '新規追加'}</h3>
            <div className="space-y-4">
              <div className="flex flex-col space-y-1"><label className="text-xs font-bold text-gray-700">名</label><input type="text" value={manageForm.name} onChange={e => setManageForm({...manageForm, name: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full" /></div>
              <div className="flex flex-col space-y-1"><label className="text-xs font-bold text-gray-700">件名</label><input type="text" value={manageForm.subject} onChange={e => setManageForm({...manageForm, subject: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full" /></div>
              <div className="flex flex-col space-y-1"><label className="text-xs font-bold text-gray-700">本文  (利用可能タグ: {'{{学園名}}, {{園名}}, {{理事長}}, {{園長}}, {{住所}}, {{TEL}}, {{メール}}'})</label><textarea value={manageForm.body} onChange={e => setManageForm({...manageForm, body: e.target.value})} rows={6} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full resize-y" /></div>
              <div className="flex justify-end space-x-2">
                {editingTemplateId && <button onClick={() => {setEditingTemplateId(null); setManageForm({name:'',subject:'',body:''});}} className="px-4 py-2 border rounded-lg text-gray-600 bg-gray-50 text-sm font-bold">キャンセル</button>}
                <button onClick={handleSaveTemplate} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold"><Save className="w-4 h-4 mr-1" /> 保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsView({ templates, setTemplates, webhookUrl, setWebhookUrl, showAlert }) { 
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [manageForm, setManageForm] = useState({ name: '', body: '' });
  const [tempUrl, setTempUrl] = useState(webhookUrl || '');

  const handleSaveTemplate = () => {
    if (!manageForm.name.trim() || !manageForm.body.trim()) return;
    if (editingTemplateId) {
      setTemplates(templates.map(t => t.id === editingTemplateId ? { ...t, ...manageForm } : t));
    } else {
      setTemplates([...templates, { id: Date.now(), ...manageForm }]);
    }
    setManageForm({ name: '', body: '' });
    setEditingTemplateId(null);
    showAlert('保存しました。');
  };

  const deleteTemplate = (id) => {
    setTemplates(templates.filter(t => t.id !== id));
    showAlert('削除しました。');
  };

  const handleSaveWebhook = () => {
    setWebhookUrl(tempUrl);
    showAlert('スプレッドシート連携のURLを保存しました。\n次回データ更新時から自動的に同期されます。');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 mt-4">
        
        {/* スプレッドシート連携設定 */}
        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-emerald-50 text-emerald-600 px-3 py-1 rounded-bl-lg text-[10px] font-bold">NEW</div>
          <h2 className="text-xl font-bold mb-4 text-gray-800 flex items-center">
            <Globe className="w-5 h-5 mr-2 text-emerald-600" />スプレッドシート自動同期設定
          </h2>
          <p className="text-sm text-gray-600 mb-5 leading-relaxed">
            Google Apps Script (GAS) を用いて作成したURLを入力すると、顧客情報や活動記録が追加・更新されるたびに、自動的にスプレッドシートへ最新データが書き出されます。
          </p>
          <div className="flex flex-col space-y-2">
            <label className="text-xs font-bold text-gray-700">GAS Webhook URL</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="url" value={tempUrl} onChange={e => setTempUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors" />
              <button onClick={handleSaveWebhook} className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-emerald-700 transition-colors whitespace-nowrap">連携設定を保存</button>
            </div>
          </div>
        </div>

        {/* 報告フォーマット管理 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-6 text-gray-800 border-b pb-2 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-blue-600" />報告フォーマット管理
          </h2>
          <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 shadow-inner mb-6">
            <div className="space-y-4">
              <div className="flex flex-col space-y-1"><label className="text-xs font-medium text-gray-700">名</label><input type="text" value={manageForm.name} onChange={e => setManageForm({...manageForm, name: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-md text-sm w-full bg-white" /></div>
              <div className="flex flex-col space-y-1"><label className="text-xs font-medium text-gray-700">本文 (利用可能タグ: {'{{学園名}}, {{園名}}, {{理事長}}, {{園長}}, {{住所}}, {{HPリンク}}, {{TEL}}, {{メール}}, {{結果}}, {{メモ}}, {{予定日時}}'})</label><textarea value={manageForm.body} onChange={e => setManageForm({...manageForm, body: e.target.value})} rows={6} className="px-3 py-2 border border-gray-300 rounded-md text-sm w-full resize-y bg-white" /></div>
              <div className="flex justify-end space-x-2 pt-2">
                <button onClick={handleSaveTemplate} className="flex items-center px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-bold shadow-sm"><Save className="w-4 h-4 mr-1" /> 保存する</button>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {templates.map(t => (
              <div key={t.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex justify-between items-start group hover:border-blue-300 transition-colors">
                <div className="flex-1 pr-4">
                  <h4 className="font-bold text-gray-800 text-sm mb-2">{t.name}</h4>
                  <p className="text-xs text-gray-500 line-clamp-3 whitespace-pre-wrap">{t.body}</p>
                </div>
                <div className="flex space-x-1 shrink-0 opacity-100 sm:opacity-50 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingTemplateId(t.id); setManageForm({name: t.name, body: t.body}); }} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-md"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => deleteTemplate(t.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-md"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}

function ProductsAndFlagsView({ products, setProducts, activityTypes, setActivityTypes, showAlert }) {
  const [newProductName, setNewProductName] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [newFlagName, setNewFlagName] = useState('');

  const handleAddProduct = (e) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    setProducts([...products, { id: Date.now(), name: newProductName.trim() }]);
    setNewProductName('');
    showAlert('商品を追加しました');
  };
  const handleDeleteProduct = (id) => setProducts(products.filter(p => p.id !== id));

  const handleAddActivityType = (e) => {
    e.preventDefault();
    if (!newTypeName.trim()) return;
    setActivityTypes([...activityTypes, { id: Date.now(), name: newTypeName.trim(), flags: [] }]);
    setNewTypeName('');
    showAlert('活動種別を追加しました');
  };
  const handleDeleteActivityType = (id) => setActivityTypes(activityTypes.filter(t => t.id !== id));

  const handleAddFlag = (typeId, e) => {
    e.preventDefault();
    if (!newFlagName.trim()) return;
    setActivityTypes(activityTypes.map(t => {
      if(t.id === typeId) {
        if(t.flags.includes(newFlagName.trim())) return t;
        return { ...t, flags: [...t.flags, newFlagName.trim()] };
      }
      return t;
    }));
    setNewFlagName('');
    setEditingTypeId(null);
    showAlert('フラグを追加しました');
  };

  const handleDeleteFlag = (typeId, flagToRemove) => {
    setActivityTypes(activityTypes.map(t => {
      if(t.id === typeId) return { ...t, flags: t.flags.filter(f => f !== flagToRemove) };
      return t;
    }));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 mt-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold mb-6 text-gray-800 border-b pb-2 flex items-center">
          <Settings className="w-5 h-5 mr-2 text-indigo-600" />活動種別と結果フラグの管理
        </h2>
        <form onSubmit={handleAddActivityType} className="flex space-x-2 mb-6">
          <input type="text" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="新しい活動種別名 (例: ポスティング)" className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white" />
          <button type="submit" disabled={!newTypeName.trim()} className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 font-bold flex items-center shadow-sm">
            <Plus className="w-4 h-4 mr-1" />追加
          </button>
        </form>
        
        <div className="space-y-4">
          {activityTypes.map(type => (
            <div key={type.id} className="border border-gray-200 rounded-xl p-4 bg-gray-50">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-extrabold text-gray-800">{type.name}</h3>
                <button onClick={() => handleDeleteActivityType(type.id)} className="p-1.5 text-red-500 hover:bg-red-100 rounded-md"><Trash2 className="w-4 h-4" /></button>
              </div>
              
              <div className="flex flex-wrap gap-2 mb-3">
                {type.flags.length === 0 ? <span className="text-xs text-gray-400">フラグがありません</span> : (
                  type.flags.map((flag, idx) => (
                    <div key={idx} className="flex items-center bg-white border border-gray-300 rounded-full pl-3 pr-1 py-1 shadow-sm">
                      <span className="text-xs font-bold text-gray-700 mr-2">{flag}</span>
                      <button onClick={() => handleDeleteFlag(type.id, flag)} className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50"><X className="w-3 h-3" /></button>
                    </div>
                  ))
                )}
              </div>

              {editingTypeId === type.id ? (
                <form onSubmit={(e) => handleAddFlag(type.id, e)} className="flex space-x-2 mt-2">
                  <input type="text" value={newFlagName} onChange={e => setNewFlagName(e.target.value)} placeholder="新しいフラグ名..." className="flex-1 px-3 py-2 border border-indigo-300 rounded-lg text-sm bg-white" autoFocus />
                  <button type="submit" className="px-3 py-2 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-lg text-xs font-bold">保存</button>
                  <button type="button" onClick={() => {setEditingTypeId(null); setNewFlagName('');}} className="px-3 py-2 bg-white border border-gray-300 text-gray-600 rounded-lg text-xs font-bold">キャンセル</button>
                </form>
              ) : (
                <button onClick={() => {setEditingTypeId(type.id); setNewFlagName('');}} className="text-xs text-indigo-600 font-bold hover:underline flex items-center mt-2">
                  <Plus className="w-3 h-3 mr-1" />フラグを追加
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold mb-6 text-gray-800 border-b pb-2 flex items-center">
          <Package className="w-5 h-5 mr-2 text-blue-600" />商品管理
        </h2>
        <form onSubmit={handleAddProduct} className="flex space-x-2 mb-6">
          <input type="text" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="新しい商品名を入力..." className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white" />
          <button type="submit" disabled={!newProductName.trim()} className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 font-bold flex items-center shadow-sm">
            <Plus className="w-4 h-4 mr-1" />追加
          </button>
        </form>
        <ul className="border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
          {products.map(product => (
            <li key={product.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <span className="text-sm font-bold text-gray-800">{product.name}</span>
              <button onClick={() => handleDeleteProduct(product.id)} className="p-1.5 text-red-500 hover:bg-red-100 rounded-md transition-colors"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
          {products.length === 0 && <li className="p-4 text-center text-sm text-gray-400">商品が登録されていません</li>}
        </ul>
      </div>

    </div>
  );
}

function AIAssistantView({ customers, records }) {
  const [messages, setMessages] = useState([
    { role: 'model', text: 'こんにちは！AI営業アシスタントです。登録されている顧客リストや過去の活動履歴をもとに、分析や提案を行います。\n例：「今日の活動を要約して」「〇〇こども園への次回アプローチ方法を考えて」' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);

    try {
      const crmContext = `【顧客リスト】\n${customers.slice(0, 30).map(c => `${c.kindergartenName}`).join(', ')}`;
      const systemPrompt = `あなたはCRMに組み込まれた優秀な営業アシスタントAIです。\n${crmContext}`;
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const payload = { contents: [...messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: userMsg }] }], systemInstruction: { parts: [{ text: systemPrompt }] } };
      
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (aiText) setMessages(prev => [...prev, { role: 'model', text: aiText }]);
      else throw new Error("Invalid response");
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: "すみません、エラーが発生しました。" }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 border-b bg-purple-50 flex items-center shrink-0">
        <div className="bg-purple-100 p-2 rounded-full mr-3"><Bot className="w-6 h-6 text-purple-600" /></div>
        <div><h2 className="text-lg font-bold text-gray-800">AI アシスタント</h2></div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'model' && <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center mr-2 shrink-0"><Bot className="w-4 h-4 text-purple-600" /></div>}
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none'}`}>
              <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center mr-2 shrink-0"><Bot className="w-4 h-4 text-purple-600" /></div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center space-x-2"><div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-100"></div><div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-200"></div></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 bg-white border-t border-gray-200 shrink-0">
        <form onSubmit={handleSend} className="flex items-center space-x-2 relative">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="AIに質問や作業を依頼する..." className="flex-1 px-4 py-3 bg-gray-50 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 pr-12" disabled={isLoading} />
          <button type="submit" disabled={!input.trim() || isLoading} className="absolute right-2 top-1.5 p-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 disabled:opacity-50 transition-colors"><Send className="w-4 h-4" /></button>
        </form>
      </div>
    </div>
  );
}

function CustomerModal({ customer, onClose, onSave }) {
  const initialData = customer || { schoolName: "", kindergartenName: "", chairman: "", principal: "", address: "", tel: "", email: "", hpLink: "", instagramUrl: "", association: "", hpVendor: "", gbpLink: "", reviewRating: "", reviewCount: "" };
  const [formData, setFormData] = useState(initialData);

  const handleSubmit = (e) => { e.preventDefault(); onSave(formData); };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end md:items-center justify-center z-[70] md:p-4 animate-in fade-in">
      <div className="bg-white md:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-t-2xl pb-safe">
        <div className="flex justify-between items-center p-4 md:p-5 border-b shrink-0 bg-gray-50">
          <h2 className="text-lg font-bold text-gray-800">{customer ? '顧客情報の編集' : '新規顧客登録'}</h2>
          <button onClick={onClose} className="text-gray-500 bg-white p-1 rounded-full shadow-sm"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          <form id="customerForm" onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="学園名" value={formData.schoolName} onChange={e=>setFormData({...formData, schoolName: e.target.value})} />
            <FormGroup label="園名 (必須)" value={formData.kindergartenName} onChange={e=>setFormData({...formData, kindergartenName: e.target.value})} required />
            <FormGroup label="理事長" value={formData.chairman} onChange={e=>setFormData({...formData, chairman: e.target.value})} />
            <FormGroup label="園長" value={formData.principal} onChange={e=>setFormData({...formData, principal: e.target.value})} />
            <FormGroup label="TEL" value={formData.tel} onChange={e=>setFormData({...formData, tel: e.target.value})} type="tel" />
            <FormGroup label="メールアドレス" value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} type="email" />
            <FormGroup label="住所" value={formData.address} onChange={e=>setFormData({...formData, address: e.target.value})} className="md:col-span-2" />
            <FormGroup label="HPリンク" value={formData.hpLink} onChange={e=>setFormData({...formData, hpLink: e.target.value})} type="url" />
            <FormGroup label="Instagram URL" value={formData.instagramUrl} onChange={e=>setFormData({...formData, instagramUrl: e.target.value})} type="url" />
            <FormGroup label="協会関係" value={formData.association} onChange={e=>setFormData({...formData, association: e.target.value})} />
            
            <div className="col-span-1 md:col-span-2 border-t pt-4 mt-2">
              <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center"><Star className="w-4 h-4 mr-1 text-yellow-500"/> Google ビジネスプロフィール情報</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormGroup label="GBPリンク" value={formData.gbpLink} onChange={e=>setFormData({...formData, gbpLink: e.target.value})} type="url" className="md:col-span-2" />
                <FormGroup label="口コミ評価 (例: 4.5)" value={formData.reviewRating} onChange={e=>setFormData({...formData, reviewRating: e.target.value})} type="number" step="0.1" min="0" max="5" />
                <FormGroup label="口コミ数" value={formData.reviewCount} onChange={e=>setFormData({...formData, reviewCount: e.target.value})} type="number" min="0" />
              </div>
            </div>
          </form>
        </div>
        <div className="p-4 border-t bg-gray-50 flex flex-col md:flex-row justify-end space-y-2 md:space-y-0 md:space-x-3 shrink-0">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border rounded-lg text-gray-700 font-medium bg-white">キャンセル</button>
          <button type="submit" form="customerForm" className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-bold shadow-md">保存する</button>
        </div>
      </div>
    </div>
  );
}

function FormGroup({ label, value, onChange, type = "text", required = false, className = "", min, max, step }) {
  return (
    <div className={`flex flex-col space-y-1 ${className}`}>
      <label className="text-xs font-bold text-gray-700">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
      <input type={type} value={value} onChange={onChange} required={required} min={min} max={max} step={step} className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors" />
    </div>
  );
}
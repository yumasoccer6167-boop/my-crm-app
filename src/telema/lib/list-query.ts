// リストの絞り込み条件（URL の検索条件・並び順・ページ）を覚えておき、会社カルテやメニューから戻ったときに同じ条件で開く。
// ブラウザごとに保存する（閉じても残る）。保存できない環境では素の /companies に戻る
const KEY = "telema:list-query";

export function saveListQuery(query: string) {
  try {
    localStorage.setItem(KEY, query);
  } catch {
    // プライベートブラウズ等で保存できなくても動作は続ける
  }
}

/** 前回の絞り込み条件付きのリストの URL */
export function listHref(): string {
  try {
    const q = localStorage.getItem(KEY);
    return q ? `/companies?${q}` : "/companies";
  } catch {
    return "/companies";
  }
}

// 最後に開いた施設。リストに戻ったときにその行までスクロールして目印を付ける（案件リストを上から順にかけていく使い方のため）
const LAST_KEY = "telema:list-last-opened";

export function saveLastOpened(id: number) {
  try {
    localStorage.setItem(LAST_KEY, String(id));
  } catch {
    // 保存できなくても動作は続ける
  }
}

export function lastOpened(): number | null {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || null;
  } catch {
    return null;
  }
}

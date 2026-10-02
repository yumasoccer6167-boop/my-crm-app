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

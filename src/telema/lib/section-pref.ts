// 記録を入力するときの部署。最後に選んだものをブラウザごとに覚えておき、毎回選び直さなくて済むようにする。
// 保存できない環境（プライベートブラウズ等）でも動作は続ける
const KEY = "telema:last-section";

export function saveLastSection(id: number | null) {
  try {
    if (id == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(id));
  } catch {
    // 保存できなくても動作は続ける
  }
}

function lastSection(): number | null {
  try {
    return Number(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

/** 入力フォームの初期値：最後に選んだ部署（今も選べるもの）。なければ先頭の有効な部署。部署が1つもなければ null */
export function defaultSection(sections: { id: number; is_active: number }[]): number | null {
  const active = sections.filter((s) => s.is_active);
  const last = lastSection();
  if (last != null && active.some((s) => s.id === last)) return last;
  return active[0]?.id ?? null;
}

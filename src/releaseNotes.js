// アプリを更新したときのお知らせ。更新のたびに、先頭に1件足す（古いものは消さずに残す）。
//
//  id         ... お知らせの識別用（重複させない）
//  releasedAt ... 更新日時。日時はここで指定する（例: '2026-10-07T09:17:00+09:00'）。
//                 この日時になるまでは表示されないので、先の日時を入れて公開予約にもできる
//  title      ... 見出し
//  items      ... 更新内容（1項目1行。見出し＋説明を { heading, text } で書ける）
//
// 各ユーザーは、更新後に最初に開いたときだけ表示される（確認した日時は個人設定に保存）。
// あとから見返せるよう、サイドバーの「更新情報」から全件を開ける。
export const RELEASE_NOTES = [
  {
    id: '2026-10-07-telema-list-types',
    releasedAt: '2026-10-07T09:17:00+09:00',
    title: 'テレマリストを更新しました',
    items: [
      { heading: 'リスト種類', text: '施設一覧に「リスト種類」（繋がり／群私幼など）の列・絞り込み・一括割り振りを追加しました。種類は「テレマリスト」→「設定」で管理者が増やせます。' },
      { heading: '加盟協会', text: '施設の基本情報に「加盟協会」を追加しました（複数選択可）。施設一覧でも列表示・絞り込み・一括割り振りができます。協会は「設定」で追加します。' },
      { heading: '契約情報', text: '施設詳細に「契約情報」を追加しました。商材・契約日・営業担当のほか、商材のリンクとアポ担当者名も登録できます（1施設に複数件）。' },
      { heading: '過去の架電記録の編集', text: 'タイムラインの各記録から、日時・結果・話した相手・メモを直せるようになりました（記録にマウスを置くと「編集」が出ます）。' },
    ],
  },
];

const RECENT_DAYS = 30;
const MAX_SHOWN = 5;

/**
 * 今回表示するお知らせ（新しい順）。
 *  - 更新日時を過ぎたものだけが対象（未来の日時のものは公開前なので出さない）
 *  - 前回確認した更新日時（seenAt）より新しいものだけ。初めての人（seenAt なし）は、直近30日分だけ
 */
export function unseenReleaseNotes(notes, seenAt, now = new Date()) {
  const nowMs = now.getTime();
  const seenMs = seenAt ? new Date(seenAt).getTime() : null;
  const recentFrom = nowMs - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return [...notes]
    .filter((n) => new Date(n.releasedAt).getTime() <= nowMs)
    .filter((n) => {
      const t = new Date(n.releasedAt).getTime();
      return seenMs != null && !Number.isNaN(seenMs) ? t > seenMs : t >= recentFrom;
    })
    .sort((a, b) => new Date(b.releasedAt) - new Date(a.releasedAt))
    .slice(0, MAX_SHOWN);
}

/** 公開済みのお知らせ全件（新しい順）。「更新情報」から見返すとき用 */
export function publishedReleaseNotes(notes, now = new Date()) {
  return [...notes].filter((n) => new Date(n.releasedAt).getTime() <= now.getTime()).sort((a, b) => new Date(b.releasedAt) - new Date(a.releasedAt));
}

/** 2026年10月7日 09:17（日本時間で表示） */
export function formatReleasedAt(iso) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}年${get('month')}月${get('day')}日 ${get('hour')}:${get('minute')}`;
}

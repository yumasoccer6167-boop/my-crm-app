// 粗利は画面ではP（ポイント）で扱う。1万円＝1P。保存は円のまま（DB・APIは変えない）。
const YEN_PER_P = 10000;

/** 円 → 表示（例：150000 → "15P"、12345 → "1.23P"）。未入力は「—」 */
export const fmtP = (yen: number | null | undefined) => (yen == null ? "—" : `${(yen / YEN_PER_P).toLocaleString(undefined, { maximumFractionDigits: 2 })}P`);

/** 円 → 入力欄の文字列（例：150000 → "15"）。未入力は空 */
export const yenToP = (yen: number | null | undefined) => (yen == null ? "" : String(Number((yen / YEN_PER_P).toFixed(4))));

/** 入力欄のP → 円（小数も可。空は null） */
export const pToYen = (p: string) => (p.trim() === "" ? null : Math.max(0, Math.round(Number(p) * YEN_PER_P)));

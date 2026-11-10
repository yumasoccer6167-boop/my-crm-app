// 外部のグラフ用ライブラリを使わない、小さなグラフ部品（円グラフ・横棒グラフ）。色だけに頼らないよう、数値や名前は必ず横に出す。

/** 区分ごとの色（8色）。「その他」だけは灰色 */
export const PALETTE = ["#4f46e5", "#059669", "#d97706", "#0284c7", "#e11d48", "#7c3aed", "#0d9488", "#ca8a04"];
export const OTHER_COLOR = "#94a3b8";

export type Slice = { label: string; value: number };

/** 多い順に上位 max 件を残し、あとは「その他」にまとめる。0件の区分は出さない */
export function topSlices(items: Slice[], max = 7): Slice[] {
  const rows = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (rows.length <= max + 1) return rows;
  const rest = rows.slice(max).reduce((n, r) => n + r.value, 0);
  return [...rows.slice(0, max), { label: "その他", value: rest }];
}

export const sliceColor = (s: Slice, i: number) => (s.label === "その他" || s.label === "未設定" || s.label === "不明" || s.label === "課題未選択" ? OTHER_COLOR : PALETTE[i % PALETTE.length]!);

/** 円グラフ（ドーナツ）。真ん中に合計、右に凡例（名前・数・割合） */
export function Donut({ slices, unit = "件", centerLabel = "合計" }: { slices: Slice[]; unit?: string; centerLabel?: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const R = 54;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`合計 ${total.toLocaleString()}${unit}`}>
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />
          {total > 0 &&
            slices.map((s, i) => {
              const len = (s.value / total) * C;
              const el = <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={sliceColor(s, i)} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
              acc += len;
              return el;
            })}
        </g>
        <text x="70" y="66" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9 }}>
          {centerLabel}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-slate-900" style={{ fontSize: 19, fontWeight: 600 }}>
          {total.toLocaleString()}
        </text>
      </svg>
      <ul className="min-w-[10rem] flex-1 space-y-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sliceColor(s, i) }} />
            <span className="min-w-0 flex-1 truncate text-slate-700" title={s.label}>
              {s.label}
            </span>
            <span className="tabular-nums text-slate-900">
              {s.value.toLocaleString()}
              <span className="text-xs text-slate-400">{unit}</span>
            </span>
            <span className="w-12 text-right text-xs tabular-nums text-slate-500">{total ? `${((s.value / total) * 100).toFixed(1)}%` : "-"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type BarRow = { key: string; label: string; value: number; /** 薄い棒で出す「全体」（ユーザーなら、登録施設数） */ total?: number; note?: string };

/** 横棒グラフ。濃い棒＝value、薄い棒＝total（あれば）。全ての行で同じ長さの目盛り（一番大きい total か value を100%）。行を押すと選択でき（複数可）、選んだ行は枠で示す */
export function HBars({
  rows,
  valueLabel,
  totalLabel,
  selected,
  onSelect,
  color = "#4f46e5",
  labelWidth = "7rem",
  format = (n: number) => n.toLocaleString(),
}: {
  rows: BarRow[];
  valueLabel: string;
  totalLabel?: string;
  selected?: Set<string>;
  onSelect?: (key: string) => void;
  color?: string;
  labelWidth?: string;
  /** 数の出し方（粗利なら「P」つきなど） */
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.total ?? 0)));
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-4 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm" style={{ background: color }} />
          {valueLabel}
        </span>
        {totalLabel && (
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm" style={{ background: color, opacity: 0.18 }} />
            {totalLabel}
          </span>
        )}
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const on = !!selected?.has(r.key);
          const body = (
            <>
              <span className="shrink-0 truncate text-left text-sm text-slate-700" style={{ width: labelWidth }} title={r.label}>
                {r.label}
              </span>
              <span className="relative h-4 flex-1 rounded-sm bg-slate-50">
                {r.total != null && <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(r.total / max) * 100}%`, background: color, opacity: 0.18 }} />}
                <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
              </span>
              <span className="w-32 shrink-0 text-right text-sm tabular-nums text-slate-900">
                {format(r.value)}
                {r.total != null && <span className="text-xs text-slate-400"> / {format(r.total)}</span>}
                {r.note && <span className="ml-1 text-xs text-slate-500">{r.note}</span>}
              </span>
            </>
          );
          return (
            <li key={r.key}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(r.key)} aria-pressed={on} className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 ${on ? "bg-indigo-50 ring-1 ring-indigo-300" : "hover:bg-slate-50"}`}>
                  {body}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-1.5 py-0.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

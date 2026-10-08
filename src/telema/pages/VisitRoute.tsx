import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Empty, ErrorBox, Loading, selectCls } from "../components/ui";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { dayUrl, fmtTime, legUrl, planDays, type Day } from "../lib/visit-route";
import { prefOrder } from "../lib/network-layout";

// 日ごとの色（地図の線・点と日別カードの印をそろえる）
const COLORS = ["#0f766e", "#c2410c", "#2563eb", "#9333ea", "#ca8a04", "#0891b2", "#78716c", "#db2777", "#4d7c0f", "#4f46e5", "#b91c1c", "#059669"];
const color = (i: number) => COLORS[i % COLORS.length]!;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
const count = (d: Day) => d.stops.reduce((n, s) => n + 1 + s.also.length, 0);

/** ユーザーの施設を、都道府県ごとに1日数件ずつ回る初回訪問ルート */
export function VisitRoute() {
  const { data, error, reload } = useApi(() => unwrap(api["visit-targets"].$get()), []);
  const [stay, setStay] = useState(60);
  const [maxStops, setMaxStops] = useState(4);
  const [pref, setPref] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** 訪問済みにする（visited = false で戻す）。同じ場所にまとめた施設も一緒に変える */
  async function markVisited(ids: number[], visited: boolean) {
    setSaving(true);
    setSaveError(null);
    try {
      const visited_at = visited ? new Date().toISOString() : null;
      await Promise.all(ids.map((id) => unwrap(api.companies[":id"].$patch({ param: { id: String(id) }, json: { visited_at } }))));
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const byPref = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>>();
    for (const t of data ?? []) {
      const p = t.prefecture ?? "都道府県不明";
      m.set(p, [...(m.get(p) ?? []), t]);
    }
    return [...m].sort((a, b) => prefOrder(a[0]) - prefOrder(b[0]));
  }, [data]);

  const pendingCount = (list: NonNullable<typeof data>) => list.filter((t) => !t.visited_at).length;
  const cur = pref ?? byPref.slice().sort((a, b) => pendingCount(b[1]) - pendingCount(a[1]))[0]?.[0] ?? null;
  const inPref = byPref.find(([p]) => p === cur)?.[1] ?? [];
  // 訪問済みの施設はルートに入れない
  const targets = useMemo(() => inPref.filter((t) => !t.visited_at), [inPref]);
  const visited = inPref.filter((t) => t.visited_at).sort((a, b) => b.visited_at!.localeCompare(a.visited_at!));
  const days = useMemo(() => planDays(targets, { stay, maxStops }), [targets, stay, maxStops]);
  const unlocated = targets.filter((t) => t.latitude == null || t.longitude == null);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty>ユーザーの施設がまだありません（施設の詳細画面で「ユーザー」の印を付けると出ます）</Empty>;

  const located = targets.length - unlocated.length;
  const avgTravel = days.length ? Math.round(days.reduce((n, d) => n + d.travel, 0) / days.length) : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">初回訪問ルート</h1>
        <p className="text-sm text-slate-500">
          ユーザーの施設を都道府県ごとに、1日数件ずつ回れるように自動で組みます。訪問した施設は「✓
          訪問済み」でルートから外れます。移動時間は直線距離からの目安なので、出発前に「経路」のリンクで確認してください。
        </p>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {byPref.map(([p, list]) => (
          <button
            key={p}
            type="button"
            onClick={() => setPref(p)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${p === cur ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
          >
            {p} {pendingCount(list)}
            {pendingCount(list) < list.length && <span className="ml-1 opacity-70">／済{list.length - pendingCount(list)}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-1.5 text-slate-600">
          1件の滞在
          <select value={stay} onChange={(e) => setStay(Number(e.target.value))} className={selectCls}>
            {[30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m}分
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-slate-600">
          1日の上限
          <select value={maxStops} onChange={(e) => setMaxStops(Number(e.target.value))} className={selectCls}>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}件
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-x-5 text-slate-500">
          <span>
            <b className="text-lg font-semibold tabular-nums text-slate-900">{located}</b> 施設
          </span>
          <span>
            <b className="text-lg font-semibold tabular-nums text-slate-900">{days.length}</b> 日
          </span>
          <span>
            1日の移動 平均 <b className="text-lg font-semibold tabular-nums text-slate-900">{avgTravel}</b> 分
          </span>
        </div>
      </div>

      {saveError && <ErrorBox message={saveError} />}

      <div className="grid items-start gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3 lg:sticky lg:top-3">
          <Card title="地図（色＝訪問日・線は回る順番・北が上）">{days.length ? <RouteMap days={days} /> : <Empty>位置の分かる施設がありません</Empty>}</Card>
          {unlocated.length > 0 && (
            <Card title={`位置が分からない施設（${unlocated.length}）`}>
              <p className="mb-2 text-xs text-slate-500">
                住所が無いか、住所から位置を特定できなかった施設です。カルテで住所を入れると、次回の位置取得でルートに入ります。
              </p>
              <ul className="space-y-1 text-sm">
                {unlocated.map((t) => (
                  <li key={t.id}>
                    <Link to={`/companies/${t.id}`} className="text-indigo-700 hover:underline">
                      {t.company_name}
                    </Link>
                    <span className="ml-1 text-xs text-slate-500">{t.address ?? t.city ?? "住所なし"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {visited.length > 0 && (
            <Card title={`訪問済み（${visited.length}）`}>
              <p className="mb-2 text-xs text-slate-500">ルートから外しています。「戻す」でルートに入れ直します。</p>
              <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {visited.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs tabular-nums text-slate-500">{fmtDay(t.visited_at!)}</span>
                    <Link to={`/companies/${t.id}`} className="min-w-0 flex-1 truncate text-indigo-700 hover:underline">
                      {t.company_name}
                    </Link>
                    <Button size="sm" variant="ghost" disabled={saving} onClick={() => markVisited([t.id], false)}>
                      戻す
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-3">
          {days.map((d, i) => (
            <section key={d.stops[0]!.main.id} className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: color(i) }} />
                  {i + 1}日目
                </h2>
                <span className="text-sm tabular-nums text-slate-500">
                  {count(d)}件・移動 約{d.travel}分・終了 {fmtTime(d.end)}頃
                </span>
                {count(d) <= 2 && <span className="rounded-full bg-amber-50 px-2 text-xs text-amber-700 ring-1 ring-amber-200">件数少なめ</span>}
                <a href={dayUrl(d)} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-indigo-700 hover:underline">
                  この日の行程を Google マップで開く
                </a>
              </header>
              <ol className="space-y-0.5">
                {d.stops.map((s, j) => (
                  <li key={s.main.id}>
                    {j > 0 && (
                      <div className="grid grid-cols-[3.5rem_1fr] gap-2 py-1 text-xs text-slate-500">
                        <span className="ml-5 border-l-2 border-dashed border-slate-200" />
                        <span>
                          {d.legs[j - 1]!.how} 約{d.legs[j - 1]!.min}分（直線 {d.legs[j - 1]!.km.toFixed(1)}km）・
                          <a href={legUrl(d.stops[j - 1]!, s)} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline">
                            経路を見る
                          </a>
                        </span>
                      </div>
                    )}
                    {d.lunchAfter === j - 1 && (
                      <div className="grid grid-cols-[3.5rem_1fr] gap-2 pb-1 text-xs text-slate-500">
                        <span />
                        <span>昼食・移動調整 45分</span>
                      </div>
                    )}
                    <div className="grid grid-cols-[3.5rem_1fr] gap-2 py-1">
                      <span className="pt-0.5 text-sm tabular-nums text-slate-500">{fmtTime(d.times[j]!)}</span>
                      <div className="relative min-w-0 pr-24">
                        <Button
                          size="sm"
                          className="absolute right-0 top-0"
                          disabled={saving}
                          onClick={() => markVisited([s.main.id, ...s.also.map((a) => a.id)], true)}
                        >
                          ✓ 訪問済み
                        </Button>
                        <Link to={`/companies/${s.main.id}`} className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">
                          {s.main.company_name}
                        </Link>
                        {s.also.length > 0 && (
                          <span className="ml-1.5 text-xs text-slate-500">＋{s.also.map((a) => a.company_name).join("、")}（同じ場所）</span>
                        )}
                        <div className="text-xs text-slate-500">
                          {s.main.address ?? s.main.city}
                          {s.main.phone && (
                            <a href={`tel:${s.main.phone}`} className="ml-2 tabular-nums text-indigo-700 hover:underline">
                              {s.main.phone}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 施設の位置と日別ルートの略図（緯度・経度をそのまま平面に置く） */
function RouteMap({ days }: { days: Day[] }) {
  const pts = days.flatMap((d) => d.stops);
  const midLat = (Math.min(...pts.map((p) => p.lat)) + Math.max(...pts.map((p) => p.lat))) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const x0 = Math.min(...pts.map((p) => p.lng * k));
  const x1 = Math.max(...pts.map((p) => p.lng * k));
  const y0 = Math.min(...pts.map((p) => p.lat));
  const y1 = Math.max(...pts.map((p) => p.lat));
  const W = 320;
  const pad = 16;
  const s = (W - pad * 2) / Math.max(x1 - x0, y1 - y0, 0.02);
  const H = Math.max(160, (y1 - y0) * s + pad * 2);
  const X = (p: { lng: number }) => pad + (p.lng * k - x0) * s + (W - pad * 2 - (x1 - x0) * s) / 2;
  const Y = (p: { lat: number }) => pad + (y1 - p.lat) * s;
  return (
    <svg viewBox={`0 0 ${W} ${H.toFixed(0)}`} className="block h-auto w-full" role="img" aria-label="施設の位置と日別ルート">
      <rect width={W} height={H} rx={6} fill="#f8fafc" />
      {days.map((d, i) => (
        <g key={i}>
          {d.stops.length > 1 && (
            <polyline
              fill="none"
              stroke={color(i)}
              strokeWidth={2}
              strokeLinejoin="round"
              opacity={0.8}
              points={d.stops.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(" ")}
            />
          )}
          {d.stops.map((p) => (
            <circle key={p.main.id} cx={X(p)} cy={Y(p)} r={4} fill={color(i)} stroke="#fff" strokeWidth={1.5}>
              <title>{`${i + 1}日目 ${p.main.company_name}`}</title>
            </circle>
          ))}
          <text x={X(d.stops[0]!) + 6} y={Y(d.stops[0]!) - 6} fontSize={10} fontWeight={600} fill="#334155">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

import { useMemo, useState } from "react";
import type { UserAnalysis as Data } from "../types";
import { api, unwrap } from "../lib/api";
import { fmtP } from "../lib/points";
import { useApi } from "../lib/useApi";
import { PREFECTURES } from "../shared/prefectures";
import { type BarRow, Donut, HBars, topSlices } from "../components/charts";
import { type MultiOption, MultiSelect } from "../components/MultiSelect";
import { Button, Card, Empty, ErrorBox, Loading } from "../components/ui";

type Facility = Data["facilities"][number];
type Contract = Data["contracts"][number];
type Dim = "industry" | "prefecture" | "city" | "product" | "issue";
type Filters = Record<Dim, Set<string>>;
type Metric = "contracts" | "profit";

const num = (n: number) => n.toLocaleString();
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const JIS = new Map<string, number>(PREFECTURES.map((p, i) => [p, i]));
const CITY_LIMIT = 30;
const NO_ISSUE = "課題未選択";
const LAST = new Set(["未設定", "不明", NO_ISSUE]); // 空欄の区分は、並べるとき最後にする

const emptyFilters = (): Filters => ({ industry: new Set(), prefecture: new Set(), city: new Set(), product: new Set(), issue: new Set() });
const cityKey = (f: Facility) => `${f.prefecture}\t${f.city}`;
const issuesOf = (k: Contract) => (k.issues.length ? k.issues : [NO_ISSUE]);
const byCountDesc = (a: [string, number], b: [string, number]) => Number(LAST.has(a[0])) - Number(LAST.has(b[0])) || b[1] - a[1] || a[0].localeCompare(b[0], "ja");

/**
 * 絞り込みを当てはめる。業種・都道府県・市区町村は施設の条件、商材・接点は契約の条件。
 * 商材か接点を選んでいるときは、条件に合う契約がある施設だけを残す。skip を渡すと、その項目の条件だけは外して数える（その項目のグラフで、ほかの候補も出すため）
 */
function applyFilters(data: Data, f: Filters, skip?: Dim) {
  const on = (d: Dim) => d !== skip && f[d].size > 0;
  const facilities = data.facilities.filter((x) => (!on("industry") || f.industry.has(x.industry)) && (!on("prefecture") || f.prefecture.has(x.prefecture)) && (!on("city") || f.city.has(cityKey(x))));
  const ids = new Set(facilities.map((x) => x.id));
  const contracts = data.contracts.filter((k) => ids.has(k.company_id) && (!on("product") || f.product.has(k.product)) && (!on("issue") || issuesOf(k).some((i) => f.issue.has(i))));
  if (!on("product") && !on("issue")) return { facilities, contracts };
  const has = new Set(contracts.map((k) => k.company_id));
  return { facilities: facilities.filter((x) => has.has(x.id)), contracts };
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md ring-1 ring-slate-300">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={`px-2.5 py-1 text-xs font-medium ${value === o.value ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** ユーザー分析：「ユーザー」にチェックが入った施設を、業種・地域（都道府県／市区町村）・商材・接点（契約情報の課題＝ニーズ）で掛け合わせて見る */
export function UserAnalysis() {
  const { data, error, loading, reload } = useApi(() => unwrap(api["user-analysis"].$get()), []);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <Loading />;
  if (data.facilities.length === 0)
    return (
      <Card>
        <Empty>「ユーザー」にチェックが入った施設がまだありません</Empty>
      </Card>
    );
  return <Body data={data} />;
}

function Body({ data }: { data: Data }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [metric, setMetric] = useState<Metric>("contracts");
  const anyFilter = (Object.keys(filters) as Dim[]).some((d) => filters[d].size > 0);

  // 都道府県を絞ったら、その外の市区町村の選択は外す
  const withDim = (cur: Filters, d: Dim, next: Set<string>): Filters => {
    const out = { ...cur, [d]: next };
    if (d === "prefecture" && next.size > 0) out.city = new Set([...cur.city].filter((c) => next.has(c.split("\t")[0]!)));
    return out;
  };
  const setDim = (d: Dim, next: Set<string>) => setFilters((cur) => withDim(cur, d, next));
  // 続けて押しても、直前の選択が消えないよう、最新の条件から作る
  const toggle = (d: Dim) => (key: string) =>
    setFilters((cur) => {
      const next = new Set(cur[d]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return withDim(cur, d, next);
    });

  const fmt = (n: number) => (metric === "contracts" ? `${num(n)}件` : fmtP(n));
  const val = (k: Contract) => (metric === "contracts" ? 1 : (k.gross_profit ?? 0));

  // 候補（件数は全体の数）
  const options = useMemo(() => {
    const count = (xs: string[]): MultiOption[] => {
      const m = new Map<string, number>();
      xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
      return [...m.entries()].sort(byCountDesc).map(([value, c]) => ({ value, label: value, count: c }));
    };
    const scope = filters.prefecture.size ? data.facilities.filter((x) => filters.prefecture.has(x.prefecture)) : data.facilities;
    const oneRegion = filters.prefecture.size === 1;
    const cityCount = new Map<string, number>();
    scope.forEach((x) => cityCount.set(cityKey(x), (cityCount.get(cityKey(x)) ?? 0) + 1));
    const cities: MultiOption[] = [...cityCount.entries()]
      .map(([k, c]) => {
        const [pref, city] = k.split("\t") as [string, string];
        return { value: k, label: oneRegion ? city : `${pref} ${city}`, count: c };
      })
      .sort((a, b) => b.count! - a.count! || a.label.localeCompare(b.label, "ja"));
    return {
      industry: count(data.facilities.map((x) => x.industry)),
      prefecture: count(data.facilities.map((x) => x.prefecture)),
      city: cities,
      product: count(data.contracts.map((k) => k.product)),
      issue: count(data.contracts.flatMap(issuesOf)),
    };
  }, [data, filters.prefecture]);

  const full = useMemo(() => applyFilters(data, filters), [data, filters]);
  const orgs = new Set(full.facilities.map((x) => x.organization_id).filter((x) => x != null)).size;
  const profit = full.contracts.reduce((n, k) => n + (k.gross_profit ?? 0), 0);
  const contractFacilities = new Set(full.contracts.map((k) => k.company_id)).size;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">「ユーザー」にチェックが入っている施設を、業種・地域・商材・接点（契約情報の課題）で数えています。担当に関係なく全体の数です。</p>

      <Card
        title="絞り込み"
        action={
          <Button size="sm" variant="ghost" disabled={!anyFilter} onClick={() => setFilters(emptyFilters())}>
            条件をすべて外す
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MultiSelect label="業種" options={options.industry} selected={filters.industry} onChange={(s) => setDim("industry", s)} unit="施設" />
          <MultiSelect label="都道府県" options={options.prefecture} selected={filters.prefecture} onChange={(s) => setDim("prefecture", s)} unit="施設" />
          <MultiSelect label="市区町村" options={options.city} selected={filters.city} onChange={(s) => setDim("city", s)} unit="施設" />
          <MultiSelect label="商材" options={options.product} selected={filters.product} onChange={(s) => setDim("product", s)} unit="契約" />
          <MultiSelect label="接点（課題）" options={options.issue} selected={filters.issue} onChange={(s) => setDim("issue", s)} unit="契約" />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          項目ごとに複数選べます。選ばなければ、その項目では絞り込みません（「未設定」「不明」「課題未選択」も選べます）。商材か接点を選ぶと、その契約がある施設だけが対象になります。
          下のグラフは、自分の項目以外の条件で絞った数です。棒を押しても、その項目を絞り込みに足せます（もう一度押すと外れます）。
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ユーザー施設数" value={num(full.facilities.length)} note={anyFilter ? `全体 ${num(data.facilities.length)} 施設のうち` : undefined} />
        <Stat label="ユーザー法人数" value={num(orgs)} note="法人が登録された施設の法人" />
        <Stat label="契約数" value={num(full.contracts.length)} note={`契約のある施設 ${num(contractFacilities)}`} />
        <Stat label="粗利合計" value={fmtP(profit)} note="契約情報の粗利" />
      </div>

      {full.facilities.length === 0 ? (
        <Card>
          <Empty>条件に合うユーザー施設がありません。条件を外してみてください</Empty>
        </Card>
      ) : (
        <>
          <Products data={data} filters={filters} metric={metric} setMetric={setMetric} fmt={fmt} val={val} onToggle={toggle("product")} />
          <Crosstab full={full} metric={metric} fmt={fmt} val={val} />
          <Industries data={data} filters={filters} onToggle={toggle("industry")} />
          <Regions data={data} filters={filters} onTogglePref={toggle("prefecture")} onToggleCity={toggle("city")} />
          <Needs data={data} filters={filters} onToggle={toggle("issue")} />
        </>
      )}
    </div>
  );
}

/** 商材別：どの商材が売れているか（契約数／粗利）。商材以外の条件で絞った結果 */
function Products({ data, filters, metric, setMetric, fmt, val, onToggle }: { data: Data; filters: Filters; metric: Metric; setMetric: (m: Metric) => void; fmt: (n: number) => string; val: (k: Contract) => number; onToggle: (key: string) => void }) {
  const rows: BarRow[] = useMemo(() => {
    const { contracts } = applyFilters(data, filters, "product");
    const m = new Map<string, { v: number; n: number; facs: Set<number> }>();
    for (const k of contracts) {
      const r = m.get(k.product) ?? { v: 0, n: 0, facs: new Set<number>() };
      r.v += val(k);
      r.n += 1;
      r.facs.add(k.company_id);
      m.set(k.product, r);
    }
    return [...m.entries()].sort((a, b) => b[1].v - a[1].v || a[0].localeCompare(b[0], "ja")).map(([p, r]) => ({ key: p, label: p, value: r.v, note: metric === "contracts" ? `施設${num(r.facs.size)}` : `${num(r.n)}件` }));
  }, [data, filters, metric, val]);
  // 円グラフは、商材を絞り込んでいるときは選んだ商材だけで作る（棒グラフは、ほかの商材も押して足せるよう全商材を出す）
  const picked = filters.product.size > 0;
  const slices = topSlices(rows.filter((r) => !picked || filters.product.has(r.key)).map((r) => ({ label: r.label, value: r.value })));
  return (
    <Card
      title="商材別（どの商材が売れているか）"
      action={
        <Segmented
          label="数える値"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "contracts", label: "契約数" },
            { value: "profit", label: "粗利" },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <Empty>この条件に合う契約がありません</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">
              {picked ? "選んだ商材の内訳" : "商材の内訳"}（{metric === "contracts" ? "契約数" : "粗利"}）
            </h3>
            {slices.length ? <Donut slices={slices} unit={metric === "contracts" ? "件" : "円"} centerLabel={metric === "contracts" ? "契約数" : "粗利（円）"} /> : <Empty>粗利が入った契約がありません</Empty>}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">商材ごとの{metric === "contracts" ? "契約数" : "粗利"}</h3>
            <HBars rows={rows} valueLabel={metric === "contracts" ? "契約数" : "粗利"} color="#7c3aed" selected={filters.product} onSelect={onToggle} format={fmt} labelWidth="8rem" />
          </div>
        </div>
      )}
    </Card>
  );
}

const AXES: { value: Dim; label: string }[] = [
  { value: "industry", label: "業種" },
  { value: "prefecture", label: "都道府県" },
  { value: "city", label: "市区町村" },
  { value: "product", label: "商材" },
  { value: "issue", label: "接点（課題）" },
];

/** 掛け合わせ表：行と列に好きな項目を選んで、契約数（または粗利）をクロス集計する。例：都道府県 × 商材、業種 × 商材 */
function Crosstab({ full, metric, fmt, val }: { full: { facilities: Facility[]; contracts: Contract[] }; metric: Metric; fmt: (n: number) => string; val: (k: Contract) => number }) {
  const [rowAxis, setRowAxis] = useState<Dim>("prefecture");
  const [colAxis, setColAxis] = useState<Dim>("product");
  const pick = (setSelf: (d: Dim) => void, other: Dim, setOther: (d: Dim) => void) => (d: Dim) => {
    setSelf(d);
    if (d === other) setOther(AXES.find((a) => a.value !== d)!.value);
  };

  const table = useMemo(() => {
    const fac = new Map(full.facilities.map((x) => [x.id, x]));
    const keys = (k: Contract, axis: Dim): string[] => {
      const f = fac.get(k.company_id)!;
      return axis === "industry" ? [f.industry] : axis === "prefecture" ? [f.prefecture] : axis === "city" ? [`${f.prefecture} ${f.city}`] : axis === "product" ? [k.product] : issuesOf(k);
    };
    const cells: { r: string; c: string; v: number }[] = [];
    const rt = new Map<string, number>();
    const ct = new Map<string, number>();
    for (const k of full.contracts) {
      const v = val(k);
      for (const r of keys(k, rowAxis)) for (const c of keys(k, colAxis)) {
        cells.push({ r, c, v });
        rt.set(r, (rt.get(r) ?? 0) + v);
        ct.set(c, (ct.get(c) ?? 0) + v);
      }
    }
    const top = (m: Map<string, number>, n: number) => {
      const all = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).map((e) => e[0]);
      return { keep: new Set(all.slice(0, n)), list: all.length > n ? [...all.slice(0, n), "その他"] : all };
    };
    const R = top(rt, 12);
    const C = top(ct, 8);
    const grid = new Map<string, number>();
    const rowSum = new Map<string, number>();
    const colSum = new Map<string, number>();
    let max = 0;
    let total = 0;
    for (const x of cells) {
      const r = R.keep.has(x.r) ? x.r : "その他";
      const c = C.keep.has(x.c) ? x.c : "その他";
      const v = (grid.get(`${r}\t${c}`) ?? 0) + x.v;
      grid.set(`${r}\t${c}`, v);
      rowSum.set(r, (rowSum.get(r) ?? 0) + x.v);
      colSum.set(c, (colSum.get(c) ?? 0) + x.v);
      total += x.v;
      max = Math.max(max, v);
    }
    return { rows: R.list, cols: C.list, grid, max, rowSum, colSum, total, cut: rt.size > 12 || ct.size > 8 };
  }, [full, rowAxis, colAxis, val]);

  const sel = "rounded-md border-0 bg-white px-2 py-1 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500";
  return (
    <Card title="掛け合わせ表（行 × 列）">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">行</span>
          <select className={sel} value={rowAxis} onChange={(e) => pick(setRowAxis, colAxis, setColAxis)(e.target.value as Dim)}>
            {AXES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-slate-400">×</span>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">列</span>
          <select className={sel} value={colAxis} onChange={(e) => pick(setColAxis, rowAxis, setRowAxis)(e.target.value as Dim)}>
            {AXES.filter((a) => a.value !== rowAxis).map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-slate-500">
          {metric === "contracts" ? "契約数" : "粗利"}を、上の絞り込みに合う契約で数えます{table.cut ? "（多い順に行12・列8まで。残りは「その他」）" : ""}。接点は1つの契約で複数選べるため、接点を軸にすると契約が重なって数えられます。
        </span>
      </div>
      {table.rows.length === 0 ? (
        <Empty>この条件に合う契約がありません</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="sticky left-0 bg-white py-1.5 pr-3 text-left font-medium">
                  {AXES.find((a) => a.value === rowAxis)!.label} ＼ {AXES.find((a) => a.value === colAxis)!.label}
                </th>
                {table.cols.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-right font-medium">
                    {c}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right font-semibold text-slate-700">合計</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r} className="border-b border-slate-50">
                  <th className="sticky left-0 whitespace-nowrap bg-white py-1 pr-3 text-left font-normal text-slate-700">{r}</th>
                  {table.cols.map((c) => {
                    const v = table.grid.get(`${r}\t${c}`) ?? 0;
                    const a = table.max ? v / table.max : 0;
                    return (
                      <td key={c} className="px-2 py-1 text-right" style={v ? { background: `rgba(79,70,229,${0.08 + a * 0.72})`, color: a > 0.55 ? "#fff" : "#0f172a" } : undefined}>
                        {v ? fmt(v) : <span className="text-slate-300">·</span>}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right font-semibold text-slate-800">{fmt(table.rowSum.get(r) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold text-slate-800">
                <th className="sticky left-0 bg-white py-1.5 pr-3 text-left">合計</th>
                {table.cols.map((c) => (
                  <td key={c} className="px-2 py-1.5 text-right">
                    {fmt(table.colSum.get(c) ?? 0)}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right">{fmt(table.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 業種別の施設数の内訳（業種以外の条件で絞った結果） */
function Industries({ data, filters, onToggle }: { data: Data; filters: Filters; onToggle: (key: string) => void }) {
  const entries = useMemo(() => {
    const m = new Map<string, number>();
    applyFilters(data, filters, "industry").facilities.forEach((x) => m.set(x.industry, (m.get(x.industry) ?? 0) + 1));
    return [...m.entries()].sort(byCountDesc);
  }, [data, filters]);
  const total = entries.reduce((n, e) => n + e[1], 0);
  // 円グラフは、業種を絞り込んでいるときは選んだ業種だけで作る（棒グラフは、ほかの業種も押して足せるよう全業種を出す）
  const picked = filters.industry.size > 0;
  const slices = topSlices(entries.filter(([k]) => !picked || filters.industry.has(k)).map(([label, value]) => ({ label, value })));
  return (
    <Card title="業種別の施設数">
      {entries.length === 0 ? (
        <Empty>この条件に合う施設がありません</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">{picked ? "選んだ業種の内訳" : "業種の内訳"}</h3>
            {slices.length ? <Donut slices={slices} unit="施設" centerLabel="ユーザー施設" /> : <Empty>選んだ業種に当てはまる施設がありません</Empty>}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">業種ごとのユーザー施設数</h3>
            <HBars rows={entries.map(([k, v]) => ({ key: k, label: k, value: v, note: pct(v, total) }))} valueLabel="ユーザー施設" selected={filters.industry} onSelect={onToggle} labelWidth="6.5rem" />
          </div>
        </div>
      )}
    </Card>
  );
}

/** 地域別のユーザー件数：都道府県と市区町村の2段。都道府県を絞ると、その都道府県の市区町村が並ぶ */
function Regions({ data, filters, onTogglePref, onToggleCity }: { data: Data; filters: Filters; onTogglePref: (key: string) => void; onToggleCity: (key: string) => void }) {
  const [order, setOrder] = useState<"users" | "jis">("users");
  const [all, setAll] = useState(false);

  const prefs = useMemo(() => {
    const m = new Map<string, number>();
    applyFilters(data, filters, "prefecture").facilities.forEach((x) => m.set(x.prefecture, (m.get(x.prefecture) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => (order === "users" ? b[1] - a[1] : (JIS.get(a[0]) ?? 99) - (JIS.get(b[0]) ?? 99)) || a[0].localeCompare(b[0], "ja"));
  }, [data, filters, order]);
  const cities = useMemo(() => {
    const m = new Map<string, number>();
    applyFilters(data, filters, "city").facilities.forEach((x) => m.set(cityKey(x), (m.get(cityKey(x)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  }, [data, filters]);
  const oneRegion = filters.prefecture.size === 1;
  const shown = all ? cities : cities.slice(0, CITY_LIMIT);
  const label = (k: string) => {
    const [pref, city] = k.split("\t") as [string, string];
    return oneRegion ? city : `${pref} ${city}`;
  };

  return (
    <Card
      title="地域別のユーザー件数"
      action={
        <Segmented
          label="都道府県の並び順"
          value={order}
          onChange={setOrder}
          options={[
            { value: "users", label: "ユーザーが多い順" },
            { value: "jis", label: "都道府県の順" },
          ]}
        />
      }
    >
      {prefs.length === 0 ? (
        <Empty>この条件に合う施設がありません</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">都道府県別</h3>
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <HBars rows={prefs.map(([k, v]) => ({ key: k, label: k, value: v }))} valueLabel="ユーザー施設" selected={filters.prefecture} onSelect={onTogglePref} labelWidth="5.5rem" />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">
              市区町村別
              <span className="ml-1 text-slate-400">{filters.prefecture.size ? "（絞り込み中の都道府県）" : "（都道府県を絞ると、その都道府県だけが並びます）"}</span>
            </h3>
            <div className={all ? "max-h-[28rem] overflow-y-auto pr-1" : ""}>
              <HBars rows={shown.map(([k, v]) => ({ key: k, label: label(k), value: v }))} valueLabel="ユーザー施設" color="#059669" selected={filters.city} onSelect={onToggleCity} labelWidth="9rem" />
            </div>
            {cities.length > CITY_LIMIT && (
              <div className="mt-2 text-right text-xs">
                <button type="button" onClick={() => setAll(!all)} className="text-indigo-700 hover:underline">
                  {all ? `上位${CITY_LIMIT}件だけにする` : `すべて見る（${num(cities.length)}件）`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** 接点別：契約情報で選んだ「課題」（接点＝ニーズ）ごとの施設数と契約数（接点以外の条件で絞った結果） */
function Needs({ data, filters, onToggle }: { data: Data; filters: Filters; onToggle: (key: string) => void }) {
  const { items, contracts, facilities } = useMemo(() => {
    const { contracts } = applyFilters(data, filters, "issue");
    const m = new Map<string, { facs: Set<number>; n: number }>();
    for (const k of contracts)
      for (const i of issuesOf(k)) {
        const r = m.get(i) ?? { facs: new Set<number>(), n: 0 };
        r.facs.add(k.company_id);
        r.n += 1;
        m.set(i, r);
      }
    const items = [...m.entries()]
      .map(([issue, r]) => ({ issue, company_count: r.facs.size, contract_count: r.n }))
      .sort((a, b) => Number(LAST.has(a.issue)) - Number(LAST.has(b.issue)) || b.company_count - a.company_count || b.contract_count - a.contract_count || a.issue.localeCompare(b.issue, "ja"));
    return { items, contracts: contracts.length, facilities: new Set(contracts.map((k) => k.company_id)).size };
  }, [data, filters]);
  // 円グラフは、接点を絞り込んでいるときは選んだ課題だけで作る（棒グラフは、ほかの課題も押して足せるよう全課題を出す）
  const picked = filters.issue.size > 0;
  const slices = topSlices(items.filter((i) => !picked || filters.issue.has(i.issue)).map((i) => ({ label: i.issue, value: i.company_count })));
  return (
    <Card title="接点別（契約情報の課題）">
      {items.length === 0 ? (
        <Empty>この条件に合う契約がありません。契約情報で「課題」を選ぶと、ここに集計されます</Empty>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            接点＝ニーズとして、契約情報で選んだ課題ごとに数えています。1つの契約で複数の課題を選べるため、課題ごとの数を足すと合計より多くなります。対象は、ユーザー施設の契約（施設 {num(facilities)}・契約 {num(contracts)} 件）です。
          </p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium text-slate-500">{picked ? "選んだ課題ごとの施設数の内訳" : "課題ごとの施設数の内訳"}</h3>
              {slices.length ? <Donut slices={slices} unit="施設" centerLabel="課題の選択数" /> : <Empty>選んだ課題に当てはまる契約がありません</Empty>}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-slate-500">課題ごとの施設数と契約数</h3>
              <HBars rows={items.map((i) => ({ key: i.issue, label: i.issue, value: i.company_count, total: i.contract_count }))} valueLabel="施設数" totalLabel="契約数" color="#d97706" selected={filters.issue} onSelect={onToggle} labelWidth="7.5rem" />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

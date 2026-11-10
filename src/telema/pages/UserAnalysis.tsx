import { useMemo, useState } from "react";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { PREFECTURES } from "../shared/prefectures";
import { type BarRow, Donut, HBars, topSlices } from "../components/charts";
import { Card, Empty, ErrorBox, Loading } from "../components/ui";

const num = (n: number) => n.toLocaleString();
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const JIS = new Map<string, number>(PREFECTURES.map((p, i) => [p, i]));
const CITY_LIMIT = 30;

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

/** ユーザー分析：「ユーザー」の印が付いた施設を、業種別・地域別（都道府県／市区町村）・接点別（契約情報の課題＝ニーズ）で見る */
export function UserAnalysis() {
  const { data, error, loading, reload } = useApi(() => unwrap(api["user-analysis"].$get()), []);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <Loading />;
  const t = data.totals;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">テレマリストに登録された施設のうち、「ユーザー」の印が付いた施設を、業種・地域・契約情報の課題で数えています。担当に関係なく全体の数です。</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="登録施設数" value={num(t.facility_count)} />
        <Stat label="ユーザー施設数" value={num(t.user_facility_count)} />
        <Stat label="ユーザー率（施設）" value={pct(t.user_facility_count, t.facility_count)} note="ユーザー施設 ÷ 登録施設" />
        <Stat label="ユーザー法人数" value={num(t.user_organization_count)} note={`法人が登録された施設の法人 ${num(t.organization_count)} のうち`} />
      </div>
      <Industries data={data.industries} />
      <Regions prefectures={data.prefectures} cities={data.cities} />
      <Needs needs={data.needs} />
    </div>
  );
}

/** 業種別の施設数の内訳 */
function Industries({ data }: { data: { industry: string; count: number; user_count: number }[] }) {
  const [basis, setBasis] = useState<"all" | "user">("all");
  const value = (i: { count: number; user_count: number }) => (basis === "all" ? i.count : i.user_count);
  const slices = useMemo(() => topSlices(data.map((i) => ({ label: i.industry, value: value(i) }))), [data, basis]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows: BarRow[] = [...data]
    .filter((i) => i.count > 0)
    .sort((a, b) => (a.industry === "未設定" ? 1 : b.industry === "未設定" ? -1 : value(b) - value(a)))
    .map((i) => ({ key: i.industry, label: i.industry, value: i.user_count, total: i.count, note: pct(i.user_count, i.count) }));
  return (
    <Card
      title="業種別の施設数"
      action={
        <Segmented
          label="数える施設"
          value={basis}
          onChange={setBasis}
          options={[
            { value: "all", label: "登録施設すべて" },
            { value: "user", label: "ユーザーのみ" },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <Empty>登録されている施設はありません</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">{basis === "all" ? "登録施設の業種の内訳" : "ユーザー施設の業種の内訳"}</h3>
            {slices.length ? <Donut slices={slices} unit="施設" centerLabel={basis === "all" ? "登録施設" : "ユーザー施設"} /> : <Empty>ユーザーの施設がまだありません</Empty>}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">業種ごとのユーザー施設数（右端は、その業種の施設に占めるユーザーの割合）</h3>
            <HBars rows={rows} valueLabel="ユーザー施設" totalLabel="登録施設" labelWidth="6.5rem" />
          </div>
        </div>
      )}
    </Card>
  );
}

/** 地域別のユーザー件数：都道府県と、選んだ都道府県の市区町村の2段 */
function Regions({ prefectures, cities }: { prefectures: { prefecture: string; total: number; users: number }[]; cities: { prefecture: string; city: string; total: number; users: number }[] }) {
  const [order, setOrder] = useState<"users" | "jis">("users");
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const prefRows = useMemo(() => {
    const rows = prefectures.filter((p) => p.users > 0 || order === "jis");
    return rows.sort((a, b) => (order === "users" ? b.users - a.users || b.total - a.total : (JIS.get(a.prefecture) ?? 99) - (JIS.get(b.prefecture) ?? 99)));
  }, [prefectures, order]);
  // 何も選んでいなければ、ユーザーが一番多い都道府県を出す
  const current = picked && prefectures.some((p) => p.prefecture === picked) ? picked : ([...prefectures].sort((a, b) => b.users - a.users || b.total - a.total)[0]?.prefecture ?? null);
  const cityRows = useMemo(() => cities.filter((c) => c.prefecture === current && c.users > 0).sort((a, b) => b.users - a.users || b.total - a.total), [cities, current]);
  const cityNoUser = cities.filter((c) => c.prefecture === current && c.users === 0).length;
  const shown = all ? cityRows : cityRows.slice(0, CITY_LIMIT);
  const userTotal = prefectures.reduce((n, p) => n + p.users, 0);
  const curPref = prefectures.find((p) => p.prefecture === current);

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
      {userTotal === 0 && prefectures.length === 0 ? (
        <Empty>登録されている施設はありません</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">都道府県別（行を押すと、右に市区町村が出ます）</h3>
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <HBars
                rows={prefRows.map((p) => ({ key: p.prefecture, label: p.prefecture, value: p.users, total: p.total }))}
                valueLabel="ユーザー施設"
                totalLabel="登録施設"
                selected={current}
                onSelect={(k) => {
                  setPicked(k);
                  setAll(false);
                }}
                labelWidth="5.5rem"
              />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500">
              {current ?? "—"}の市区町村別
              {curPref && <span className="ml-1 text-slate-400">（ユーザー {num(curPref.users)} 施設 ／ 登録 {num(curPref.total)} 施設）</span>}
            </h3>
            {cityRows.length === 0 ? (
              <Empty>この都道府県にユーザーの施設はまだありません</Empty>
            ) : (
              <div className={all ? "max-h-[28rem] overflow-y-auto pr-1" : ""}>
                <HBars rows={shown.map((c) => ({ key: c.city, label: c.city, value: c.users, total: c.total }))} valueLabel="ユーザー施設" totalLabel="登録施設" color="#059669" labelWidth="7rem" />
              </div>
            )}
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>{cityNoUser > 0 && `ユーザーがいない市区町村 ${num(cityNoUser)} 件は省いています`}</span>
              {cityRows.length > CITY_LIMIT && (
                <button type="button" onClick={() => setAll(!all)} className="text-indigo-700 hover:underline">
                  {all ? `上位${CITY_LIMIT}件だけにする` : `すべて見る（${num(cityRows.length)}件）`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** 接点別：契約情報で選んだ「課題」（接点＝ニーズ）ごとの施設数と契約数 */
function Needs({ needs }: { needs: { items: { issue: string; company_count: number; contract_count: number }[]; contract_count: number; company_count: number } }) {
  const slices = topSlices(needs.items.map((i) => ({ label: i.issue, value: i.company_count })));
  return (
    <Card title="接点別（契約情報の課題）">
      {needs.items.length === 0 ? (
        <Empty>契約情報がまだありません。契約情報で「課題」を選ぶと、ここに集計されます</Empty>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            接点＝ニーズとして、契約情報で選んだ課題ごとに数えています。1つの契約で複数の課題を選べるため、課題ごとの数を足すと合計より多くなります。契約のある施設 {num(needs.company_count)}・契約 {num(needs.contract_count)} 件。
          </p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium text-slate-500">課題ごとの施設数の内訳</h3>
              <Donut slices={slices} unit="施設" centerLabel="課題の選択数" />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-slate-500">課題ごとの施設数と契約数</h3>
              <HBars
                rows={needs.items.map((i) => ({ key: i.issue, label: i.issue, value: i.company_count, total: i.contract_count, note: undefined }))}
                valueLabel="施設数"
                totalLabel="契約数"
                color="#d97706"
                labelWidth="7.5rem"
              />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

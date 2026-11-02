import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";
import { Button, Card, ErrorBox, Loading, selectCls } from "../components/ui";

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** 日報：決まったフォーマット（累計稼働・営業予算・実数・達成率・営業件数・受注・営業落ち率・翌アポ）の数値を、記録から自動で入れる。貼る前に直してもよい */
export function DailyReport() {
  const { me, users } = useMasters();
  const [params] = useSearchParams();
  const [date, setDate] = useState(params.get("date") ?? todayJst());
  const [ids, setIds] = useState<number[] | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [label, setLabel] = useState("最終");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<"ok" | "ng" | null>(null);
  const isSales = me.role === "sales";
  const members = users.filter((u) => u.is_active);
  const { data, error, loading, reload } = useApi(
    () => unwrap(api["daily-report"].$get({ query: { date, user_ids: isSales ? undefined : ids?.join(","), dept: dept ?? undefined, label } })),
    [date, ids?.join(","), dept, label],
  );
  const chosen = ids ?? data?.user_ids ?? [me.id];
  const toggle = (id: number) => setIds(chosen.includes(id) ? (chosen.length > 1 ? chosen.filter((x) => x !== id) : chosen) : [...chosen, id]);
  useEffect(() => {
    if (data) setText(data.text);
    setCopied(null);
  }, [data]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("ng");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        営業結果・契約情報・数値分析の目標・カレンダーから、日報の数値を自動で入れます。対象のメンバーは、最初は自分と同じ部署のメンバーです（選び直せます）。内容を直してから、コピーして貼り付けられます。
      </p>
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
            ‹
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={selectCls} aria-label="日報の日付" />
          <button type="button" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => setDate(addDays(date, 1))} aria-label="次の日">
            ›
          </button>
          <button type="button" className="rounded px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50" onClick={() => setDate(todayJst())}>
            今日
          </button>
          <input value={dept ?? data?.department ?? ""} onChange={(e) => setDept(e.target.value)} placeholder="部署名" maxLength={50} className={`${selectCls} w-32`} aria-label="日報の部署名" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="区分" maxLength={20} className={`${selectCls} w-20`} aria-label="日報の区分（最終など）" />
        </div>
        {!isSales && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">対象メンバー：</span>
            {members.map((u) => (
              <button
                key={u.id}
                type="button"
                aria-pressed={chosen.includes(u.id)}
                onClick={() => toggle(u.id)}
                className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${chosen.includes(u.id) ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"}`}
              >
                {u.name}
              </button>
            ))}
          </div>
        )}
      </Card>
      <Card
        title="日報"
        action={
          <span className="flex items-center gap-2">
            {copied === "ok" && <span className="text-xs text-emerald-700">コピーしました</span>}
            {copied === "ng" && <span className="text-xs text-rose-700">コピーできませんでした。文章を選んでコピーしてください</span>}
            <Button size="sm" disabled={!text} onClick={() => data && setText(data.text)}>
              自動作成に戻す
            </Button>
            <Button size="sm" variant="primary" disabled={!text} onClick={copy}>
              コピー
            </Button>
          </span>
        }
      >
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : (
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={24} className="w-full rounded-md border-0 px-3 py-2 font-mono text-sm leading-relaxed ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500" aria-label="日報の文章" />
        )}
      </Card>
    </div>
  );
}

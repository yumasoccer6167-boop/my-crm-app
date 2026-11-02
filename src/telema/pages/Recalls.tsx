import { useState } from "react";
import { Link } from "react-router";
import type { RecallItem, RecallRange } from "../types";
import { api, unwrap } from "../lib/api";
import { fmtShort } from "../lib/format";
import { useMasters } from "../lib/masters";
import { markScheduleDone } from "../lib/schedule";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox, Loading, selectCls } from "../components/ui";

const RANGES: { value: RecallRange; label: string; count: "total" | "overdue" | "today" | "week" }[] = [
  { value: "all", label: "すべて", count: "total" },
  { value: "overdue", label: "期限超過", count: "overdue" },
  { value: "today", label: "今日", count: "today" },
  { value: "week", label: "今週まで（期限超過を含む）", count: "week" },
];

/** 再コール：次回架電が入っている施設を日時順に一覧する。担当の施設の分（マネージャー・管理者は担当者を選べる）。「対応済み」にすると次回架電が空になる */
export function Recalls() {
  const { me, users } = useMasters();
  const isSales = me.role === "sales";
  const members = users.filter((u) => u.is_active);
  const [range, setRange] = useState<RecallRange>("all");
  const [who, setWho] = useState(String(me.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi(() => unwrap(api.recalls.$get({ query: { range, user_id: isSales ? undefined : who } })), [range, who]);

  async function done(item: RecallItem) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await markScheduleDone([{ kind: "recall", id: item.id }]);
      if (r.skipped > 0) setMessage("担当外などのため、対応済みにできませんでした");
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        次回架電が入っている施設の一覧です。カルテで次回架電を入れる・直すと、ここに反映されます。{isSales ? "自分の担当の分を表示しています。" : "担当者を選んで見られます。"}
      </p>
      <Card
        title="再コール"
        action={
          !isSales && (
            <select value={who} onChange={(e) => setWho(e.target.value)} className={selectCls} aria-label="再コールを見る担当者">
              <option value="all">全員</option>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RANGES.map((r) => {
            const n = data?.counts[r.count];
            const active = range === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                aria-pressed={active}
                className={`rounded-lg px-3 py-2.5 text-left ring-1 ring-inset ${active ? "bg-indigo-50 ring-indigo-300" : "bg-slate-50 ring-slate-200 hover:bg-slate-100"}`}
              >
                <div className="text-xs text-slate-500">{r.label}</div>
                <div className={`mt-0.5 text-xl font-semibold tabular-nums ${r.value === "overdue" && n ? "text-rose-700" : "text-slate-900"}`}>{n ?? "—"}</div>
              </button>
            );
          })}
        </div>
        {message && <div className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{message}</div>}
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>該当する再コールはありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-2 py-2 font-medium">次回架電</th>
                  <th className="px-2 py-2 font-medium">施設</th>
                  <th className="px-2 py-2 font-medium">先方担当者</th>
                  <th className="px-2 py-2 font-medium">次回アクション</th>
                  <th className="px-2 py-2 font-medium">電話</th>
                  {data.user_id == null && <th className="px-2 py-2 font-medium">担当営業</th>}
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className={`font-semibold tabular-nums ${i.overdue ? "text-rose-600" : "text-slate-900"}`}>{fmtShort(i.at)}</span>
                      {i.overdue && <span className="ml-1.5 rounded bg-rose-50 px-1.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">期限超過</span>}
                    </td>
                    <td className="px-2 py-2">
                      <Link to={`/companies/${i.id}`} className="font-medium text-indigo-700 hover:underline">
                        {i.company_name}
                      </Link>
                      {!!i.is_user && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
                      {i.status_label && <div className="text-xs text-slate-500">{i.status_label}</div>}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{i.contact_name ?? <span className="text-slate-300">—</span>}</td>
                    <td className="max-w-xs px-2 py-2 text-slate-700">{i.next_action ?? <span className="text-slate-300">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">{i.phone ?? <span className="text-slate-300">—</span>}</td>
                    {data.user_id == null && <td className="px-2 py-2 text-slate-700">{i.assigned_user_name ?? <span className="text-slate-300">未割当</span>}</td>}
                    <td className="px-2 py-2 text-right">
                      <Button size="sm" disabled={busy} onClick={() => done(i)}>
                        対応済み
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

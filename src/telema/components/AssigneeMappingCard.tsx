import { useState } from "react";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox, Loading, selectCls } from "./ui";

const norm = (s: string) => s.replace(/[\s　]/g, "");

/** 管理者専用：取り込んだ元データの「担当者」列（自社営業）をメンバーに割り振る */
export function AssigneeMappingCard() {
  const { users } = useMasters();
  const { data, error, loading, reload } = useApi(() => unwrap(api.admin["assignee-mapping"].$get()), []);
  // 手で選んだ値。未選択の行は名前が一致するメンバーを候補にする（"" = 割り当てない）
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const active = users.filter((u) => u.is_active);
  const byName = new Map(active.map((u) => [norm(u.name), u.id]));
  const items = data?.items ?? [];
  const selected = (name: string) => picked[name] ?? String(byName.get(norm(name)) ?? "");
  const unmatched = items.filter((i) => !byName.has(norm(i.name)));
  const plan = items.filter((i) => selected(i.name) && i.unassigned > 0);
  const planCount = plan.reduce((n, i) => n + i.unassigned, 0);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const apply = () => {
    if (!confirm(`未割当の ${planCount.toLocaleString()} 施設に担当を割り当てます。既に担当がいる施設は変更しません。よろしいですか？`)) return;
    void run(async () => {
      const r = await unwrap(
        api.admin["assignee-mapping"].$post({ json: { mappings: plan.map((i) => ({ name: i.name, user_id: Number(selected(i.name)) })) } }),
      );
      reload();
      return `${r.updated.toLocaleString()} 施設に担当を割り当てました`;
    });
  };

  return (
    <Card title={`担当者の割り振り（元データの「${data?.column ?? "担当者"}」列 → メンバー）`}>
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data || (loading && !data) ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>元データに担当者名のある施設はありません</Empty>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">
            名前が一致するメンバーを自動で選んでいます。割り当てるのは担当が未設定の施設だけで、既に担当がいる施設は変わりません。
          </p>
          {err && <ErrorBox message={err} />}
          {msg && <p className="rounded-md bg-emerald-50 p-2 text-emerald-800 ring-1 ring-emerald-200">{msg}</p>}
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-white text-slate-500">
                <tr className="border-b border-slate-200 text-right">
                  <th className="py-1.5 text-left font-medium">元データの担当者名</th>
                  <th className="py-1.5 font-medium">施設数</th>
                  <th className="py-1.5 font-medium">うち未割当</th>
                  <th className="py-1.5 pl-3 text-left font-medium">割り当てるメンバー</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => (
                  <tr key={i.name} className={i.unassigned === 0 ? "opacity-50" : ""}>
                    <td className="py-1">{i.name}</td>
                    <td className="py-1 text-right">{i.total.toLocaleString()}</td>
                    <td className="py-1 text-right">{i.unassigned.toLocaleString()}</td>
                    <td className="py-1 pl-3">
                      <select
                        className={`${selectCls} py-0.5 text-xs`}
                        value={selected(i.name)}
                        disabled={i.unassigned === 0}
                        onChange={(e) => setPicked({ ...picked, [i.name]: e.target.value })}
                      >
                        <option value="">（割り当てない）</option>
                        {active.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {unmatched.length > 0 && (
              <span className="text-xs text-slate-500">メンバーにいない {unmatched.length} 名は、CRM の「設定・管理」でメンバーを追加すると選べます</span>
            )}
            <Button variant="primary" disabled={busy || planCount === 0} onClick={apply}>
              {planCount.toLocaleString()} 施設に割り当てる
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

import { useState } from "react";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Card, Empty, ErrorBox, Loading, selectCls } from "./ui";

const FEATURE_LABEL: Record<string, string> = {
  call_analysis: "架電メモ整理",
  karte_update: "カルテ更新提案",
  next_action: "次回アクション提案",
  column_mapping: "列の自動認識",
};

function thisMonth() {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 7);
}

/** 管理者専用：AIの利用回数と概算料金（APIも admin 以外は 403） */
export function AIUsageCard() {
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading, reload } = useApi(() => unwrap(api.admin["ai-usage"].$get({ query: { month } })), [month]);

  const yen = (usd: number) => `約${Math.round(usd * (data?.usd_jpy ?? 150)).toLocaleString()}円`;
  const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
  const maxDay = Math.max(0.000001, ...(data?.by_day.map((d) => d.cost_usd) ?? [0]));

  return (
    <Card
      title="AI利用料（管理者のみ表示）"
      action={<input type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} className={`${selectCls} py-0.5 text-xs`} />}
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data || (loading && !data) ? (
        <Loading />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">今月の概算料金</div>
              <div className="text-xl font-semibold tabular-nums">{yen(data.total.cost_usd)}</div>
              <div className="text-xs text-slate-500 tabular-nums">{usd(data.total.cost_usd)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">利用回数</div>
              <div className="text-xl font-semibold tabular-nums">{data.total.calls.toLocaleString()}回</div>
              {!!data.total.errors && <div className="text-xs text-amber-700">うち失敗 {data.total.errors}回</div>}
            </div>
            <div>
              <div className="text-xs text-slate-500">トークン（入力 / 出力）</div>
              <div className="tabular-nums">
                {data.total.input_tokens.toLocaleString()} / {data.total.output_tokens.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">月間上限</div>
              {data.budget_usd > 0 ? (
                <>
                  <div className="tabular-nums">
                    {usd(data.budget_usd)}（{yen(data.budget_usd)}）
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100">
                    <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (data.total.cost_usd / data.budget_usd) * 100)}%` }} />
                  </div>
                </>
              ) : (
                <div>上限なし</div>
              )}
            </div>
          </div>

          <div className="text-xs text-slate-500">
            {data.provider} / {data.model}・料金は公式単価からの概算（1ドル={data.usd_jpy}円で換算）。正確な請求額は各社の請求画面で確認してください。
          </div>

          {data.total.calls === 0 ? (
            <Empty>この月のAI利用はありません</Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">日別</div>
                <ul className="space-y-1">
                  {data.by_day.map((d) => (
                    <li key={d.day} className="grid grid-cols-[3.5rem_1fr_5rem] items-center gap-2 text-xs tabular-nums">
                      <span className="text-slate-500">{d.day.slice(5)}</span>
                      <span className="h-2 rounded bg-indigo-400" style={{ width: `${Math.max(2, (d.cost_usd / maxDay) * 100)}%` }} />
                      <span className="text-right">{yen(d.cost_usd)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">ユーザー別</div>
                <ul className="space-y-1 text-xs">
                  {data.by_user.map((u) => (
                    <li key={u.name} className="flex justify-between tabular-nums">
                      <span>{u.name}</span>
                      <span>
                        {u.calls}回・{yen(u.cost_usd)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">機能別</div>
                <ul className="space-y-1 text-xs">
                  {data.by_feature.map((f) => (
                    <li key={f.feature} className="flex justify-between tabular-nums">
                      <span>{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                      <span>
                        {f.calls}回・{yen(f.cost_usd)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {data.recent_errors.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-700">最近のエラー（{data.recent_errors.length}件）</summary>
              <ul className="mt-1 space-y-0.5 text-slate-600">
                {data.recent_errors.map((e, i) => (
                  <li key={i}>
                    {e.created_at.slice(0, 16).replace("T", " ")} {FEATURE_LABEL[e.feature] ?? e.feature}：{e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

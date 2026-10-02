import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { STATUS_CATEGORIES, TEMPERATURES } from "../shared/constants";
import { CompanyTable } from "../components/CompanyTable";
import { Button, Card, Empty, ErrorBox, inputCls, Loading, selectCls } from "../components/ui";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";
import { PREFECTURES } from "../shared/prefectures";
import { useApi } from "../lib/useApi";

const FILTER_KEYS = ["q", "source_id", "user", "category", "status_id", "industry", "prefecture", "city", "assigned", "temperature", "next_call", "rating_min", "reviews_min", "sort", "order", "page"] as const;

const SORT_OPTIONS = [
  { value: "next_call_at:asc", label: "次回架電が近い順" },
  { value: "last_called_at:desc", label: "最終架電が新しい順" },
  { value: "last_called_at:asc", label: "最終架電が古い順" },
  { value: "company_name:asc", label: "会社名順" },
  { value: "temperature:desc", label: "温度感が高い順" },
  { value: "updated_at:desc", label: "更新が新しい順" },
  { value: "google_rating:desc", label: "口コミ評価が高い順" },
  { value: "google_review_count:desc", label: "口コミ数が多い順" },
];

export function Companies() {
  const { statuses, users, me } = useMasters();
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(FILTER_KEYS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : []))) as Record<string, string>;
  const [q, setQ] = useState(query.q ?? "");

  // 検索語は入力が止まってから反映
  useEffect(() => {
    const t = setTimeout(() => {
      if ((query.q ?? "") !== q) update({ q: q || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const key = params.toString();
  // ページ送り・並び替えでは件数が変わらないので、前回の件数を使い回してサーバーでの全件カウントを省く
  const filterKey = FILTER_KEYS.filter((k) => !["sort", "order", "page"].includes(k)).map((k) => `${k}=${query[k] ?? ""}`).join("&");
  const lastTotal = useRef<{ filterKey: string; total: number } | null>(null);
  const knownTotal = lastTotal.current?.filterKey === filterKey ? lastTotal.current.total : null;
  const { data, error, loading, reload } = useApi(async () => {
    const r = await unwrap(api.companies.$get({ query: knownTotal == null ? query : { ...query, skip_count: "1" } }));
    if (r.total != null) lastTotal.current = { filterKey, total: r.total };
    return r;
  }, [key]);
  const total = data?.total ?? knownTotal;
  // 一括割当・一括削除用の選択。ページをまたいで保持し、絞り込み条件が変わったら外す
  const canAssign = me.role !== "sales";
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => setSelected(new Set()), [filterKey]);
  const facets = useApi(() => unwrap(api.companies.facets.$get({ query: { prefecture: query.prefecture } })), [query.prefecture ?? ""]);
  const sources = useApi(() => unwrap(api["list-sources"].$get()), []);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  const sel = (k: string) => ({
    value: query[k] ?? "",
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => update({ [k]: e.target.value || undefined }),
    className: selectCls,
  });

  const page = Number(query.page ?? 1);
  const pages = data && total != null ? Math.max(1, Math.ceil(total / data.per_page)) : 1;
  const activeFilters = FILTER_KEYS.filter((k) => !["sort", "order", "page"].includes(k) && query[k]).length;

  return (
    <div className="space-y-4">
      {/* 区分タブ */}
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {[{ value: "", label: "すべて" }, ...STATUS_CATEGORIES].map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => update({ category: c.value || undefined, status_id: undefined })}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${(query.category ?? "") === c.value ? "bg-indigo-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="会社名・電話番号・担当者・住所で検索"
            className={`${inputCls} min-w-60 flex-1`}
          />
          <select {...sel("source_id")}>
            <option value="">取得元（すべて）</option>
            {sources.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.company_count}）
              </option>
            ))}
          </select>
          <select {...sel("user")}>
            <option value="">ユーザー／それ以外</option>
            <option value="1">ユーザーのみ</option>
            <option value="0">ユーザー以外</option>
          </select>
          <select {...sel("status_id")}>
            <option value="">ステータス</option>
            {statuses
              .filter((s) => s.is_active && (!query.category || s.category === query.category))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
          <select {...sel("next_call")}>
            <option value="">次回架電</option>
            <option value="today">今日まで</option>
            <option value="overdue">期限超過</option>
            <option value="week">1週間以内</option>
            <option value="none">未設定</option>
          </select>
          <select {...sel("temperature")}>
            <option value="">温度感</option>
            {TEMPERATURES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select {...sel("rating_min")}>
            <option value="">口コミ評価</option>
            <option value="4.5">★4.5以上</option>
            <option value="4">★4.0以上</option>
            <option value="3.5">★3.5以上</option>
            <option value="3">★3.0以上</option>
          </select>
          <select {...sel("reviews_min")}>
            <option value="">口コミ数</option>
            <option value="100">100件以上</option>
            <option value="50">50件以上</option>
            <option value="10">10件以上</option>
            <option value="1">1件以上</option>
          </select>
          <select {...sel("industry")}>
            <option value="">業種</option>
            {facets.data?.industries.map((f) => (
              <option key={f.value} value={f.value}>
                {f.value}（{f.n}）
              </option>
            ))}
          </select>
          <select value={query.prefecture ?? ""} onChange={(e) => update({ prefecture: e.target.value || undefined, city: undefined })} className={selectCls}>
            <option value="">都道府県</option>
            {[...(facets.data?.prefectures ?? [])]
              .sort((a, b) => PREFECTURES.indexOf(a.value as never) - PREFECTURES.indexOf(b.value as never))
              .map((f) => (
                <option key={f.value} value={f.value}>
                  {f.value}（{f.n}）
                </option>
              ))}
          </select>
          <select {...sel("city")}>
            <option value="">市区町村</option>
            {facets.data?.cities.map((f) => (
              <option key={f.value} value={f.value}>
                {f.value}（{f.n}）
              </option>
            ))}
          </select>
          <select {...sel("assigned")}>
            <option value="">営業担当</option>
            <option value="me">自分</option>
            <option value="none">未割当</option>
            {me.role !== "sales" &&
              users
                .filter((u) => u.is_active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
          </select>
          <select
            value={`${query.sort ?? "next_call_at"}:${query.order ?? "asc"}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(":");
              update({ sort, order });
            }}
            className={selectCls}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              条件をクリア
            </Button>
          )}
        </div>
      </Card>

      <Card
        title={
          <>
            {total != null ? `${total.toLocaleString()}件` : "…"}
            {loading && data && <span className="ml-2 text-xs font-normal text-slate-400">更新中…</span>}
          </>
        }
      >
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : !data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <Empty>条件に合う企業はありません</Empty>
        ) : (
          <>
            {selected.size > 0 && (
              <BulkActionBar
                canAssign={canAssign}
                count={selected.size}
                users={users.filter((u) => u.is_active)}
                ids={[...selected]}
                onDone={() => {
                  setSelected(new Set());
                  reload();
                }}
                onClear={() => setSelected(new Set())}
              />
            )}
            <CompanyTable items={data.items} showAssignee={me.role !== "sales"} selected={selected} onSelectedChange={setSelected} />
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                <Button size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                  前へ
                </Button>
                <span className="tabular-nums text-slate-600">
                  {page} / {pages}
                </span>
                <Button size="sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                  次へ
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function BulkActionBar({
  canAssign,
  count,
  users,
  ids,
  onDone,
  onClear,
}: {
  canAssign: boolean;
  count: number;
  users: { id: number; name: string }[];
  ids: number[];
  onDone: () => void;
  onClear: () => void;
}) {
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    const assigned_user_id = target === "none" ? null : Number(target);
    const label = assigned_user_id == null ? "未割当に戻し" : `${users.find((u) => u.id === assigned_user_id)?.name}さんに割り当て`;
    if (!confirm(`選択した${count}件を${label}ます。よろしいですか？`)) return;
    setSaving(true);
    setError(null);
    try {
      await unwrap(api.companies["bulk-assign"].$post({ json: { company_ids: ids, assigned_user_id } }));
      setTarget("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`選択した${count}件をリストから削除します。架電履歴などの記録は残りますが、一覧には表示されなくなります。よろしいですか？`)) return;
    setSaving(true);
    setError(null);
    try {
      const r = await unwrap(api.companies["bulk-delete"].$post({ json: { company_ids: ids } }));
      if (r.not_found) alert(`${r.deleted}件を削除しました（${r.not_found}件は担当外または削除済みのため削除できませんでした）`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 text-sm ring-1 ring-indigo-200">
      <span className="font-medium text-indigo-900">{count}件を選択中</span>
      {canAssign && (
        <>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={selectCls}>
            <option value="">営業担当を選ぶ</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            <option value="none">（割当を外す）</option>
          </select>
          <Button variant="primary" size="sm" disabled={!target || saving} onClick={assign}>
            {saving ? "処理中…" : "一括割当"}
          </Button>
        </>
      )}
      <Button variant="danger" size="sm" disabled={saving} onClick={remove}>
        削除
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        選択を解除
      </Button>
      {error && <span className="text-rose-700">{error}</span>}
    </div>
  );
}

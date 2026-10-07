import { useState } from "react";
import { STATUS_CATEGORIES } from "../shared/constants";
import { AIUsageCard } from "../components/AIUsageCard";
import { AssigneeMappingCard } from "../components/AssigneeMappingCard";
import { TagsSettingsCard } from "../components/TagsSettingsCard";
import { PrefectureStatsCard } from "../components/PrefectureStatsCard";
import { Button, Card, CATEGORY_STYLE, ErrorBox, inputCls, selectCls } from "../components/ui";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";

const ROLE_LABEL = { admin: "管理者", manager: "マネージャー", sales: "営業" } as const;

export function Settings() {
  const { me, statuses, users, associations, listTypes, sections, reload } = useMasters();
  const isAdmin = me.role === "admin";
  const [error, setError] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState({ label: "", category: "in_progress" });

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      {!isAdmin && <p className="text-sm text-slate-500">設定の変更は管理者のみ行えます。</p>}
      {error && <ErrorBox message={error} />}

      {isAdmin && <AIUsageCard />}

      <PrefectureStatsCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="ステータス">
          <ul className="divide-y divide-slate-100 text-sm">
            {statuses.map((s) => (
              <li key={s.id} className={`flex items-center gap-2 py-1.5 ${s.is_active ? "" : "opacity-50"}`}>
                <span className="flex-1">{s.label}</span>
                <select
                  disabled={!isAdmin}
                  value={s.category}
                  onChange={(e) => run(() => unwrap(api.statuses[":id"].$patch({ param: { id: String(s.id) }, json: { category: e.target.value } })))}
                  className={`rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ${CATEGORY_STYLE[s.category]}`}
                >
                  {STATUS_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {isAdmin && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => unwrap(api.statuses[":id"].$patch({ param: { id: String(s.id) }, json: { is_active: !s.is_active } })))}>
                    {s.is_active ? "無効化" : "有効化"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <input className={inputCls} placeholder="新しいステータス名" value={newStatus.label} onChange={(e) => setNewStatus({ ...newStatus, label: e.target.value })} />
              <select className={selectCls} value={newStatus.category} onChange={(e) => setNewStatus({ ...newStatus, category: e.target.value })}>
                {STATUS_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={!newStatus.label.trim()}
                onClick={() => run(async () => {
                  await unwrap(api.statuses.$post({ json: newStatus }));
                  setNewStatus({ ...newStatus, label: "" });
                })}
              >
                追加
              </Button>
            </div>
          )}
        </Card>

        <Card title="メンバー">
          <p className="mb-2 text-xs text-slate-500">メンバーの追加・権限の変更は CRM の「設定・管理」で行います（オーナー＝管理者、一般＝営業、それ以外＝マネージャー）。</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">{u.name}</span>
                <span className="text-xs text-slate-500">{ROLE_LABEL[u.role]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TagsSettingsCard
          title="リスト種類"
          description="施設をどのリストで追うかの区分です（例：繋がり、群私幼）。ここで追加した種類を、施設の「基本情報」や一覧の一括操作で選べます。無効にした種類は新しく選べなくなりますが、すでに付いている施設には残ります。"
          items={listTypes}
          create={(name) => unwrap(api["list-types"].$post({ json: { name } }))}
          update={(id, patch) => unwrap(api["list-types"][":id"].$patch({ param: { id: String(id) }, json: patch }))}
        />
        <TagsSettingsCard
          title="加盟協会"
          description="ここで追加した加盟協会を、施設の「基本情報」で複数選べます。無効にした協会は新しく選べなくなりますが、すでに付いている施設には残ります。"
          items={associations}
          create={(name) => unwrap(api.associations.$post({ json: { name } }))}
          update={(id, patch) => unwrap(api.associations[":id"].$patch({ param: { id: String(id) }, json: patch }))}
        />
      </div>

      <TagsSettingsCard
        title="部署"
        description="タイムラインの記録に付ける部署です（例：営業部、制作部、CS）。ユーザーの施設では、タイムラインを部署ごとに切り替えて見られます。無効にした部署は新しく選べなくなりますが、すでに付いている記録には残ります。"
        items={sections}
        create={(name) => unwrap(api.sections.$post({ json: { name } }))}
        update={(id, patch) => unwrap(api.sections[":id"].$patch({ param: { id: String(id) }, json: patch }))}
      />

      {isAdmin && <AssigneeMappingCard />}
    </div>
  );
}

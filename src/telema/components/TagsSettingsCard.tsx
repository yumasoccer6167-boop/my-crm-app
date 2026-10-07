import { useState } from "react";
import type { Tag } from "../types";
import { useMasters } from "../lib/masters";
import { Button, Card, Empty, ErrorBox, inputCls } from "./ui";

/**
 * 加盟協会・リスト種類のようなマスタの管理（設定画面）。ここで追加したものを、施設の基本情報や一覧の一括操作で選べる。
 * 追加・名称変更・有効/無効の切り替えができるのは管理者のみ
 */
export function TagsSettingsCard({
  title,
  description,
  items,
  create,
  update,
}: {
  title: string;
  description: string;
  items: Tag[];
  create: (name: string) => Promise<unknown>;
  update: (id: number, patch: { name?: string; is_active?: boolean }) => Promise<unknown>;
}) {
  const { me, reload } = useMasters();
  const isAdmin = me.role === "admin";
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const value = name.trim();
    if (!value) return;
    if (await run(() => create(value))) setName("");
  }

  function rename(id: number, current: string) {
    const next = window.prompt(`${title}の名称を変更します`, current)?.trim();
    if (!next || next === current) return;
    void run(() => update(id, { name: next }));
  }

  return (
    <Card title={title}>
      <p className="mb-2 text-xs text-slate-500">{description}</p>
      {error && (
        <div className="mb-2">
          <ErrorBox message={error} />
        </div>
      )}
      {items.length === 0 ? (
        <Empty>{title}はまだ登録されていません</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((a) => (
            <li key={a.id} className={`flex items-center gap-2 py-1.5 ${a.is_active ? "" : "opacity-50"}`}>
              <span className="flex-1 break-words">
                {a.name}
                {!a.is_active && <span className="ml-2 text-xs text-slate-500">（無効）</span>}
              </span>
              {isAdmin && (
                <>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => rename(a.id, a.name)}>
                    名称変更
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => update(a.id, { is_active: !a.is_active }))}>
                    {a.is_active ? "無効化" : "有効化"}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input className={inputCls} placeholder={`新しい${title}名`} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            追加
          </Button>
        </form>
      )}
    </Card>
  );
}

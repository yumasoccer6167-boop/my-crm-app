import { useState } from "react";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";
import { Button, Card, Empty, ErrorBox, inputCls } from "./ui";

/** 加盟協会のマスタ管理（設定画面）。ここで追加した協会を、施設の基本情報で選べる。変更できるのは管理者のみ */
export function AssociationsSettingsCard() {
  const { me, associations, reload } = useMasters();
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
    if (await run(() => unwrap(api.associations.$post({ json: { name: value } })))) setName("");
  }

  function rename(id: number, current: string) {
    const next = window.prompt("加盟協会の名称を変更します", current)?.trim();
    if (!next || next === current) return;
    void run(() => unwrap(api.associations[":id"].$patch({ param: { id: String(id) }, json: { name: next } })));
  }

  return (
    <Card title="加盟協会">
      <p className="mb-2 text-xs text-slate-500">ここで追加した加盟協会を、施設の「基本情報」で複数選べます。無効にした協会は新しく選べなくなりますが、すでに付いている施設には残ります。</p>
      {error && (
        <div className="mb-2">
          <ErrorBox message={error} />
        </div>
      )}
      {associations.length === 0 ? (
        <Empty>加盟協会はまだ登録されていません</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {associations.map((a) => (
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
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unwrap(api.associations[":id"].$patch({ param: { id: String(a.id) }, json: { is_active: !a.is_active } })))}>
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
          <input className={inputCls} placeholder="新しい加盟協会名" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            追加
          </Button>
        </form>
      )}
    </Card>
  );
}

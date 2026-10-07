import { useState } from "react";
import type { Tag } from "../../types";
import { useMasters } from "../../lib/masters";
import { Button, ErrorBox } from "../ui";

/**
 * 基本情報カードの「加盟協会」「リスト種類」のような行。複数選択でき、この行だけで保存する（カード全体の「編集」とは別）。
 * 選べるのは有効なマスタだけ。すでに付いているものは、無効になっていても外せるよう残す
 */
export function TagsRow({
  label,
  selected,
  master,
  editable,
  save,
  onSaved,
  addHint,
}: {
  label: string;
  selected: Tag[];
  master: Tag[];
  editable: boolean;
  /** 選んだ id の一覧で保存する（サーバーに送る処理） */
  save: (ids: number[]) => Promise<unknown>;
  onSaved: () => void;
  /** 選べるものが1つもないときの案内の続き（管理者かどうかで変える） */
  addHint: (isAdmin: boolean) => string;
}) {
  const { me } = useMasters();
  const [editing, setEditing] = useState(false);
  const [ids, setIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keptInactive = selected.filter((a) => !a.is_active);
  const options = [...master.filter((a) => a.is_active), ...keptInactive.filter((a) => !master.some((m) => m.id === a.id && m.is_active))];

  function start() {
    setIds(selected.map((a) => a.id));
    setError(null);
    setEditing(true);
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await save(ids);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const toggle = (id: number) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="contents">
      <dt className="pt-1 text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0">
        {editing ? (
          <div className="space-y-2">
            {options.length === 0 ? (
              <p className="text-xs text-slate-500">
                選べる{label}がありません。{addHint(me.role === "admin")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {options.map((a) => (
                  <label
                    key={a.id}
                    className={`cursor-pointer break-words rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${ids.includes(a.id) ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                  >
                    <input type="checkbox" className="sr-only" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
                    {a.name}
                    {!a.is_active && "（無効）"}
                  </label>
                ))}
              </div>
            )}
            {error && <ErrorBox message={error} />}
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button size="sm" variant="primary" disabled={saving} onClick={onSave}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="pt-0.5">
            {selected.length === 0 ? (
              <span className="text-slate-300">未設定</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {selected.map((a) => (
                  <span
                    key={a.id}
                    className={`break-words rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${a.is_active ? "bg-indigo-50 text-indigo-800 ring-indigo-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            )}
            {editable && (
              <div className="mt-1">
                <Button size="sm" variant="ghost" onClick={start}>
                  {selected.length === 0 ? "選択する" : "変更"}
                </Button>
              </div>
            )}
          </div>
        )}
      </dd>
    </div>
  );
}

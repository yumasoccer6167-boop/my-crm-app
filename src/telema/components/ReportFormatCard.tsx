import { useEffect, useRef, useState } from "react";
import type { DailyReportTemplate } from "../types";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";
import { Button, Card, ErrorBox, Loading } from "./ui";

/** 日報のフォーマット（文面の型）の編集。{{項目}} の所に、日報を作るときの数値が入る。直せるのはマネージャー以上 */
export function ReportFormatCard({ onSaved }: { onSaved?: () => void }) {
  const { me } = useMasters();
  const canEdit = me.role !== "sales";
  const [tpl, setTpl] = useState<DailyReportTemplate | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const apply = (t: DailyReportTemplate) => {
    setTpl(t);
    setText(t.body);
  };
  useEffect(() => {
    unwrap(api["daily-report"].template.$get())
      .then(apply)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(t);
  }, [message]);

  async function run(fn: () => Promise<DailyReportTemplate>, done: string) {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
      setMessage(done);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** カーソルの位置に {{項目}} を入れる */
  function insert(key: string) {
    const el = area.current;
    const token = `{{${key}}}`;
    if (!el) return setText((t) => t + token);
    const { selectionStart: s, selectionEnd: e } = el;
    setText(text.slice(0, s) + token + text.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  if (!tpl) return error ? <ErrorBox message={error} /> : <Loading />;
  const changed = text !== tpl.body;
  return (
    <Card
      title="日報フォーマット"
      action={
        canEdit && (
          <span className="flex items-center gap-2">
            {message && <span className="text-xs text-emerald-700">{message}</span>}
            <Button size="sm" disabled={busy || text === tpl.default} onClick={() => setText(tpl.default)}>
              標準の文面を入れる
            </Button>
            <Button size="sm" variant="primary" disabled={busy || !changed || !text.trim()} onClick={() => run(() => unwrap(api["daily-report"].template.$put({ json: { body: text } })), "保存しました")}>
              {busy ? "保存中…" : "フォーマットを保存"}
            </Button>
          </span>
        )
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          日報の文面の型です。{"{{項目}}"} の所に、日報を作るときの数値が入ります。文章や並び順は自由に直せます。{tpl.is_default ? "今は標準の文面です。" : "標準の文面から変更されています。"}
          {!canEdit && "直せるのはマネージャー以上です。"}
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">項目を入れる：</span>
            {tpl.placeholders.map((p) => (
              <button key={p.key} type="button" title={p.description} onClick={() => insert(p.key)} className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-indigo-50 hover:text-indigo-700">
                {p.key}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!canEdit}
          rows={22}
          maxLength={5000}
          aria-label="日報フォーマット"
          className="w-full rounded-md border-0 px-3 py-2 font-mono text-sm leading-relaxed ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500"
        />
        {error && <ErrorBox message={error} />}
        {canEdit && !tpl.is_default && (
          <button type="button" disabled={busy} className="text-xs text-slate-500 underline hover:text-slate-800" onClick={() => run(() => unwrap(api["daily-report"].template.$delete()), "標準の文面に戻しました")}>
            保存した文面をやめて、標準に戻す
          </button>
        )}
      </div>
    </Card>
  );
}

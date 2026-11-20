import { useRef, useState } from "react";
import type { IndustryImportBatch, IndustryImportRow } from "../types";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";
import { readTable } from "../shared/csv";
import { normalizePhone } from "../shared/normalize";
import { Button, Card, ErrorBox } from "./ui";

// 列名のゆれ（左から優先）。電話番号と施設類型が必要
const ALIASES = {
  name: ["施設の名称", "施設名", "園名", "会社名"],
  phone: ["施設の連絡先 電話番号", "電話番号", "電話"],
  type: ["施設類型", "業種・施設類型", "業種"],
} as const;
const BATCH = 500;

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf); // Excelで保存した日本語CSV
  }
}

/** CSVの行を、照合APIへ送る形にする。同じ電話番号に別の施設類型の行があれば conflict を立てる（施設名で絞れたときだけ入れるため）。必要な列が無ければ理由を返す */
function toRows(text: string): { rows: IndustryImportRow[] } | { error: string } {
  const { header, rows } = readTable(text);
  const col = Object.fromEntries((Object.keys(ALIASES) as (keyof typeof ALIASES)[]).map((k) => [k, ALIASES[k].find((h) => header.includes(h))])) as Record<keyof typeof ALIASES, string | undefined>;
  const missing = [!col.phone && "電話番号", !col.type && "施設類型"].filter(Boolean);
  if (missing.length) return { error: `必要な列が見つかりません：${missing.join("・")}（見つかった列：${header.join("、")}）` };
  const get = (r: Record<string, string>, k: keyof typeof ALIASES) => (col[k] ? (r[col[k]!] ?? "") : "");
  const types = new Map<string, Set<string>>();
  for (const r of rows) {
    const p = normalizePhone(get(r, "phone"));
    const t = get(r, "type").trim();
    if (p && t) types.set(p, (types.get(p) ?? new Set()).add(t));
  }
  return {
    rows: rows.map((r, i) => {
      const p = normalizePhone(get(r, "phone"));
      return { line: i + 2, name: get(r, "name"), phone: get(r, "phone"), facility_type: get(r, "type"), conflict: !!p && (types.get(p)?.size ?? 0) > 1 };
    }),
  };
}

type Total = Omit<IndustryImportBatch, "new_keys" | "applied">;
const zero = (): Total => ({ rows: 0, filled: 0, overwritten: 0, same: 0, kept: 0, unmatched: 0, review: 0, duplicate: 0, no_phone: 0, no_type: 0, types: {}, unmatched_rows: [], review_rows: [], kept_rows: [] });

function download(name: string, header: string[], lines: string[][]) {
  const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const csv = "﻿" + [header, ...lines].map((l) => l.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 施設類型のCSVを、電話番号でカルテ（施設）と照合して、基本情報の「業種・施設類型」に施設類型を入れる（管理者のみ） */
export function IndustryImportCard() {
  const { me } = useMasters();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; rows: IndustryImportRow[] } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState<null | { apply: boolean; done: number }>(null);
  const [result, setResult] = useState<{ apply: boolean; overwrite: boolean; total: Total } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (me.role !== "admin") return null;

  async function pick(f: File | undefined) {
    setError(null);
    setResult(null);
    setFile(null);
    if (!f) return;
    const parsed = toRows(await readText(f));
    if ("error" in parsed) setError(parsed.error);
    else if (parsed.rows.length === 0) setError("CSVにデータの行がありません");
    else setFile({ name: f.name, rows: parsed.rows });
  }

  /** 500行ずつ送って最後まで繰り返す。apply=false は確認だけ（何も保存しない）。回をまたぐ重複を見分けるため、入れる予定の施設を次の回へ渡す */
  async function run(apply: boolean) {
    if (!file) return;
    setError(null);
    setResult(null);
    setRunning({ apply, done: 0 });
    const total = zero();
    let known: string[] = [];
    try {
      for (let i = 0; i < file.rows.length; i += BATCH) {
        const r: IndustryImportBatch = await unwrap(api.admin["industry-import"].$post({ json: { apply, overwrite, rows: file.rows.slice(i, i + BATCH), known_keys: known.join("\n") } }));
        for (const k of ["rows", "filled", "overwritten", "same", "kept", "unmatched", "review", "duplicate", "no_phone", "no_type"] as const) total[k] += r[k];
        total.unmatched_rows.push(...r.unmatched_rows);
        total.review_rows.push(...r.review_rows);
        total.kept_rows.push(...r.kept_rows);
        for (const [n, c] of Object.entries(r.types)) total.types[n] = (total.types[n] ?? 0) + c;
        known = [...known, ...r.new_keys];
        setRunning({ apply, done: Math.min(file.rows.length, i + BATCH) });
      }
      setResult({ apply, overwrite, total });
    } catch (e) {
      setError(`途中で止まりました：${e instanceof Error ? e.message : String(e)}（入れ済みの分は保存されています。もう一度実行すると、すでに同じ値の施設は何も変えません）`);
    } finally {
      setRunning(null);
    }
  }

  const t = result?.total;
  const changes = t ? t.filled + t.overwritten : 0;
  return (
    <Card title="施設類型のCSVから業種・施設類型を入れる（管理者）">
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          施設類型のCSV（施設の名称・電話番号・施設類型）を、<b>電話番号でカルテ（施設）と照合</b>して、一致した施設の基本情報の「業種・施設類型」に、CSVの施設類型を入れます。
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          <li>電話番号は、ハイフンや全角を除いて比べます。電話番号が空の行、施設類型が空の行は入れません。</li>
          <li>同じ電話番号の施設が複数あるとき、CSVの中で同じ電話番号に別の施設類型の行があるときは、施設名が似ている施設に絞れた場合だけ入れます。絞れないものは「要確認」にして入れません。</li>
          <li>先に「確認する」で結果を見てから、入れます。</li>
        </ul>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={overwrite} disabled={!!running} onChange={(e) => (setOverwrite(e.target.checked), setResult(null))} />
          すでに業種・施設類型が入っている施設も、CSVの値で上書きする（しないときは、空欄の施設にだけ入れます）
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-xs" onChange={(e) => void pick(e.target.files?.[0])} />
          {file && <span className="text-xs text-slate-500">{file.name}（{file.rows.length.toLocaleString()}行）</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!file || !!running} onClick={() => void run(false)}>
            確認する（入れない）
          </Button>
          {result && !result.apply && changes > 0 && (
            <Button
              variant="primary"
              disabled={!!running}
              onClick={() => {
                if (confirm(`確認した内容で、${changes}施設の「業種・施設類型」を${result.total.overwritten > 0 ? `入れます（うち${result.total.overwritten}施設は今の値を上書きします）` : "入れます"}。よろしいですか？`)) void run(true);
              }}
            >
              この内容で入れる
            </Button>
          )}
          {running && (
            <span className="text-xs text-slate-500">
              {running.apply ? "入れています" : "確認中"}…（{running.done.toLocaleString()} / {file?.rows.length.toLocaleString()}行）
            </span>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        {t && (
          <div className="space-y-2 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="font-medium text-slate-900">{result.apply ? "入れました" : "確認結果（まだ入れていません）"}</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-4">
              <span>空欄に入れる <b className="tabular-nums">{t.filled}</b>施設</span>
              <span>上書きする <b className="tabular-nums">{t.overwritten}</b>施設</span>
              <span>すでに同じ値 <b className="tabular-nums">{t.same}</b>施設</span>
              <span>別の値があり変えない <b className="tabular-nums">{t.kept}</b>施設</span>
              <span>施設が見つからない <b className="tabular-nums">{t.unmatched}</b>行</span>
              <span>要確認 <b className="tabular-nums">{t.review}</b>行</span>
              <span>CSV内の重複 <b className="tabular-nums">{t.duplicate}</b>行</span>
              <span>電話番号なし・施設類型なし <b className="tabular-nums">{t.no_phone}</b>・<b className="tabular-nums">{t.no_type}</b>行</span>
            </div>
            {Object.keys(t.types).length > 0 && (
              <p className="text-xs text-slate-600">
                入れる施設類型：{Object.entries(t.types).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}施設`).join("、")}
              </p>
            )}
            {t.kept_rows.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-700">
                  すでに別の値が入っているので変えていません
                  <button type="button" className="font-normal text-indigo-700 hover:underline" onClick={() => download("施設類型_変えない.csv", ["行", "施設名(CSV)", "電話", "施設類型(CSV)", "施設名(カルテ)", "今の業種・施設類型"], t.kept_rows.map((r) => [String(r.line), r.name, r.phone, r.facility_type, r.company_name, r.current]))}>
                    CSVで保存
                  </button>
                </div>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {t.kept_rows.slice(0, 20).map((r) => (
                    <li key={r.line}>
                      {r.line}行目 <b className="text-slate-800">{r.company_name}</b>：今「{r.current}」／CSV「{r.facility_type}」
                    </li>
                  ))}
                  {t.kept > 20 && <li className="text-slate-400">ほか。全件は「CSVで保存」で確認できます{t.kept > t.kept_rows.length && `（保存できるのは先頭${t.kept_rows.length}件）`}。上書きするときは、上のチェックを入れて確認し直してください</li>}
                </ul>
              </div>
            )}
            {t.review_rows.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-700">
                  要確認（入れていません）
                  <button type="button" className="font-normal text-indigo-700 hover:underline" onClick={() => download("施設類型_要確認.csv", ["行", "施設名", "電話", "施設類型", "理由", "候補"], t.review_rows.map((r) => [String(r.line), r.name, r.phone, r.facility_type, r.reason, r.candidates.join(" / ")]))}>
                    CSVで保存
                  </button>
                </div>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {t.review_rows.slice(0, 30).map((r) => (
                    <li key={r.line}>
                      {r.line}行目 <b className="text-slate-800">{r.name}</b>（{r.facility_type}）：{r.reason}
                      {r.candidates.length > 0 && <span className="text-slate-400">（候補: {r.candidates.join("、")}）</span>}
                    </li>
                  ))}
                  {t.review > 30 && <li className="text-slate-400">ほか。全件は「CSVで保存」で確認できます{t.review > t.review_rows.length && `（保存できるのは先頭${t.review_rows.length}件）`}</li>}
                </ul>
              </div>
            )}
            {t.unmatched_rows.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-700">
                  施設が見つからない（入れていません）
                  <button type="button" className="font-normal text-indigo-700 hover:underline" onClick={() => download("施設類型_施設なし.csv", ["行", "施設名", "電話", "施設類型"], t.unmatched_rows.map((r) => [String(r.line), r.name, r.phone, r.facility_type]))}>
                    CSVで保存
                  </button>
                </div>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {t.unmatched_rows.slice(0, 20).map((r) => (
                    <li key={r.line}>
                      {r.line}行目 <b className="text-slate-800">{r.name}</b>（{r.facility_type}）{r.phone}
                    </li>
                  ))}
                  {t.unmatched > 20 && <li className="text-slate-400">ほか。全件は「CSVで保存」で確認できます{t.unmatched > t.unmatched_rows.length && `（保存できるのは先頭${t.unmatched_rows.length}件）`}</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

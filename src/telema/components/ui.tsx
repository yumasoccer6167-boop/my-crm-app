import type { ButtonHTMLAttributes, ReactNode } from "react";

export const CATEGORY_STYLE: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-sky-50 text-sky-800 ring-sky-200",
  appointment: "bg-amber-50 text-amber-800 ring-amber-300",
  won: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  lost: "bg-rose-50 text-rose-700 ring-rose-200",
  excluded: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export function StatusBadge({ label, category }: { label: string | null; category: string | null }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${CATEGORY_STYLE[category ?? "not_started"]}`}>
      {label ?? "未架電"}
    </span>
  );
}

const TEMP: Record<string, [string, string]> = {
  high: ["高", "text-rose-600"],
  mid: ["中", "text-amber-600"],
  low: ["低", "text-sky-600"],
  unrated: ["—", "text-slate-400"],
};
export function Temperature({ value }: { value: string | null }) {
  const [label, cls] = TEMP[value ?? "unrated"] ?? TEMP.unrated!;
  return <span className={`text-sm font-semibold ${cls}`}>{label}</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };
export function Button({ variant = "secondary", size = "md", className = "", ...p }: BtnProps) {
  const v = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
    secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
    danger: "bg-white text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-50",
  }[variant];
  const s = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return <button type="button" className={`inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${v} ${s} ${className}`} {...p} />;
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg bg-white ring-1 ring-slate-200 ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-md bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="danger" onClick={onRetry}>
          再試行
        </Button>
      )}
    </div>
  );
}

export const Loading = () => <div className="py-10 text-center text-sm text-slate-400">読み込み中…</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="py-8 text-center text-sm text-slate-400">{children}</div>;

export const inputCls =
  "w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none";
export const selectCls = inputCls.replace("w-full", "w-auto");

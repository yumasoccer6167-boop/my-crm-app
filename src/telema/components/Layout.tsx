import { NavLink, Outlet } from "react-router";
import { useMasters } from "../lib/masters";

const NAV = [
  { to: "/", label: "今日", end: true },
  { to: "/companies", label: "リスト" },
  { to: "/network", label: "つながり" },
  { to: "/import", label: "取り込み" },
  { to: "/settings", label: "設定" },
];

const ROLE_LABEL = { admin: "管理者", manager: "マネージャー", sales: "営業" } as const;

export function Layout() {
  const { me } = useMasters();
  return (
    <div className="text-slate-900">
      <div className="mb-4 flex items-center gap-4 border-b border-slate-200">
        <nav className="-mb-px flex flex-1 gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-teal-600 text-teal-700" : "border-transparent text-slate-600 hover:text-slate-900"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <span className="hidden shrink-0 text-xs text-slate-500 sm:block">
          {me.name}（{ROLE_LABEL[me.role]}）
        </span>
      </div>
      <Outlet />
    </div>
  );
}

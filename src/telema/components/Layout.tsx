import { NavLink, Outlet, useLocation } from "react-router";
import { listHref } from "../lib/list-query";
import { useMasters } from "../lib/masters";

const NAV = [
  { to: "/", label: "マイページ", end: true },
  { to: "/companies", label: "リスト" },
  { to: "/network", label: "つながり" },
  { to: "/visits", label: "訪問ルート" },
  { to: "/import", label: "取り込み" },
  { to: "/settings", label: "設定" },
];

const ROLE_LABEL = { admin: "管理者", manager: "マネージャー", sales: "営業" } as const;

export function Layout() {
  const { me } = useMasters();
  // 「リスト」は前回の絞り込み条件付きの URL にする（リストを開いている間は今の条件。保存は描画の後なので URL から取る）
  const loc = useLocation();
  const listTo = loc.pathname === "/companies" ? `/companies${loc.search}` : listHref();
  return (
    <div className="text-slate-900">
      <div className="mb-4 flex items-center gap-4 border-b border-slate-200">
        <nav className="-mb-px flex flex-1 gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to === "/companies" ? listTo : n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`
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

import { createMemoryRouter, Navigate, NavLink, Outlet, RouterProvider } from "react-router";
import { OpenCompany } from "./components/OpenCompany";
import { HostProvider } from "./lib/host";
import { MastersProvider } from "./lib/masters";
import { Analytics } from "./pages/Analytics";
import { SalesBoard } from "./pages/SalesBoard";
import { SalesResults } from "./pages/SalesResults";
import { Teleappt } from "./pages/Teleappt";

const NAV = [
  { to: "/results", label: "営業結果" },
  { to: "/board", label: "営業成績" },
  { to: "/analytics", label: "数値分析" },
  { to: "/teleappt", label: "テレアポ" },
];

function AnalyticsLayout() {
  return (
    <div className="text-slate-900">
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

// CRM本体はURLを使わずタブで画面を切り替えているので、ここもURLを変えないメモリ上のルーターで画面を切り替える
const router = createMemoryRouter([
  {
    element: <AnalyticsLayout />,
    children: [
      { path: "/", element: <Navigate to="/results" replace /> },
      { path: "/results", element: <SalesResults /> },
      { path: "/board", element: <SalesBoard /> },
      { path: "/analytics", element: <Analytics /> },
      { path: "/teleappt", element: <Teleappt /> },
      { path: "/companies/:id", element: <OpenCompany /> },
    ],
  },
]);

/** CRM本体（src/App.jsx）の「数値分析」タブの中身：営業結果・営業成績・数値分析・テレアポ */
export default function AnalyticsApp({ onOpenCompany = () => {} }: { onOpenCompany?: (companyId: number) => void }) {
  return (
    <HostProvider value={{ appointmentTemplates: [], successCases: [], openSuccessCase: () => {}, createSuccessCase: () => {}, openCompany: onOpenCompany }}>
      <MastersProvider>
        <RouterProvider router={router} />
      </MastersProvider>
    </HostProvider>
  );
}

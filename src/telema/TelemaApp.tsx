import { createMemoryRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { MastersProvider } from "./lib/masters";
import { CompanyDetail } from "./pages/CompanyDetail";
import { Companies } from "./pages/Companies";
import { Dashboard } from "./pages/Dashboard";
import { ImportPage } from "./pages/Import";
import { Network } from "./pages/Network";
import { Settings } from "./pages/Settings";
import { VisitRoute } from "./pages/VisitRoute";

// CRM本体はURLを使わずタブで画面を切り替えているので、テレマリスト内の画面遷移もURLを変えないメモリ上のルーターで行う
const router = createMemoryRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/companies", element: <Companies /> },
      { path: "/companies/:id", element: <CompanyDetail /> },
      { path: "/network", element: <Network /> },
      { path: "/visits", element: <VisitRoute /> },
      { path: "/import", element: <ImportPage /> },
      { path: "/settings", element: <Settings /> },
    ],
  },
]);

/** CRM本体（src/App.jsx）の「テレマリスト」タブの中身 */
export default function TelemaApp() {
  return (
    <MastersProvider>
      <RouterProvider router={router} />
    </MastersProvider>
  );
}

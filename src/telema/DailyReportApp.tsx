import { createMemoryRouter, RouterProvider } from "react-router";
import { MastersProvider } from "./lib/masters";
import { DailyReport } from "./pages/DailyReport";

// 日報の画面は URL の絞り込み（?date=）を読むので、URL を変えないメモリ上のルーターに載せる
const router = createMemoryRouter([{ path: "/", element: <DailyReport /> }]);

/** CRM本体（src/App.jsx）の「日報」タブの中身 */
export default function DailyReportApp() {
  return (
    <div className="text-slate-900">
      <MastersProvider>
        <RouterProvider router={router} />
      </MastersProvider>
    </div>
  );
}

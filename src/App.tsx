import { lazy, Suspense } from "react";

const DashboardApp = lazy(() =>
  import("./apps/DashboardApp").then((module) => ({ default: module.DashboardApp })),
);

export function App() {
  return (
    <Suspense fallback={<div className="route-loading">Carregando</div>}>
      <DashboardApp />
    </Suspense>
  );
}

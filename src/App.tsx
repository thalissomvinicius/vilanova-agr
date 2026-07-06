import { lazy, Suspense } from "react";

const DashboardApp = lazy(() =>
  import("./apps/DashboardApp").then((module) => ({ default: module.DashboardApp })),
);
const FieldApp = lazy(() => import("./apps/FieldApp").then((module) => ({ default: module.FieldApp })));

export function App() {
  const path = window.location.pathname.toLowerCase();

  return (
    <Suspense fallback={<div className="route-loading">Carregando</div>}>
      {path.startsWith("/dashboard") ? <DashboardApp /> : <FieldApp />}
    </Suspense>
  );
}

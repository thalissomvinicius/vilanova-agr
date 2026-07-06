import { useEffect, useState } from "react";
import { RefreshCw, BarChart3 } from "lucide-react";
import { Dashboard } from "../components/Dashboard";
import { initializeLocalStore, listDeposits, listScaleTickets } from "../lib/localStore";
import type { FieldDeposit, ScaleTicket } from "../types";

export function DashboardApp() {
  const [deposits, setDeposits] = useState<FieldDeposit[]>([]);
  const [scaleTickets, setScaleTickets] = useState<ScaleTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [nextDeposits, nextScaleTickets] = await Promise.all([listDeposits(), listScaleTickets()]);
    setDeposits(nextDeposits);
    setScaleTickets(nextScaleTickets);
  };

  useEffect(() => {
    initializeLocalStore()
      .then(refresh)
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="app-shell dashboard-shell">
      <aside className="side-rail">
        <div className="brand-lockup">
          <img src="/logo-vilanova.png" alt="Vila Nova Agroindustrial" />
          <span className="module-badge">Dashboard Subprodutos</span>
        </div>

        <nav className="main-nav" aria-label="Dashboard">
          <a className="active" href="/dashboard">
            <BarChart3 aria-hidden="true" />
            Painel
          </a>
        </nav>
      </aside>

      <section className="main-region dashboard-region">
        {loading ? (
          <div className="loading-state">
            <RefreshCw aria-hidden="true" />
            Carregando
          </div>
        ) : null}

        {!loading ? <Dashboard deposits={deposits} scaleTickets={scaleTickets} /> : null}
      </section>
    </main>
  );
}

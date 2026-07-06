import { useCallback, useEffect, useState } from "react";
import { RefreshCw, BarChart3, LogOut, UserRound } from "lucide-react";
import { Dashboard } from "../components/Dashboard";
import { Login } from "../components/Login";
import { logoutDashboardUser, refreshDashboardSession, type DashboardUser } from "../lib/auth";
import { loadRemoteDashboardData } from "../lib/remoteData";
import type { FieldDeposit, ScaleTicket } from "../types";

export function DashboardApp() {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [deposits, setDeposits] = useState<FieldDeposit[]>([]);
  const [scaleTickets, setScaleTickets] = useState<ScaleTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataMode, setDataMode] = useState("Aguardando Supabase");

  const refresh = useCallback(async (profile: DashboardUser) => {
    const remoteData = await loadRemoteDashboardData(profile);

    if (remoteData) {
      setDeposits(remoteData.deposits);
      setScaleTickets(remoteData.scaleTickets);
      setDataMode(remoteData.source === "dashboard-rpc" ? "Supabase via matricula" : "Supabase conectado");
      return;
    }

    setDeposits([]);
    setScaleTickets([]);
    setDataMode("Supabase sem registros");
  }, []);

  useEffect(() => {
    let mounted = true;

    refreshDashboardSession()
      .then(async (profile) => {
        if (!mounted) return;

        if (!profile) {
          setLoading(false);
          return;
        }

        setUser(profile);
        await refresh(profile);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [refresh]);

  const handleLogin = async (profile: DashboardUser) => {
    setUser(profile);
    setLoading(true);
    await refresh(profile);
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    await logoutDashboardUser(user);
    setUser(null);
    setDeposits([]);
    setScaleTickets([]);
    setLoading(false);
  };

  if (!user && !loading) {
    return <Login onLogin={handleLogin} />;
  }

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
          {user ? (
            <button type="button" onClick={handleLogout}>
              <LogOut aria-hidden="true" />
              Sair
            </button>
          ) : null}
        </nav>

        {user ? (
          <div className="rail-user-card">
            <UserRound aria-hidden="true" />
            <div>
              <strong>{user.nome}</strong>
              <span>{user.matricula}</span>
            </div>
          </div>
        ) : null}

        <div className="rail-status">
          <span className="dot online" />
          {dataMode}
        </div>
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

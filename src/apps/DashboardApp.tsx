import { useCallback, useEffect, useState } from "react";
import { RefreshCw, BarChart3, LogOut, UserRound } from "lucide-react";
import { Dashboard } from "../components/Dashboard";
import { Login } from "../components/Login";
import { logoutDashboardUser, refreshDashboardSession, type DashboardUser } from "../lib/auth";
import { loadRemoteDashboardData } from "../lib/remoteData";
import { deleteFieldDeposit, reviewFieldDeposit, updateFieldDeposit } from "../lib/review";
import type { FieldDeposit, FieldDepositEditValues, ReviewStatus, ScaleTicket } from "../types";

export function DashboardApp() {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [deposits, setDeposits] = useState<FieldDeposit[]>([]);
  const [scaleTickets, setScaleTickets] = useState<ScaleTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataMode, setDataMode] = useState("Aguardando Supabase");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [reviewBusyDepositId, setReviewBusyDepositId] = useState<string | null>(null);
  const [deleteBusyDepositId, setDeleteBusyDepositId] = useState<string | null>(null);
  const [updateBusyDepositId, setUpdateBusyDepositId] = useState<string | null>(null);

  const refresh = useCallback(async (profile: DashboardUser) => {
    setRefreshing(true);
    try {
      const remoteData = await loadRemoteDashboardData(profile);
      setDeposits(remoteData.deposits);
      setScaleTickets(remoteData.scaleTickets);
      setDataMode(
        remoteData.source === "dashboard-rpc"
          ? "Supabase via matricula"
          : "Supabase conectado",
      );
      setLoadError("");
      setLastUpdatedAt(new Date());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao carregar os dados do Supabase.");
      setDataMode("Falha de conexao");
    } finally {
      setRefreshing(false);
    }
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

  useEffect(() => {
    if (!user) return undefined;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(user);
    }, 45_000);

    return () => window.clearInterval(intervalId);
  }, [refresh, user]);

  const handleLogin = async (profile: DashboardUser) => {
    setUser(profile);
    setLoading(true);
    try {
      await refresh(profile);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await logoutDashboardUser(user);
    setUser(null);
    setDeposits([]);
    setScaleTickets([]);
    setLoading(false);
  };

  const handleReviewDeposit = async (depositId: string, status: ReviewStatus) => {
    if (!user) return;

    setReviewBusyDepositId(depositId);

    try {
      const result = await reviewFieldDeposit(user, depositId, status);
      setDeposits((current) => current.map((deposit) => (
        deposit.id === depositId || deposit.id === result.id
          ? {
              ...deposit,
              reviewStatus: result.reviewStatus,
              reviewNotes: result.reviewNotes,
              reviewedAt: result.reviewedAt,
              reviewedByLabel: result.reviewedByLabel,
            }
          : deposit
      )));
      await refresh(user);
    } finally {
      setReviewBusyDepositId(null);
    }
  };

  const handleDeleteDeposit = async (depositId: string) => {
    if (!user) return;

    setDeleteBusyDepositId(depositId);

    try {
      const result = await deleteFieldDeposit(user, depositId);
      setDeposits((current) => current.filter((deposit) => deposit.id !== depositId && deposit.id !== result.id));
      setScaleTickets((current) => current.filter((ticket) => (
        ticket.fieldDepositId !== depositId && ticket.fieldDepositId !== result.id
      )));
      await refresh(user);
    } finally {
      setDeleteBusyDepositId(null);
    }
  };

  const handleUpdateDeposit = async (depositId: string, values: FieldDepositEditValues) => {
    if (!user) return;

    setUpdateBusyDepositId(depositId);

    try {
      const result = await updateFieldDeposit(user, depositId, values);
      setDeposits((current) => current.map((deposit) => (
        deposit.id === depositId || deposit.id === result.id
          ? {
              ...deposit,
              driverRegistration: result.driverRegistration,
              driverName: result.driverName,
              vehiclePlate: result.vehiclePlate,
              subproduct: result.subproduct,
              loadingOrigin: result.loadingOrigin,
              scaleTicketCode: result.scaleTicketCode,
              farm: result.farm,
              placementMode: result.placementMode,
              plotPrimary: result.plotPrimary,
              plotSecondary: result.plotSecondary,
              depositDate: result.depositDate,
              depositTime: result.depositTime,
              latitude: result.latitude,
              longitude: result.longitude,
              locationAccuracy: result.locationAccuracy,
              notes: result.notes,
              updatedAt: result.updatedAt || deposit.updatedAt,
            }
          : deposit
      )));
      await refresh(user);
    } finally {
      setUpdateBusyDepositId(null);
    }
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
            <button type="button" onClick={() => void refresh(user)} disabled={refreshing}>
              <RefreshCw aria-hidden="true" className={refreshing ? "spin" : ""} />
              Atualizar
            </button>
          ) : null}
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
          <span>
            {dataMode}
            {lastUpdatedAt ? <small>Atualizado {lastUpdatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small> : null}
          </span>
        </div>
      </aside>

      <section className="main-region dashboard-region">
        {loadError ? (
          <div className="dashboard-error" role="alert">
            <span>{loadError}</span>
            {user ? <button type="button" onClick={() => void refresh(user)}>Tentar novamente</button> : null}
          </div>
        ) : null}
        {loading ? (
          <div className="loading-state">
            <RefreshCw aria-hidden="true" />
            Carregando
          </div>
        ) : null}

        {!loading ? (
          <Dashboard
            deposits={deposits}
            scaleTickets={scaleTickets}
            onReviewDeposit={handleReviewDeposit}
            onDeleteDeposit={handleDeleteDeposit}
            onUpdateDeposit={handleUpdateDeposit}
            reviewBusyDepositId={reviewBusyDepositId}
            deleteBusyDepositId={deleteBusyDepositId}
            updateBusyDepositId={updateBusyDepositId}
          />
        ) : null}
      </section>
    </main>
  );
}

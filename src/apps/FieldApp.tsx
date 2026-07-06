import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ClipboardPlus, DatabaseZap, RefreshCw } from "lucide-react";
import { FieldForm } from "../components/FieldForm";
import { SyncQueue } from "../components/SyncQueue";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { initializeLocalStore, listDeposits } from "../lib/localStore";
import { getCurrentSession, supabase, supabaseConfigured } from "../lib/supabase";
import { syncPendingDeposits } from "../lib/sync";
import type { FieldDeposit } from "../types";

type FieldView = "field" | "sync";

export function FieldApp() {
  const [view, setView] = useState<FieldView>("field");
  const [deposits, setDeposits] = useState<FieldDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const autoSyncBusyRef = useRef(false);
  const lastAutoSyncKeyRef = useRef("");
  const online = useOnlineStatus();

  const pendingCount = useMemo(
    () => deposits.filter((deposit) => deposit.syncStatus !== "synced" && !deposit.demoRecord).length,
    [deposits],
  );
  const pendingSyncKey = useMemo(
    () => deposits
      .filter((deposit) => deposit.syncStatus !== "synced" && !deposit.demoRecord)
      .map((deposit) => `${deposit.id}:${deposit.syncStatus}:${deposit.updatedAt}`)
      .join("|"),
    [deposits],
  );

  const refresh = async () => {
    const nextDeposits = await listDeposits();
    setDeposits(nextDeposits);
  };

  useEffect(() => {
    initializeLocalStore()
      .then(refresh)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getCurrentSession().then((session) => setHasSession(Boolean(session)));

    if (!supabase) {
      return undefined;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setHasSession(Boolean(nextSession));
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (
      loading ||
      !online ||
      !supabaseConfigured ||
      !hasSession ||
      pendingCount === 0 ||
      !pendingSyncKey ||
      autoSyncBusyRef.current ||
      lastAutoSyncKeyRef.current === pendingSyncKey
    ) {
      return;
    }

    autoSyncBusyRef.current = true;
    lastAutoSyncKeyRef.current = pendingSyncKey;

    syncPendingDeposits()
      .catch(() => undefined)
      .finally(() => {
        refresh().finally(() => {
          autoSyncBusyRef.current = false;
        });
      });
  }, [hasSession, loading, online, pendingCount, pendingSyncKey]);

  return (
    <main className="app-shell field-shell">
      <aside className="side-rail">
        <div className="brand-lockup">
          <img src="/logo-vilanova.png" alt="Vila Nova Agroindustrial" />
          <span className="module-badge">App de campo</span>
        </div>

        <nav className="main-nav" aria-label="App de campo">
          <button className={view === "field" ? "active" : ""} onClick={() => setView("field")}>
            <ClipboardPlus aria-hidden="true" />
            Campo
          </button>
          <button className={view === "sync" ? "active" : ""} onClick={() => setView("sync")}>
            <DatabaseZap aria-hidden="true" />
            Fila
            {pendingCount > 0 ? <i>{pendingCount}</i> : null}
          </button>
        </nav>

        <a className="rail-link" href="/dashboard">
          <BarChart3 aria-hidden="true" />
          Abrir dashboard
        </a>

        <div className="rail-status">
          <span className={online ? "dot online" : "dot offline"} />
          {online ? "Online" : "Offline"}
        </div>
      </aside>

      <section className="main-region">
        {loading ? (
          <div className="loading-state">
            <RefreshCw aria-hidden="true" />
            Carregando
          </div>
        ) : null}

        {!loading && view === "field" ? <FieldForm onSaved={refresh} /> : null}
        {!loading && view === "sync" ? (
          <SyncQueue deposits={deposits} online={online} onSynced={refresh} />
        ) : null}
      </section>
    </main>
  );
}

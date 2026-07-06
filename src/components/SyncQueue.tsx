import { useEffect, useMemo, useState } from "react";
import { Database, LogIn, LogOut, RefreshCw, SendHorizonal, Wifi, WifiOff } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { formatDateTime } from "../lib/format";
import { getCurrentSession, supabase, supabaseConfigured } from "../lib/supabase";
import { syncPendingDeposits } from "../lib/sync";
import type { FieldDeposit } from "../types";
import { StatusPill } from "./StatusPill";

interface SyncQueueProps {
  deposits: FieldDeposit[];
  online: boolean;
  onSynced: () => void;
}

export function SyncQueue({ deposits, online, onSynced }: SyncQueueProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [message, setMessage] = useState("");

  const localQueue = useMemo(
    () => deposits.filter((deposit) => deposit.syncStatus !== "synced" && !deposit.demoRecord),
    [deposits],
  );

  useEffect(() => {
    getCurrentSession().then(setSession);

    if (!supabase) {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase) {
      setMessage("Configure o Supabase no arquivo .env.local.");
      return;
    }

    setAuthBusy(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setAuthBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setPassword("");
    setMessage("Usuario conectado.");
  };

  const signOut = async () => {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setMessage("Usuario desconectado.");
  };

  const sync = async () => {
    setSyncBusy(true);
    setMessage("");

    try {
      const result = await syncPendingDeposits();
      setMessage(`${result.synced} registro(s) enviado(s).`);
      onSynced();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao sincronizar.");
      onSynced();
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <section className="sync-view">
      <div className="surface-heading">
        <div>
          <p className="eyebrow">Sincronizacao</p>
          <h1>Fila local</h1>
        </div>
        {online ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      </div>

      <div className="sync-layout">
        <article className="sync-panel">
          <header>
            <Database aria-hidden="true" />
            <h2>Conexao</h2>
          </header>

          <dl className="connection-list">
            <div>
              <dt>Internet</dt>
              <dd>{online ? "Online" : "Offline"}</dd>
            </div>
            <div>
              <dt>Supabase</dt>
              <dd>{supabaseConfigured ? "Configurado" : "Sem ambiente"}</dd>
            </div>
            <div>
              <dt>Usuario</dt>
              <dd>{session?.user.email ?? "Nao conectado"}</dd>
            </div>
          </dl>

          {session ? (
            <button className="ghost-button full-width" onClick={signOut} type="button">
              <LogOut aria-hidden="true" />
              Sair
            </button>
          ) : (
            <form className="auth-form" onSubmit={signIn}>
              <label>
                E-mail
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="usuario@empresa.com"
                  required
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <button className="primary-button full-width" type="submit" disabled={authBusy}>
                <LogIn aria-hidden="true" />
                {authBusy ? "Entrando" : "Entrar"}
              </button>
            </form>
          )}

          <button
            className="primary-button full-width"
            type="button"
            onClick={sync}
            disabled={!online || !supabaseConfigured || !session || syncBusy || localQueue.length === 0}
          >
            {syncBusy ? <RefreshCw aria-hidden="true" /> : <SendHorizonal aria-hidden="true" />}
            {syncBusy ? "Enviando" : "Sincronizar"}
          </button>

          <span className="sync-message">{message}</span>
        </article>

        <article className="queue-panel">
          <header>
            <h2>Registros no aparelho</h2>
            <strong>{localQueue.length}</strong>
          </header>

          <div className="queue-list">
            {localQueue.length === 0 ? (
              <div className="empty-state">Nenhum registro pendente.</div>
            ) : (
              localQueue.map((deposit) => (
                <div className="queue-item" key={deposit.id}>
                  <div>
                    <strong>{deposit.vehiclePlate}</strong>
                    <span>
                      {deposit.farm} | {deposit.plotPrimary}
                      {deposit.plotSecondary ? `/${deposit.plotSecondary}` : ""}
                    </span>
                    <small>{formatDateTime(deposit.createdAt)}</small>
                    {deposit.syncError ? <em>{deposit.syncError}</em> : null}
                  </div>
                  <StatusPill status={deposit.syncStatus} />
                </div>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

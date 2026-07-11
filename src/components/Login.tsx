import { type FormEvent, useEffect, useState } from "react";
import {
  Activity,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  Truck,
  UserRound,
  Wifi,
} from "lucide-react";
import {
  authenticateDashboardUser,
  dashboardErrorMessage,
  isDashboardDemoMode,
  type DashboardUser,
} from "../lib/auth";
import { supabaseConfig } from "../lib/supabase";

interface LoginProps {
  onLogin: (profile: DashboardUser) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [matricula, setMatricula] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canSubmit = Boolean(matricula.trim() && senha.trim() && !loading);

  useEffect(() => {
    document.body.classList.add("login-active");
    return () => document.body.classList.remove("login-active");
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const profile = await authenticateDashboardUser(matricula, senha);
      onLogin(profile);
    } catch (err) {
      setError(dashboardErrorMessage(err, "Não foi possível entrar."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-visual" aria-label="Vila Nova Subprodutos">
        <div className="login-brand">
          <img src="/logo-vilanova.png" alt="Vila Nova Agroindustrial" />
          <div>
            <span>Vila Nova</span>
            <strong>Subprodutos</strong>
          </div>
        </div>

        <div className="login-copy">
          <span className="eyebrow">Painel Subprodutos Online</span>
          <h1>Controle de viagens, despejos e materiais aplicados em campo.</h1>
          <p>
            Acesso operacional para acompanhar motoristas, caminhões, fazendas, parcelas, tickets de balança e
            registros sincronizados do Supabase.
          </p>
        </div>

        <div className="login-preview">
          <div className="login-preview-header">
            <div>
              <span>Operação conectada</span>
              <strong>Campo, balança e Supabase</strong>
            </div>
            <div className="login-live-pill">
              <Wifi aria-hidden="true" />
              Online
            </div>
          </div>

          <div className="login-preview-grid">
            <div>
              <Database aria-hidden="true" />
              <span>Base</span>
              <strong>Supabase</strong>
            </div>
            <div>
              <Truck aria-hidden="true" />
              <span>Controle</span>
              <strong>Viagens</strong>
            </div>
            <div>
              <Activity aria-hidden="true" />
              <span>Destino</span>
              <strong>Parcelas</strong>
            </div>
          </div>
        </div>

        <div className="login-status-grid">
          <div>
            <ShieldCheck aria-hidden="true" />
            <span>Acesso restrito</span>
          </div>
          <div>
            <LockKeyhole aria-hidden="true" />
            <span>Matrícula autorizada</span>
          </div>
        </div>
      </section>

      <section className="login-access-panel" aria-label="Acesso ao dashboard">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-header">
            <div className="login-lock-badge">
              <LockKeyhole aria-hidden="true" />
            </div>
            <span className="eyebrow">Acesso ao dashboard</span>
            <h2>Entrar na central</h2>
            <p>Use a matrícula e senha autorizadas no headcount/Supabase.</p>
          </div>

          <div className="auth-field">
            <label htmlFor="dashboard-matricula">Matrícula</label>
            <div>
              <UserRound aria-hidden="true" />
              <input
                id="dashboard-matricula"
                value={matricula}
                onChange={(event) => setMatricula(event.target.value)}
                inputMode="numeric"
                autoComplete="username"
                placeholder="Ex: 2170"
                required
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="dashboard-senha">Senha</label>
            <div>
              <LockKeyhole aria-hidden="true" />
              <input
                id="dashboard-senha"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Digite sua senha"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
          </div>

          {!supabaseConfig.isConfigured ? (
            <div className="auth-error auth-warning" role="status">
              {isDashboardDemoMode()
                ? "Supabase não configurado. Em desenvolvimento local, qualquer matrícula e senha entram no modo demonstração."
                : "Serviço de dados não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente."}
            </div>
          ) : null}

          {error ? (
            <div className="auth-error" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}

          <button className="primary-button login-submit" type="submit" disabled={!canSubmit}>
            <span>{loading ? "Validando acesso" : "Acessar dashboard"}</span>
            <ChevronRight aria-hidden="true" />
          </button>

          <div className="login-security-strip">
            <ShieldCheck aria-hidden="true" />
            <span>Sessão operacional protegida por matrícula autorizada.</span>
          </div>
        </form>

        <div className="login-footer-note">
          <strong>Vila Nova Agroindustrial</strong>
          <span>Subprodutos · Campo · Balança</span>
        </div>
      </section>
    </main>
  );
}

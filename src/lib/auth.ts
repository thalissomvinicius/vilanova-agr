import { supabase, supabaseConfigured } from "./supabase";

const DASHBOARD_PROFILE_KEY = "vna-subprodutos-dashboard-profile";
const LOCAL_DEMO_SESSION_TOKEN = "local-demo-subprodutos-session";
const LOCAL_DEMO_MODE = !supabaseConfigured && import.meta.env.DEV;

export interface DashboardUser {
  matricula: string;
  nome: string;
  departamento?: string;
  cargo?: string;
  gestor?: string;
  status?: string;
  role: string;
  permissions: string[];
  sessionToken: string | null;
  sessionExpiresAt: string | null;
  email?: string | null;
  authProvider: "rpc" | "demo";
}

function storedProfile() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_PROFILE_KEY);
    window.localStorage.removeItem(DASHBOARD_PROFILE_KEY);
    return raw ? (JSON.parse(raw) as DashboardUser) : null;
  } catch {
    return null;
  }
}

function saveProfile(profile: DashboardUser | null) {
  if (typeof window === "undefined") return;

  if (!profile) {
    window.sessionStorage.removeItem(DASHBOARD_PROFILE_KEY);
    window.localStorage.removeItem(DASHBOARD_PROFILE_KEY);
    return;
  }

  window.sessionStorage.setItem(DASHBOARD_PROFILE_KEY, JSON.stringify(profile));
}

function firstRpcRow(payload: unknown) {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data;
    return Array.isArray(data) ? data[0] ?? null : data;
  }
  return payload;
}

function normalizeProfile(row: unknown, fallbackMatricula: string, provider: DashboardUser["authProvider"]) {
  const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const matricula = String(source.matricula || source.registration || fallbackMatricula || "").trim();
  const nome = String(source.nome || source.name || source.full_name || matricula || "Usuario").trim();
  const permissions = Array.isArray(source.permissions)
    ? source.permissions.map((permission) => String(permission))
    : [];

  return {
    matricula,
    nome,
    departamento: source.departamento ? String(source.departamento) : undefined,
    cargo: source.cargo ? String(source.cargo) : undefined,
    gestor: source.gestor ? String(source.gestor) : undefined,
    status: source.status ? String(source.status) : undefined,
    role: source.role ? String(source.role) : "viewer",
    permissions,
    sessionToken: source.session_token || source.sessionToken ? String(source.session_token || source.sessionToken) : null,
    sessionExpiresAt:
      source.session_expires_at || source.sessionExpiresAt
        ? String(source.session_expires_at || source.sessionExpiresAt)
        : null,
    email: source.email ? String(source.email) : null,
    authProvider: provider,
  } satisfies DashboardUser;
}

function buildLocalDemoProfile(matricula: string) {
  return {
    matricula: matricula || "demo",
    nome: "Demonstração Subprodutos",
    departamento: "Campo",
    cargo: "Operação de Subprodutos",
    role: "admin",
    permissions: ["view_dashboard"],
    sessionToken: LOCAL_DEMO_SESSION_TOKEN,
    sessionExpiresAt: null,
    email: null,
    authProvider: "demo",
  } satisfies DashboardUser;
}

function validateLoginInput(matricula: string, senha: string) {
  const normalizedMatricula = String(matricula || "").trim();
  const normalizedSenha = String(senha || "").trim();

  if (!normalizedMatricula || !normalizedSenha) {
    throw new Error("Informe matricula e senha.");
  }

  return { normalizedMatricula, normalizedSenha };
}

function isMissingRpc(error: unknown) {
  const code = String((error as { code?: string } | null)?.code || "");
  const message = String((error as { message?: string } | null)?.message || error || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("could not find the function") ||
    message.includes("function public.dashboard_authenticate") ||
    message.includes("schema cache")
  );
}

async function authenticateByRpc(matricula: string, senha: string) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("dashboard_authenticate", {
    p_matricula: matricula,
    p_senha: senha,
  });

  if (error) throw error;

  const profile = normalizeProfile(firstRpcRow(data), matricula, "rpc");
  if (!profile.matricula || !profile.sessionToken) return null;
  return profile;
}

export async function authenticateDashboardUser(matricula: string, senha: string) {
  const { normalizedMatricula, normalizedSenha } = validateLoginInput(matricula, senha);

  if (LOCAL_DEMO_MODE) {
    const profile = buildLocalDemoProfile(normalizedMatricula);
    saveProfile(profile);
    return profile;
  }

  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
  }

  try {
    const rpcProfile = await authenticateByRpc(normalizedMatricula, normalizedSenha);
    if (rpcProfile) {
      saveProfile(rpcProfile);
      return rpcProfile;
    }
  } catch (error) {
    if (isMissingRpc(error)) {
      throw new Error("Login seguro por matricula ainda nao instalado no Supabase.");
    }
    throw error;
  }

  throw new Error("Matricula ou senha invalida.");
}

export async function refreshDashboardSession() {
  const saved = storedProfile();

  if (saved?.authProvider === "demo" && LOCAL_DEMO_MODE) {
    return saved;
  }

  if (saved?.sessionToken && saved.authProvider === "rpc" && supabase) {
    try {
      const { data, error } = await supabase.rpc("dashboard_session_profile", {
        p_session_token: saved.sessionToken,
      });
      if (error) throw error;

      const profile = normalizeProfile(firstRpcRow(data), saved.matricula, "rpc");
      const refreshed = { ...profile, sessionToken: saved.sessionToken };
      saveProfile(refreshed);
      return refreshed;
    } catch {
      saveProfile(null);
    }
  }

  saveProfile(null);
  return null;
}

export async function logoutDashboardUser(profile?: DashboardUser | null) {
  if (profile?.sessionToken && profile.authProvider === "rpc" && supabase) {
    try {
      await supabase.rpc("dashboard_logout", { p_session_token: profile.sessionToken });
    } catch {
      // Logout local still needs to continue if the remote session was already expired.
    }
  }

  saveProfile(null);
}

export function dashboardErrorMessage(error: unknown, fallback = "Não foi possível concluir a operação agora.") {
  const rawMessage = String((error as { message?: string } | null)?.message || error || "").trim();
  const normalized = rawMessage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!rawMessage) return fallback;
  if (normalized.includes("informe matricula e senha")) return "Informe matricula e senha.";
  if (normalized.includes("invalid login credentials") || normalized.includes("matricula ou senha invalida")) {
    return "Matricula ou senha invalida.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Usuario encontrado, mas o acesso ainda nao foi confirmado no Supabase.";
  }
  if (normalized.includes("supabase nao configurado") || normalized.includes("vite_supabase")) {
    return "Serviço de dados não configurado. Verifique as variáveis de ambiente.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network error") || normalized.includes("networkerror")) {
    return "Não foi possível conectar ao serviço de dados. Tente novamente em instantes.";
  }
  if (normalized.includes("http ") || normalized.includes("pgrst")) {
    return "Não foi possível validar o acesso agora. Tente novamente em instantes.";
  }

  return fallback;
}

export function isDashboardDemoMode() {
  return LOCAL_DEMO_MODE;
}

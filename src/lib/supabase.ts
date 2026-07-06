import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabaseAuthEmailDomain =
  (import.meta.env.VITE_SUPABASE_AUTH_EMAIL_DOMAIN as string | undefined) || "vilanova.local";

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabaseConfig = {
  url: supabaseUrl || "",
  anonKey: supabaseAnonKey || "",
  authEmailDomain: supabaseAuthEmailDomain,
  isConfigured: supabaseConfigured,
};

export function supabaseAuthEmailFromLogin(login: string) {
  const normalizedLogin = login.trim();
  if (normalizedLogin.includes("@")) return normalizedLogin;
  return `${normalizedLogin}@${supabaseAuthEmailDomain}`;
}

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function getCurrentSession(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }

  const { data } = await supabase.auth.getSession();
  return data.session;
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const attachmentBucket = "mobile-anexos";
const maxUploadBytes = 8 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-mobile-session, x-storage-path",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function cleanPath(value: string | null) {
  const path = String(value ?? "").trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\") || path.length > 500) return "";
  return path;
}

async function mobileOwner(sessionToken: string) {
  if (!sessionToken) return "";
  const { data, error } = await admin.rpc("mobile_session_profile", {
    p_session_token: sessionToken,
  });
  if (error) throw error;
  const profile = Array.isArray(data) ? data[0] : data;
  return String(profile?.matricula ?? "").trim();
}

async function dashboardAuthorized(sessionToken: string, authorization: string | null) {
  if (sessionToken) {
    const { data, error } = await admin.rpc("dashboard_session_profile", {
      p_session_token: sessionToken,
    });
    if (!error && Array.isArray(data) && data.length > 0) return true;
    if (!error && data && !Array.isArray(data)) return true;
  }

  const bearer = String(authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer || bearer === serviceRoleKey) return false;
  const { data, error } = await admin.auth.getUser(bearer);
  return !error && Boolean(data.user);
}

async function handleUpload(request: Request) {
  const sessionToken = request.headers.get("x-mobile-session") ?? "";
  const owner = await mobileOwner(sessionToken);
  if (!owner) return json(401, { error: "Sessao mobile invalida ou expirada." });

  const storagePath = cleanPath(request.headers.get("x-storage-path"));
  if (!storagePath || !storagePath.startsWith(`${owner}/`)) {
    return json(403, { error: "Caminho do anexo nao pertence ao usuario autenticado." });
  }

  const contentType = String(request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!allowedImageTypes.has(contentType)) {
    return json(415, { error: "Formato de imagem nao permitido." });
  }

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > maxUploadBytes) {
    return json(413, { error: "Imagem acima do limite de 8 MB." });
  }

  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > maxUploadBytes) {
    return json(body.byteLength ? 413 : 400, {
      error: body.byteLength ? "Imagem acima do limite de 8 MB." : "Imagem vazia.",
    });
  }

  const { error } = await admin.storage.from(attachmentBucket).upload(storagePath, body, {
    contentType,
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw error;

  return json(200, { uploaded: true, storage_path: storagePath, size: body.byteLength });
}

async function handlePhotoUrl(request: Request) {
  const payload = await request.json().catch(() => ({})) as {
    sessionToken?: string;
    storagePath?: string;
  };

  const authorized = await dashboardAuthorized(
    String(payload.sessionToken ?? ""),
    request.headers.get("authorization"),
  );
  if (!authorized) return json(401, { error: "Sessao do dashboard invalida ou expirada." });

  const storagePath = cleanPath(payload.storagePath ?? "");
  if (!storagePath) return json(400, { error: "Caminho da foto invalido." });

  const { data, error } = await admin.storage.from(attachmentBucket).createSignedUrl(storagePath, 300);
  if (error) throw error;

  return json(200, { signedUrl: data.signedUrl, expiresIn: 300 });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, "");

    if (request.method === "GET" && pathname.endsWith("/health")) {
      return json(200, { ok: true, service: "vna-mobile-api" });
    }
    if (request.method === "POST" && pathname.endsWith("/upload")) {
      return await handleUpload(request);
    }
    if (request.method === "POST" && pathname.endsWith("/photo-url")) {
      return await handlePhotoUrl(request);
    }

    return json(404, { error: "Rota nao encontrada." });
  } catch (error) {
    console.error("vna-mobile-api", error instanceof Error ? error.message : "erro inesperado");
    return json(500, { error: "Falha interna ao processar a solicitacao." });
  }
});

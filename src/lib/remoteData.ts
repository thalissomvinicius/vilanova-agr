import { supabase, supabaseConfig, supabaseConfigured } from "./supabase";
import type { DashboardUser } from "./auth";
import type { FieldDeposit, LoadingOrigin, PlacementMode, ReviewStatus, ScaleTicket, Subproduct } from "../types";

interface RemoteDashboardData {
  deposits: FieldDeposit[];
  scaleTickets: ScaleTicket[];
  source: "dashboard-rpc";
}

type RemoteRow = Record<string, unknown>;
const ATTACHMENT_BUCKET = "mobile-anexos";
const PHOTO_FUNCTION_PATH = "/functions/v1/vna-mobile-api/photo-url";

function text(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function storagePathFromUrl(value: unknown) {
  const raw = text(value);
  if (!raw || raw.startsWith("data:") || raw.startsWith("file:")) return "";
  if (!raw.startsWith("http") && raw.includes("/")) return raw;

  const markers = [
    `/storage/v1/object/${ATTACHMENT_BUCKET}/`,
    `/storage/v1/object/sign/${ATTACHMENT_BUCKET}/`,
  ];

  const marker = markers.find((candidate) => raw.includes(candidate));
  if (!marker) return "";

  const afterMarker = raw.slice(raw.indexOf(marker) + marker.length).split("?")[0];
  return afterMarker.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join("/");
}

async function signedStorageUrl(pathOrUrl: unknown, user: DashboardUser) {
  if (!supabase) return "";

  const storagePath = storagePathFromUrl(pathOrUrl);
  if (!storagePath) return text(pathOrUrl);

  if (user.sessionToken && supabaseConfig.url && supabaseConfig.anonKey) {
    try {
      const response = await fetch(`${supabaseConfig.url}${PHOTO_FUNCTION_PATH}`, {
        method: "POST",
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: `Bearer ${supabaseConfig.anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionToken: user.sessionToken, storagePath }),
      });
      if (response.ok) {
        const payload = await response.json() as { signedUrl?: string };
        if (payload.signedUrl) return payload.signedUrl;
      }
    } catch {
      return "";
    }
  }
  return "";
}

function numberValue(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function dateValue(value: unknown) {
  const raw = text(value);
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function timeValue(value: unknown) {
  const raw = text(value);
  if (!raw) return "00:00";
  if (/^\d{2}:\d{2}/.test(raw)) return raw.slice(0, 5);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toTimeString().slice(0, 5) : "00:00";
}

function isoDateTime(value: unknown, fallbackDate: string, fallbackTime = "00:00") {
  const raw = text(value);
  if (!raw) return new Date(`${fallbackDate}T${fallbackTime}:00`).toISOString();

  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return new Date(`${fallbackDate}T${fallbackTime}:00`).toISOString();
}

function placementMode(value: unknown): PlacementMode {
  return text(value) === "between_plots" ? "between_plots" : "single_plot";
}

function normalizeSubproduct(value: unknown): Subproduct {
  return (text(value, "Outros") || "Outros") as Subproduct;
}

function normalizeOrigin(value: unknown): LoadingOrigin {
  return (text(value, "Extratora") || "Extratora") as LoadingOrigin;
}

function normalizeReviewStatus(value: unknown): ReviewStatus {
  const status = text(value, "pending");
  if (status === "approved" || status === "rejected") return status;
  return "pending";
}

function mapDeposit(row: RemoteRow): FieldDeposit {
  const depositDate = dateValue(row.deposit_date);
  const depositTime = timeValue(row.deposit_time);
  const createdAt = isoDateTime(row.created_at, depositDate, depositTime);
  const updatedAt = isoDateTime(row.updated_at, depositDate, depositTime);
  const id = text(row.id, crypto.randomUUID());

  return {
    id,
    driverRegistration: text(row.driver_registration),
    driverName: text(row.driver_name, text(row.driver_registration)),
    vehiclePlate: text(row.vehicle_plate).toUpperCase(),
    subproduct: normalizeSubproduct(row.subproduct),
    loadingOrigin: normalizeOrigin(row.loading_origin),
    scaleTicketCode: text(row.field_ticket_code || row.scale_ticket_code || row.ticket_code),
    farm: text(row.farm),
    placementMode: placementMode(row.placement_mode),
    plotPrimary: text(row.plot_primary),
    plotSecondary: text(row.plot_secondary),
    depositDate,
    depositTime,
    latitude: numberValue(row.latitude),
    longitude: numberValue(row.longitude),
    locationAccuracy: numberValue(row.location_accuracy),
    dumpPhotoDataUrl: text(row.dump_photo_data_url) || null,
    dumpPhotoName: text(row.dump_photo_name) || null,
    dumpPhotoLatitude: numberValue(row.dump_photo_latitude),
    dumpPhotoLongitude: numberValue(row.dump_photo_longitude),
    dumpPhotoAccuracy: numberValue(row.dump_photo_accuracy),
    dumpPhotoCapturedAt: text(row.dump_photo_captured_at) || null,
    notes: text(row.notes),
    createdAt,
    updatedAt,
    syncStatus: "synced",
    syncError: null,
    syncedAt: isoDateTime(row.client_synced_at || row.updated_at || row.created_at, depositDate, depositTime),
    reviewStatus: normalizeReviewStatus(row.review_status),
    reviewNotes: text(row.review_notes) || null,
    reviewedAt: text(row.reviewed_at) || null,
    reviewedByLabel: text(row.reviewed_by_label) || null,
  };
}

function mapTicket(row: RemoteRow, deposit: FieldDeposit): ScaleTicket | null {
  const ticketCode = text(row.ticket_code || row.field_ticket_code || row.scale_ticket_code);
  const grossWeightKg = numberValue(row.gross_weight_kg);
  const tareWeightKg = numberValue(row.tare_weight_kg);
  const netWeightKg = numberValue(row.net_weight_kg);

  if (!ticketCode || netWeightKg === null) return null;

  const departureAt = isoDateTime(row.departure_at, deposit.depositDate, deposit.depositTime);
  const returnAt = row.return_at
    ? isoDateTime(row.return_at, deposit.depositDate, deposit.depositTime)
    : departureAt;

  return {
    id: text(row.scale_ticket_id || row.ticket_id, `ticket-${ticketCode}-${deposit.id}`),
    fieldDepositId: deposit.id,
    ticketCode,
    driverRegistration: text(row.ticket_driver_registration || row.driver_registration, deposit.driverRegistration),
    driverName: text(row.ticket_driver_name || row.driver_name, deposit.driverName),
    vehiclePlate: text(row.ticket_vehicle_plate || row.vehicle_plate, deposit.vehiclePlate).toUpperCase(),
    subproduct: normalizeSubproduct(row.ticket_subproduct || row.subproduct),
    grossWeightKg: grossWeightKg ?? netWeightKg,
    tareWeightKg: tareWeightKg ?? 0,
    netWeightKg,
    departureAt,
    returnAt,
  };
}

function normalizeRows(payload: unknown): RemoteRow[] {
  if (Array.isArray(payload)) return payload as RemoteRow[];
  if (!payload || typeof payload !== "object") return [];

  const source = payload as Record<string, unknown>;
  const candidates = [
    source.rows,
    source.field_deposits,
    source.subproducts,
    source.vw_dashboard_subprodutos,
    source.dashboard_subproduct_snapshot,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RemoteRow[];
  }

  return [];
}

function mapRows(rows: RemoteRow[], source: RemoteDashboardData["source"]): RemoteDashboardData {
  const deposits: FieldDeposit[] = [];
  const ticketById = new Map<string, ScaleTicket>();

  rows.forEach((row) => {
    const deposit = mapDeposit(row);
    if (!deposit.farm || !deposit.plotPrimary) return;

    deposits.push(deposit);
    const ticket = mapTicket(row, deposit);
    if (ticket) ticketById.set(ticket.id, ticket);
  });

  return {
    deposits,
    scaleTickets: Array.from(ticketById.values()),
    source,
  };
}

async function signPhotoUrls(rows: RemoteRow[], user: DashboardUser) {
  return Promise.all(rows.map(async (row) => {
    const storagePath = text(row.dump_photo_storage_path);
    const photoUrl = text(row.dump_photo_data_url);
    const signedUrl = storagePath
      ? await signedStorageUrl(storagePath, user)
      : await signedStorageUrl(photoUrl, user);

    if (!signedUrl || signedUrl === photoUrl) return row;
    return { ...row, dump_photo_data_url: signedUrl };
  }));
}

async function loadFromDashboardRpc(user: DashboardUser) {
  if (!supabase || !user.sessionToken) return null;

  const { data, error } = await supabase.rpc("dashboard_subproduct_snapshot", {
    p_session_token: user.sessionToken,
  });

  if (error) throw error;
  return mapRows(await signPhotoUrls(normalizeRows(data), user), "dashboard-rpc");
}

export async function loadRemoteDashboardData(user: DashboardUser) {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado no ambiente do dashboard.");
  }

  try {
    const rpcData = await loadFromDashboardRpc(user);
    if (rpcData) return rpcData;
  } catch (error) {
    throw new Error(`Nao foi possivel carregar os dados do Supabase. ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error("A sessao do dashboard nao retornou dados.");
}

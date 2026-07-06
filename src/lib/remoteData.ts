import { supabase, supabaseConfigured } from "./supabase";
import type { DashboardUser } from "./auth";
import type { FieldDeposit, LoadingOrigin, PlacementMode, ScaleTicket, Subproduct } from "../types";

interface RemoteDashboardData {
  deposits: FieldDeposit[];
  scaleTickets: ScaleTicket[];
  source: "supabase-view" | "dashboard-rpc";
}

type RemoteRow = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
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

async function loadFromView() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("vw_dashboard_subprodutos")
    .select("*")
    .order("deposit_date", { ascending: false })
    .limit(1200);

  if (error) throw error;
  return mapRows(normalizeRows(data), "supabase-view");
}

async function loadFromDashboardRpc(user: DashboardUser) {
  if (!supabase || !user.sessionToken) return null;

  const { data, error } = await supabase.rpc("dashboard_subproduct_snapshot", {
    p_session_token: user.sessionToken,
  });

  if (error) throw error;
  return mapRows(normalizeRows(data), "dashboard-rpc");
}

export async function loadRemoteDashboardData(user: DashboardUser) {
  if (!supabaseConfigured || !supabase) return null;

  try {
    const viewData = await loadFromView();
    if (viewData && viewData.deposits.length > 0) return viewData;
  } catch {
    // The authenticated-RLS path is not always available when the dashboard uses matricula RPC sessions.
  }

  try {
    const rpcData = await loadFromDashboardRpc(user);
    if (rpcData && rpcData.deposits.length > 0) return rpcData;
  } catch {
    return null;
  }

  return null;
}

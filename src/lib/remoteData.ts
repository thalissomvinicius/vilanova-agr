import { supabase, supabaseConfigured } from "./supabase";
import type { DashboardUser } from "./auth";
import type { FieldDeposit, LoadingOrigin, PlacementMode, ReviewStatus, ScaleTicket, Subproduct } from "../types";

interface RemoteDashboardData {
  deposits: FieldDeposit[];
  scaleTickets: ScaleTicket[];
  source: "supabase-view" | "dashboard-rpc" | "mobile-responses";
}

type RemoteRow = Record<string, unknown>;
type MobileResponseRow = Record<string, unknown>;

const SUBPRODUCT_FORM_ID = "form_subprodutos_despejo";

function text(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function valueFromObject(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return value === null || value === undefined ? "" : value;
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

function reviewStatusFromMobile(value: unknown): ReviewStatus {
  const status = text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (status.includes("aprov")) return "approved";
  if (status.includes("reprov") || status.includes("exclu")) return "rejected";
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

function gpsObject(value: unknown) {
  const gps = objectValue(value);
  const latitude = numberValue(gps.latitude);
  const longitude = numberValue(gps.longitude);

  if (latitude === null || longitude === null) {
    return { latitude: null, longitude: null, accuracy: null, capturedAt: null };
  }

  return {
    latitude,
    longitude,
    accuracy: numberValue(gps.precisao ?? gps.accuracy),
    capturedAt: text(gps.capturado_em || gps.capturedAt) || null,
  };
}

function mobileResponseToDashboardRow(row: MobileResponseRow): RemoteRow | null {
  const status = text(row.status);
  if (status === "excluido") return null;

  const responseId = text(row.id);
  const dados = objectValue(row.dados_json);
  if (!responseId || text(row.formulario_id) !== SUBPRODUCT_FORM_ID) return null;

  const subproductOption = text(valueFromObject(dados, "subproduto"));
  const subproductOther = text(valueFromObject(dados, "subproduto_outro"));
  const originOption = text(valueFromObject(dados, "origem_carregamento"));
  const originOther = text(valueFromObject(dados, "origem_carregamento_outro"));
  const farmOption = text(valueFromObject(dados, "nome_fazenda"));
  const farmOther = text(valueFromObject(dados, "nome_fazenda_outro"));
  const placementLabel = text(valueFromObject(dados, "tipo_despejo"));
  const gps = gpsObject(valueFromObject(dados, "gps_despejo"));
  const photo = objectValue(valueFromObject(dados, "foto_despejo"));
  const photoGps = gpsObject(photo.gps || photo.gpsStamp);
  const observation = valueFromObject(dados, "observacao");

  return {
    id: `mobile:${responseId}`,
    source_response_id: responseId,
    driver_registration: text(valueFromObject(dados, "matricula_motorista")),
    driver_name: text(valueFromObject(dados, "nome_motorista")),
    vehicle_plate: text(valueFromObject(dados, "placa_veiculo")).toUpperCase(),
    subproduct: subproductOption === "Outras" ? subproductOther : subproductOption,
    loading_origin: originOption === "Outras" ? originOther : originOption,
    scale_ticket_code: text(valueFromObject(dados, "ticket_balanca")).toUpperCase(),
    farm: farmOption === "OUTRAS" ? farmOther : farmOption,
    placement_mode: placementLabel === "Entre parcelas" ? "between_plots" : "single_plot",
    plot_primary: text(valueFromObject(dados, "parcela_principal") || valueFromObject(dados, "parcela")).toUpperCase(),
    plot_secondary: placementLabel === "Entre parcelas" ? text(valueFromObject(dados, "parcela_destino_2")).toUpperCase() : "",
    deposit_date: text(valueFromObject(dados, "data_registro")),
    deposit_time: text(valueFromObject(dados, "hora_despejo")),
    latitude: gps.latitude,
    longitude: gps.longitude,
    location_accuracy: gps.accuracy,
    dump_photo_data_url: text(photo.uri).startsWith("http") ? text(photo.uri) : null,
    dump_photo_name: text(photo.nome_arquivo || photo.fileName),
    dump_photo_latitude: photoGps.latitude,
    dump_photo_longitude: photoGps.longitude,
    dump_photo_accuracy: photoGps.accuracy,
    dump_photo_captured_at: photoGps.capturedAt || text(photo.capturedAt) || null,
    notes: typeof observation === "object" ? text(objectValue(observation).texto) : text(observation),
    review_status: reviewStatusFromMobile(row.status),
    created_at: row.criado_em,
    updated_at: row.updated_at || row.enviado_em || row.criado_em,
    client_synced_at: row.enviado_em || row.updated_at || row.criado_em,
  };
}

async function ensureMobileRowsInFieldDeposits(rows: RemoteRow[]) {
  if (!supabase || rows.length === 0) return;

  const p_rows = rows.map((row) => ({
    source_response_id: row.source_response_id,
    driver_registration: row.driver_registration,
    driver_name: row.driver_name,
    vehicle_plate: row.vehicle_plate,
    subproduct: row.subproduct,
    loading_origin: row.loading_origin,
    scale_ticket_code: row.scale_ticket_code,
    farm: row.farm,
    placement_mode: row.placement_mode,
    plot_primary: row.plot_primary,
    plot_secondary: row.plot_secondary,
    deposit_date: row.deposit_date,
    deposit_time: row.deposit_time,
    latitude: row.latitude,
    longitude: row.longitude,
    location_accuracy: row.location_accuracy,
    dump_photo_data_url: row.dump_photo_data_url,
    dump_photo_name: row.dump_photo_name,
    dump_photo_latitude: row.dump_photo_latitude,
    dump_photo_longitude: row.dump_photo_longitude,
    dump_photo_accuracy: row.dump_photo_accuracy,
    dump_photo_captured_at: row.dump_photo_captured_at,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_synced_at: row.client_synced_at,
  }));

  await supabase.rpc("mobile_sync_subproduct_deposits", { p_rows });
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

async function loadFromMobileResponses() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("mobile_respostas")
    .select("id, formulario_id, usuario_id, dados_json, status, criado_em, enviado_em, updated_at")
    .eq("formulario_id", SUBPRODUCT_FORM_ID)
    .neq("status", "excluido")
    .order("criado_em", { ascending: false })
    .limit(500);

  if (error) throw error;

  const rows = (Array.isArray(data) ? data : [])
    .map((row) => mobileResponseToDashboardRow(row as MobileResponseRow))
    .filter((row): row is RemoteRow => Boolean(row));

  try {
    await ensureMobileRowsInFieldDeposits(rows);
  } catch {
    // The fallback still shows received field records even when the bridge is unavailable.
  }

  return mapRows(rows, "mobile-responses");
}

export async function loadRemoteDashboardData(user: DashboardUser) {
  if (!supabaseConfigured || !supabase) return null;

  try {
    const viewData = await loadFromView();
    if (viewData?.deposits.length) return viewData;
  } catch {
    // The authenticated-RLS path is not always available when the dashboard uses matricula RPC sessions.
  }

  try {
    const rpcData = await loadFromDashboardRpc(user);
    if (rpcData?.deposits.length) return rpcData;
  } catch {
    // Fall back to mobile_respostas below.
  }

  try {
    const mobileData = await loadFromMobileResponses();
    if (mobileData) return mobileData;
  } catch {
    return null;
  }

  return null;
}

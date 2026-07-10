import type { DashboardUser } from "./auth";
import { supabase, supabaseConfigured } from "./supabase";
import type { FieldDepositEditValues, ReviewStatus } from "../types";

export interface ReviewResult {
  id: string;
  reviewStatus: ReviewStatus;
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedByLabel: string | null;
}

export interface DeleteDepositResult {
  id: string;
}

export interface UpdateDepositResult extends FieldDepositEditValues {
  id: string;
  updatedAt: string | null;
}

function normalizeReviewStatus(value: unknown): ReviewStatus {
  if (value === "approved" || value === "rejected") return value;
  return "pending";
}

function mapReviewResult(row: Record<string, unknown>, fallbackStatus: ReviewStatus): ReviewResult {
  return {
    id: String(row.id || ""),
    reviewStatus: normalizeReviewStatus(row.review_status || fallbackStatus),
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewedByLabel: row.reviewed_by_label ? String(row.reviewed_by_label) : null,
  };
}

function isMissingRpcError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | null)?.message || error || "");

  return message.includes("PGRST202")
    || message.toLowerCase().includes("could not find the function")
    || message.toLowerCase().includes("function public.dashboard_delete_subproduct_deposit")
    || message.toLowerCase().includes("function public.dashboard_update_subproduct_deposit");
}

function text(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapUpdateResult(row: Record<string, unknown>, fallback: FieldDepositEditValues): UpdateDepositResult {
  return {
    id: text(row.id),
    driverRegistration: text(row.driver_registration, fallback.driverRegistration),
    driverName: text(row.driver_name, fallback.driverName),
    vehiclePlate: text(row.vehicle_plate, fallback.vehiclePlate).toUpperCase(),
    subproduct: text(row.subproduct, fallback.subproduct),
    loadingOrigin: text(row.loading_origin, fallback.loadingOrigin),
    scaleTicketCode: text(row.scale_ticket_code, fallback.scaleTicketCode),
    farm: text(row.farm, fallback.farm),
    placementMode: row.placement_mode === "between_plots" ? "between_plots" : "single_plot",
    plotPrimary: text(row.plot_primary, fallback.plotPrimary),
    plotSecondary: text(row.plot_secondary, fallback.plotSecondary),
    depositDate: text(row.deposit_date, fallback.depositDate).slice(0, 10),
    depositTime: text(row.deposit_time, fallback.depositTime).slice(0, 5),
    latitude: numberValue(row.latitude),
    longitude: numberValue(row.longitude),
    locationAccuracy: numberValue(row.location_accuracy),
    notes: text(row.notes, fallback.notes),
    updatedAt: text(row.updated_at) || null,
  };
}

function toDatabasePatch(values: FieldDepositEditValues) {
  return {
    driver_registration: values.driverRegistration.trim(),
    driver_name: values.driverName.trim(),
    vehicle_plate: values.vehiclePlate.trim().toUpperCase(),
    subproduct: values.subproduct.trim(),
    loading_origin: values.loadingOrigin.trim(),
    scale_ticket_code: values.scaleTicketCode.trim(),
    farm: values.farm.trim(),
    placement_mode: values.placementMode,
    plot_primary: values.plotPrimary.trim(),
    plot_secondary: values.placementMode === "between_plots" ? values.plotSecondary.trim() : "",
    deposit_date: values.depositDate,
    deposit_time: values.depositTime,
    latitude: values.latitude,
    longitude: values.longitude,
    location_accuracy: values.locationAccuracy,
    notes: values.notes.trim(),
  };
}

async function resolveFieldDepositId(depositId: string) {
  if (!depositId.startsWith("mobile:")) return depositId;
  if (!supabase) return depositId;

  const sourceResponseId = depositId.slice("mobile:".length);
  const { data, error } = await supabase.rpc("mobile_subproduct_uuid", {
    p_source_response_id: sourceResponseId,
  });

  if (error) throw error;
  return String(data || depositId);
}

async function reviewBySessionRpc(
  user: DashboardUser,
  depositId: string,
  status: ReviewStatus,
  notes: string | null,
) {
  if (!supabase || !user.sessionToken) return null;

  const { data, error } = await supabase.rpc("dashboard_review_subproduct_deposit", {
    p_session_token: user.sessionToken,
    p_deposit_id: depositId,
    p_review_status: status,
    p_review_notes: notes,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? mapReviewResult(row as Record<string, unknown>, status) : null;
}

async function reviewBySupabaseAuth(
  user: DashboardUser,
  depositId: string,
  status: ReviewStatus,
  notes: string | null,
) {
  if (!supabase) return null;

  const reviewedAt = status === "pending" ? null : new Date().toISOString();
  const reviewedByLabel = status === "pending" ? null : `${user.nome} (${user.matricula})`;

  const { data, error } = await supabase
    .from("field_deposits")
    .update({
      review_status: status,
      review_notes: notes,
      reviewed_at: reviewedAt,
      reviewed_by_label: reviewedByLabel,
    })
    .eq("id", depositId)
    .select("id, review_status, review_notes, reviewed_at, reviewed_by_label")
    .single();

  if (error) throw error;
  return data ? mapReviewResult(data as Record<string, unknown>, status) : null;
}

export async function reviewFieldDeposit(
  user: DashboardUser,
  depositId: string,
  status: ReviewStatus,
  notes: string | null = null,
) {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  const resolvedDepositId = await resolveFieldDepositId(depositId);

  if (user.sessionToken) {
    try {
      const result = await reviewBySessionRpc(user, resolvedDepositId, status, notes);
      if (result) return result;
    } catch {
      // Projects without the dashboard RPC use the native Supabase Auth path below.
    }
  }

  const result = await reviewBySupabaseAuth(user, resolvedDepositId, status, notes);
  if (!result) throw new Error("Nao foi possivel atualizar a validacao da coleta.");
  return result;
}

async function deleteBySessionRpc(user: DashboardUser, depositId: string) {
  if (!supabase || !user.sessionToken) return null;

  const { data, error } = await supabase.rpc("dashboard_delete_subproduct_deposit", {
    p_session_token: user.sessionToken,
    p_deposit_id: depositId,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;

  return {
    id: String((row as Record<string, unknown>).id || depositId),
  };
}

async function deleteBySupabaseAuth(depositId: string) {
  if (!supabase) return null;

  const linkResult = await supabase
    .from("scale_tickets")
    .update({ field_deposit_id: null })
    .eq("field_deposit_id", depositId);

  if (linkResult.error) throw linkResult.error;

  const { data, error } = await supabase
    .from("field_deposits")
    .delete()
    .eq("id", depositId)
    .select("id")
    .single();

  if (error) throw error;
  return data ? { id: String((data as Record<string, unknown>).id || depositId) } : null;
}

export async function deleteFieldDeposit(
  user: DashboardUser,
  depositId: string,
): Promise<DeleteDepositResult> {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  const resolvedDepositId = await resolveFieldDepositId(depositId);

  if (user.sessionToken) {
    try {
      const result = await deleteBySessionRpc(user, resolvedDepositId);
      if (result) return result;
    } catch (error) {
      if (!isMissingRpcError(error)) throw error;
      // Projects without the delete RPC use the native Supabase Auth path below.
    }
  }

  const result = await deleteBySupabaseAuth(resolvedDepositId);
  if (!result) throw new Error("Nao foi possivel excluir a coleta.");
  return result;
}

async function updateBySessionRpc(
  user: DashboardUser,
  depositId: string,
  values: FieldDepositEditValues,
) {
  if (!supabase || !user.sessionToken) return null;

  const { data, error } = await supabase.rpc("dashboard_update_subproduct_deposit", {
    p_session_token: user.sessionToken,
    p_deposit_id: depositId,
    p_patch: toDatabasePatch(values),
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object"
    ? mapUpdateResult(row as Record<string, unknown>, values)
    : null;
}

async function updateBySupabaseAuth(
  depositId: string,
  values: FieldDepositEditValues,
) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("field_deposits")
    .update({
      ...toDatabasePatch(values),
      updated_at: new Date().toISOString(),
    })
    .eq("id", depositId)
    .select(`
      id,
      driver_registration,
      driver_name,
      vehicle_plate,
      subproduct,
      loading_origin,
      scale_ticket_code,
      farm,
      placement_mode,
      plot_primary,
      plot_secondary,
      deposit_date,
      deposit_time,
      latitude,
      longitude,
      location_accuracy,
      notes,
      updated_at
    `)
    .single();

  if (error) throw error;
  return data ? mapUpdateResult(data as Record<string, unknown>, values) : null;
}

export async function updateFieldDeposit(
  user: DashboardUser,
  depositId: string,
  values: FieldDepositEditValues,
): Promise<UpdateDepositResult> {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  const resolvedDepositId = await resolveFieldDepositId(depositId);

  if (user.sessionToken) {
    try {
      const result = await updateBySessionRpc(user, resolvedDepositId, values);
      if (result) return result;
    } catch (error) {
      if (!isMissingRpcError(error)) throw error;
      // Projects without the update RPC use the native Supabase Auth path below.
    }
  }

  const result = await updateBySupabaseAuth(resolvedDepositId, values);
  if (!result) throw new Error("Nao foi possivel editar a coleta.");
  return result;
}

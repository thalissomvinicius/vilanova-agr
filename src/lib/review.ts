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

export async function reviewFieldDeposit(
  user: DashboardUser,
  depositId: string,
  status: ReviewStatus,
  notes: string | null = null,
) {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  if (!user.sessionToken) throw new Error("Sessao segura do dashboard ausente.");
  const result = await reviewBySessionRpc(user, depositId, status, notes);
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

export async function deleteFieldDeposit(
  user: DashboardUser,
  depositId: string,
): Promise<DeleteDepositResult> {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  if (!user.sessionToken) throw new Error("Sessao segura do dashboard ausente.");
  const result = await deleteBySessionRpc(user, depositId);
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

export async function updateFieldDeposit(
  user: DashboardUser,
  depositId: string,
  values: FieldDepositEditValues,
): Promise<UpdateDepositResult> {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  if (!user.sessionToken) throw new Error("Sessao segura do dashboard ausente.");
  const result = await updateBySessionRpc(user, depositId, values);
  if (!result) throw new Error("Nao foi possivel editar a coleta.");
  return result;
}

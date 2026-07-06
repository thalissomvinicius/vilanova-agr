import type { DashboardUser } from "./auth";
import { supabase, supabaseConfigured } from "./supabase";
import type { ReviewStatus } from "../types";

export interface ReviewResult {
  id: string;
  reviewStatus: ReviewStatus;
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedByLabel: string | null;
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

  if (user.sessionToken) {
    try {
      const result = await reviewBySessionRpc(user, depositId, status, notes);
      if (result) return result;
    } catch {
      // Projects without the dashboard RPC use the native Supabase Auth path below.
    }
  }

  const result = await reviewBySupabaseAuth(user, depositId, status, notes);
  if (!result) throw new Error("Nao foi possivel atualizar a validacao da coleta.");
  return result;
}

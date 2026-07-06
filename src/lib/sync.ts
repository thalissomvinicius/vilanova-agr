import { getCurrentSession, supabase, supabaseConfigured } from "./supabase";
import { getPendingDeposits, updateDepositSyncState } from "./localStore";
import type { FieldDeposit } from "../types";

function toSupabaseRow(deposit: FieldDeposit) {
  return {
    id: deposit.id,
    driver_registration: deposit.driverRegistration,
    driver_name: deposit.driverName,
    vehicle_plate: deposit.vehiclePlate,
    subproduct: deposit.subproduct,
    loading_origin: deposit.loadingOrigin || null,
    scale_ticket_code: deposit.scaleTicketCode || null,
    farm: deposit.farm,
    placement_mode: deposit.placementMode,
    plot_primary: deposit.plotPrimary,
    plot_secondary: deposit.plotSecondary || null,
    deposit_date: deposit.depositDate,
    deposit_time: deposit.depositTime,
    latitude: deposit.latitude,
    longitude: deposit.longitude,
    location_accuracy: deposit.locationAccuracy,
    dump_photo_data_url: deposit.dumpPhotoDataUrl || null,
    dump_photo_name: deposit.dumpPhotoName || null,
    dump_photo_latitude: deposit.dumpPhotoLatitude ?? null,
    dump_photo_longitude: deposit.dumpPhotoLongitude ?? null,
    dump_photo_accuracy: deposit.dumpPhotoAccuracy ?? null,
    dump_photo_captured_at: deposit.dumpPhotoCapturedAt || null,
    notes: deposit.notes || null,
    created_at: deposit.createdAt,
    updated_at: deposit.updatedAt,
    client_synced_at: new Date().toISOString(),
  };
}

export async function syncPendingDeposits() {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
  }

  const session = await getCurrentSession();

  if (!session) {
    throw new Error("Entre com um usuario Supabase antes de sincronizar.");
  }

  const pendingDeposits = await getPendingDeposits();

  if (pendingDeposits.length === 0) {
    return {
      synced: 0,
      failed: 0,
    };
  }

  await Promise.all(pendingDeposits.map((deposit) => updateDepositSyncState(deposit.id, "syncing")));

  const rows = pendingDeposits.map(toSupabaseRow);
  const { error } = await supabase.from("field_deposits").upsert(rows, {
    onConflict: "id",
  });

  if (error) {
    await Promise.all(
      pendingDeposits.map((deposit) => updateDepositSyncState(deposit.id, "error", error.message)),
    );
    throw error;
  }

  await Promise.all(pendingDeposits.map((deposit) => updateDepositSyncState(deposit.id, "synced")));

  return {
    synced: pendingDeposits.length,
    failed: 0,
  };
}

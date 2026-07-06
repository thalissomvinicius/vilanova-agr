import { openDB, type DBSchema } from "idb";
import { demoDeposits, demoScaleTickets } from "./demoData";
import type { FieldDeposit, ScaleTicket, SyncStatus } from "../types";

interface AgroDb extends DBSchema {
  deposits: {
    key: string;
    value: FieldDeposit;
    indexes: {
      "by-sync": SyncStatus;
      "by-date": string;
    };
  };
  scaleTickets: {
    key: string;
    value: ScaleTicket;
    indexes: {
      "by-ticket": string;
      "by-vehicle": string;
    };
  };
  meta: {
    key: string;
    value: {
      key: string;
      value: string;
    };
  };
}

const DB_NAME = "vila-nova-subprodutos";
const DB_VERSION = 1;
const DEMO_SEED_VERSION = "dashboard-subprodutos-v8-frota-real";

async function getDb() {
  return openDB<AgroDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const depositStore = db.createObjectStore("deposits", { keyPath: "id" });
      depositStore.createIndex("by-sync", "syncStatus");
      depositStore.createIndex("by-date", "depositDate");

      const scaleStore = db.createObjectStore("scaleTickets", { keyPath: "id" });
      scaleStore.createIndex("by-ticket", "ticketCode");
      scaleStore.createIndex("by-vehicle", "vehiclePlate");

      db.createObjectStore("meta", { keyPath: "key" });
    },
  });
}

export async function initializeLocalStore() {
  const db = await getDb();
  const seeded = await db.get("meta", "demo-seeded-version");

  if (seeded?.value === DEMO_SEED_VERSION) {
    const currentDeposits = await db.getAll("deposits");
    const hasLegacyDemoFleet = currentDeposits.some((deposit) => (
      deposit.demoRecord && /^VNA/i.test(deposit.vehiclePlate)
    ));

    if (!hasLegacyDemoFleet) {
      return;
    }
  }

  const resetTx = db.transaction(["deposits", "scaleTickets"], "readwrite");
  await Promise.all([
    resetTx.objectStore("deposits").clear(),
    resetTx.objectStore("scaleTickets").clear(),
    resetTx.done,
  ]);

  const seedTx = db.transaction(["deposits", "scaleTickets", "meta"], "readwrite");
  await Promise.all([
    ...demoDeposits.map((deposit) => seedTx.objectStore("deposits").put(deposit)),
    ...demoScaleTickets.map((ticket) => seedTx.objectStore("scaleTickets").put(ticket)),
    seedTx.objectStore("meta").put({ key: "demo-seeded", value: new Date().toISOString() }),
    seedTx.objectStore("meta").put({ key: "demo-seeded-version", value: DEMO_SEED_VERSION }),
    seedTx.done,
  ]);
}

export async function listDeposits() {
  const db = await getDb();
  const deposits = await db.getAll("deposits");
  return deposits.sort((a, b) => {
    const left = `${a.depositDate}T${a.depositTime}`;
    const right = `${b.depositDate}T${b.depositTime}`;
    return right.localeCompare(left);
  });
}

export async function listScaleTickets() {
  const db = await getDb();
  return db.getAll("scaleTickets");
}

export async function saveDeposit(deposit: FieldDeposit) {
  const db = await getDb();
  await db.put("deposits", deposit);
}

export async function getPendingDeposits() {
  const db = await getDb();
  const pending = await db.getAllFromIndex("deposits", "by-sync", "pending");
  const errors = await db.getAllFromIndex("deposits", "by-sync", "error");
  return [...pending, ...errors].filter((deposit) => !deposit.demoRecord);
}

export async function updateDepositSyncState(
  id: string,
  syncStatus: SyncStatus,
  syncError: string | null = null,
) {
  const db = await getDb();
  const deposit = await db.get("deposits", id);

  if (!deposit) {
    return;
  }

  await db.put("deposits", {
    ...deposit,
    syncStatus,
    syncError,
    updatedAt: new Date().toISOString(),
    syncedAt: syncStatus === "synced" ? new Date().toISOString() : deposit.syncedAt,
  });
}

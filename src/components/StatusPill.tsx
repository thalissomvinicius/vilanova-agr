import type { SyncStatus } from "../types";

interface StatusPillProps {
  status: SyncStatus;
}

const statusLabels: Record<SyncStatus, string> = {
  pending: "Pendente",
  syncing: "Sincronizando",
  synced: "Sincronizado",
  error: "Erro",
};

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`status-pill status-${status}`}>{statusLabels[status]}</span>;
}

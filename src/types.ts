export type SyncStatus = "pending" | "syncing" | "synced" | "error";

export type ReviewStatus = "pending" | "approved" | "rejected";

export type PlacementMode = "single_plot" | "between_plots";

export type Subproduct =
  | "Borra"
  | "Cacho Vazio (Bucha)"
  | "Cacho Triturado"
  | "Cinza"
  | "Torta"
  | "Outros"
  | (string & {});

export type LoadingOrigin = "Extratora" | "Patio" | "Outras" | (string & {});

export interface FieldDeposit {
  id: string;
  driverRegistration: string;
  driverName: string;
  vehiclePlate: string;
  subproduct: Subproduct;
  loadingOrigin?: LoadingOrigin;
  scaleTicketCode: string;
  farm: string;
  placementMode: PlacementMode;
  plotPrimary: string;
  plotSecondary: string;
  depositDate: string;
  depositTime: string;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  dumpPhotoDataUrl?: string | null;
  dumpPhotoName?: string | null;
  dumpPhotoLatitude?: number | null;
  dumpPhotoLongitude?: number | null;
  dumpPhotoAccuracy?: number | null;
  dumpPhotoCapturedAt?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  syncError: string | null;
  syncedAt: string | null;
  reviewStatus?: ReviewStatus;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  reviewedByLabel?: string | null;
  demoRecord?: boolean;
}

export interface ScaleTicket {
  id: string;
  fieldDepositId: string;
  ticketCode: string;
  driverRegistration: string;
  driverName: string;
  vehiclePlate: string;
  subproduct: Subproduct;
  grossWeightKg: number;
  tareWeightKg: number;
  netWeightKg: number;
  departureAt: string;
  returnAt: string;
}

export interface DashboardSummary {
  deposits: number;
  matchedTickets: number;
  pendingTickets: number;
  totalTonnes: number;
  averageCycleMinutes: number;
  pendingSync: number;
  synced: number;
}

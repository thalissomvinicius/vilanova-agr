import farmParcelsGeoJson from "../data/farm-parcels.json";
import type { FieldDeposit, ScaleTicket, Subproduct } from "../types";
import { subproductFleetVehicles } from "./fleet";
import { demoHeadcountDrivers } from "./headcount";

type FarmId = "vila-nova" | "fe-em-deus";
type CoordinatePair = [number, number];

interface ParcelFeature {
  properties: {
    farmId: string;
    ID_PARCELA: string;
  };
  geometry:
    | { type: "Polygon"; coordinates: CoordinatePair[][] }
    | { type: "MultiPolygon"; coordinates: CoordinatePair[][][] };
}

interface DemoTripSpec {
  farmId: FarmId;
  primary: string;
  secondary?: string;
  subproduct: Subproduct;
  loadingOrigin: "Extratora" | "Patio" | "Outras";
  date: string;
  time: string;
  netWeightKg: number;
  driverIndex: number;
  cycleMinutes: number;
  matchedTicket: boolean;
  syncStatus: FieldDeposit["syncStatus"];
  accuracy: number | null;
  note?: string;
}

const farmNames: Record<FarmId, string> = {
  "vila-nova": "VILA NOVA",
  "fe-em-deus": "FE EM DEUS",
};

const parcelFeatures = (farmParcelsGeoJson as unknown as { features: ParcelFeature[] }).features;

function normalizeParcel(value: string) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function ringsFromFeature(feature: ParcelFeature) {
  return feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates
    : feature.geometry.coordinates.flat();
}

function findParcelFeature(farmId: FarmId, parcel: string) {
  const normalizedParcel = normalizeParcel(parcel);
  return parcelFeatures.find((feature) => (
    feature.properties.farmId === farmId
    && normalizeParcel(feature.properties.ID_PARCELA) === normalizedParcel
  ));
}

function parcelCenter(farmId: FarmId, parcel: string) {
  const feature = findParcelFeature(farmId, parcel);

  if (!feature) {
    return farmId === "vila-nova"
      ? { latitude: -2.858, longitude: -48.246 }
      : { latitude: -2.844, longitude: -48.199 };
  }

  const coordinates = ringsFromFeature(feature).flat();
  const totals = coordinates.reduce(
    (sum, [longitude, latitude]) => ({
      longitude: sum.longitude + longitude,
      latitude: sum.latitude + latitude,
    }),
    { longitude: 0, latitude: 0 },
  );

  return {
    latitude: Number((totals.latitude / coordinates.length).toFixed(7)),
    longitude: Number((totals.longitude / coordinates.length).toFixed(7)),
  };
}

function dischargePoint(spec: DemoTripSpec, index: number) {
  const primaryPoint = parcelCenter(spec.farmId, spec.primary);

  if (!spec.secondary) {
    return {
      latitude: Number((primaryPoint.latitude + ((index % 3) - 1) * 0.00007).toFixed(7)),
      longitude: Number((primaryPoint.longitude + ((index % 4) - 1.5) * 0.00007).toFixed(7)),
    };
  }

  const secondaryPoint = parcelCenter(spec.farmId, spec.secondary);
  return {
    latitude: Number(((primaryPoint.latitude + secondaryPoint.latitude) / 2).toFixed(7)),
    longitude: Number(((primaryPoint.longitude + secondaryPoint.longitude) / 2).toFixed(7)),
  };
}

function isoFromLocal(date: string, time: string, deltaMinutes = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) + deltaMinutes * 60_000).toISOString();
}

function demoUuid(index: number, prefix = "10000000") {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function demoFleetVehicle(index: number) {
  return subproductFleetVehicles[index % subproductFleetVehicles.length];
}

const demoTripSpecs: DemoTripSpec[] = [
  { farmId: "vila-nova", primary: "A01", secondary: "A02", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-07-02", time: "15:35", netWeightKg: 16400, driverIndex: 0, cycleMinutes: 171, matchedTicket: true, syncStatus: "synced", accuracy: 11 },
  { farmId: "fe-em-deus", primary: "F22", secondary: "F23", subproduct: "Cacho Triturado", loadingOrigin: "Patio", date: "2026-07-02", time: "14:48", netWeightKg: 13900, driverIndex: 1, cycleMinutes: 156, matchedTicket: true, syncStatus: "synced", accuracy: 14 },
  { farmId: "vila-nova", primary: "A03", secondary: "A05", subproduct: "Torta", loadingOrigin: "Extratora", date: "2026-07-02", time: "13:40", netWeightKg: 15100, driverIndex: 2, cycleMinutes: 164, matchedTicket: true, syncStatus: "synced", accuracy: 12 },
  { farmId: "fe-em-deus", primary: "G21", secondary: "G22", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-07-02", time: "12:55", netWeightKg: 15800, driverIndex: 3, cycleMinutes: 169, matchedTicket: true, syncStatus: "synced", accuracy: 13 },
  { farmId: "vila-nova", primary: "A06", secondary: "A08", subproduct: "Cacho Vazio (Bucha)", loadingOrigin: "Patio", date: "2026-07-02", time: "11:25", netWeightKg: 12200, driverIndex: 4, cycleMinutes: 151, matchedTicket: true, syncStatus: "synced", accuracy: 16 },
  { farmId: "fe-em-deus", primary: "F20", subproduct: "Cinza", loadingOrigin: "Patio", date: "2026-07-02", time: "10:10", netWeightKg: 9100, driverIndex: 5, cycleMinutes: 142, matchedTicket: false, syncStatus: "pending", accuracy: 18, note: "Ticket aguardando importacao da balanca." },
  { farmId: "vila-nova", primary: "B08", secondary: "B09", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-07-02", time: "08:45", netWeightKg: 16600, driverIndex: 6, cycleMinutes: 173, matchedTicket: true, syncStatus: "synced", accuracy: 10 },
  { farmId: "fe-em-deus", primary: "F18", secondary: "F19", subproduct: "Torta", loadingOrigin: "Extratora", date: "2026-07-01", time: "16:05", netWeightKg: 14100, driverIndex: 7, cycleMinutes: 160, matchedTicket: true, syncStatus: "synced", accuracy: 15 },
  { farmId: "vila-nova", primary: "A09", secondary: "A10", subproduct: "Cacho Triturado", loadingOrigin: "Patio", date: "2026-07-01", time: "14:35", netWeightKg: 13700, driverIndex: 8, cycleMinutes: 158, matchedTicket: true, syncStatus: "synced", accuracy: 12 },
  { farmId: "fe-em-deus", primary: "H20", secondary: "H21", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-07-01", time: "13:20", netWeightKg: 15500, driverIndex: 9, cycleMinutes: 166, matchedTicket: true, syncStatus: "synced", accuracy: 17 },
  { farmId: "vila-nova", primary: "C09", secondary: "C12", subproduct: "Torta", loadingOrigin: "Extratora", date: "2026-07-01", time: "11:55", netWeightKg: 14800, driverIndex: 10, cycleMinutes: 162, matchedTicket: true, syncStatus: "synced", accuracy: 14 },
  { farmId: "fe-em-deus", primary: "G18", secondary: "G19", subproduct: "Cacho Vazio (Bucha)", loadingOrigin: "Patio", date: "2026-07-01", time: "10:25", netWeightKg: 11800, driverIndex: 0, cycleMinutes: 149, matchedTicket: true, syncStatus: "synced", accuracy: 16 },
  { farmId: "vila-nova", primary: "D09", subproduct: "Cinza", loadingOrigin: "Patio", date: "2026-07-01", time: "09:10", netWeightKg: 8700, driverIndex: 1, cycleMinutes: 137, matchedTicket: true, syncStatus: "synced", accuracy: 20 },
  { farmId: "fe-em-deus", primary: "F15", secondary: "F16", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-06-30", time: "15:15", netWeightKg: 16200, driverIndex: 2, cycleMinutes: 175, matchedTicket: true, syncStatus: "synced", accuracy: 13 },
  { farmId: "vila-nova", primary: "A12", secondary: "B11", subproduct: "Cacho Triturado", loadingOrigin: "Patio", date: "2026-06-30", time: "13:58", netWeightKg: 14200, driverIndex: 3, cycleMinutes: 161, matchedTicket: true, syncStatus: "synced", accuracy: 12 },
  { farmId: "fe-em-deus", primary: "I20", secondary: "I21", subproduct: "Torta", loadingOrigin: "Extratora", date: "2026-06-30", time: "12:20", netWeightKg: 13600, driverIndex: 4, cycleMinutes: 154, matchedTicket: true, syncStatus: "synced", accuracy: 15 },
  { farmId: "vila-nova", primary: "D13", secondary: "D14", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-06-30", time: "10:45", netWeightKg: 15900, driverIndex: 5, cycleMinutes: 168, matchedTicket: false, syncStatus: "synced", accuracy: 13, note: "Descarrego conciliado no campo; ticket ainda sem vinculo." },
  { farmId: "fe-em-deus", primary: "G16", secondary: "G17", subproduct: "Cacho Triturado", loadingOrigin: "Patio", date: "2026-06-30", time: "09:30", netWeightKg: 13200, driverIndex: 6, cycleMinutes: 148, matchedTicket: true, syncStatus: "synced", accuracy: 17 },
  { farmId: "vila-nova", primary: "D15", secondary: "D16", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-06-29", time: "16:05", netWeightKg: 15300, driverIndex: 7, cycleMinutes: 170, matchedTicket: true, syncStatus: "synced", accuracy: 11 },
  { farmId: "fe-em-deus", primary: "F17", subproduct: "Outros", loadingOrigin: "Outras", date: "2026-06-29", time: "14:40", netWeightKg: 9800, driverIndex: 8, cycleMinutes: 146, matchedTicket: true, syncStatus: "synced", accuracy: 18, note: "Outros: varredura organica do patio." },
  { farmId: "vila-nova", primary: "E15", secondary: "E16", subproduct: "Cacho Vazio (Bucha)", loadingOrigin: "Patio", date: "2026-06-29", time: "12:50", netWeightKg: 11600, driverIndex: 9, cycleMinutes: 150, matchedTicket: true, syncStatus: "synced", accuracy: 14 },
  { farmId: "fe-em-deus", primary: "F21", secondary: "F22", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-06-29", time: "10:35", netWeightKg: 15700, driverIndex: 10, cycleMinutes: 165, matchedTicket: true, syncStatus: "synced", accuracy: 15 },
  { farmId: "vila-nova", primary: "E17", secondary: "E18", subproduct: "Torta", loadingOrigin: "Extratora", date: "2026-06-28", time: "15:25", netWeightKg: 13900, driverIndex: 0, cycleMinutes: 159, matchedTicket: true, syncStatus: "synced", accuracy: 13 },
  { farmId: "fe-em-deus", primary: "G14", secondary: "G15", subproduct: "Cacho Triturado", loadingOrigin: "Patio", date: "2026-06-28", time: "13:15", netWeightKg: 12900, driverIndex: 1, cycleMinutes: 147, matchedTicket: true, syncStatus: "synced", accuracy: 17 },
  { farmId: "vila-nova", primary: "F18", secondary: "F19", subproduct: "Borra", loadingOrigin: "Extratora", date: "2026-06-28", time: "11:40", netWeightKg: 15100, driverIndex: 2, cycleMinutes: 163, matchedTicket: true, syncStatus: "synced", accuracy: 12 },
  { farmId: "fe-em-deus", primary: "H19", secondary: "H20", subproduct: "Cacho Vazio (Bucha)", loadingOrigin: "Patio", date: "2026-06-28", time: "09:55", netWeightKg: 11100, driverIndex: 3, cycleMinutes: 144, matchedTicket: false, syncStatus: "synced", accuracy: null, note: "GPS pendente para validar ponto do descarrego." },
  { farmId: "vila-nova", primary: "F20", subproduct: "Cinza", loadingOrigin: "Patio", date: "2026-06-27", time: "14:10", netWeightKg: 9300, driverIndex: 4, cycleMinutes: 140, matchedTicket: true, syncStatus: "synced", accuracy: 19 },
  { farmId: "fe-em-deus", primary: "I21", secondary: "I22", subproduct: "Torta", loadingOrigin: "Extratora", date: "2026-06-27", time: "10:45", netWeightKg: 13400, driverIndex: 5, cycleMinutes: 153, matchedTicket: true, syncStatus: "synced", accuracy: 16 },
];

export const demoDeposits: FieldDeposit[] = demoTripSpecs.map((spec, index) => {
  const driver = demoHeadcountDrivers[spec.driverIndex % demoHeadcountDrivers.length];
  const vehicle = demoFleetVehicle(index);
  const point = spec.accuracy === null ? { latitude: null, longitude: null } : dischargePoint(spec, index);
  const ticketCode = `BAL-2026-${String(901 + index).padStart(4, "0")}`;

  return {
    id: demoUuid(index + 1),
    driverRegistration: driver.registration,
    driverName: driver.name,
    vehiclePlate: vehicle.plate,
    subproduct: spec.subproduct,
    loadingOrigin: spec.loadingOrigin,
    scaleTicketCode: ticketCode,
    farm: farmNames[spec.farmId],
    placementMode: spec.secondary ? "between_plots" : "single_plot",
    plotPrimary: spec.primary,
    plotSecondary: spec.secondary ?? "",
    depositDate: spec.date,
    depositTime: spec.time,
    latitude: point.latitude,
    longitude: point.longitude,
    locationAccuracy: spec.accuracy,
    notes: spec.note ?? "Registro demonstrativo baseado no fluxo campo + balanca.",
    createdAt: isoFromLocal(spec.date, spec.time, 2),
    updatedAt: isoFromLocal(spec.date, spec.time, spec.syncStatus === "synced" ? spec.cycleMinutes + 8 : 6),
    syncStatus: spec.syncStatus,
    syncError: null,
    syncedAt: spec.syncStatus === "synced" ? isoFromLocal(spec.date, spec.time, spec.cycleMinutes + 8) : null,
    demoRecord: true,
  };
});

export const demoScaleTickets: ScaleTicket[] = demoTripSpecs
  .map((spec, index) => ({ spec, index }))
  .filter(({ spec }) => spec.matchedTicket)
  .map(({ spec, index }) => {
    const driver = demoHeadcountDrivers[spec.driverIndex % demoHeadcountDrivers.length];
    const deposit = demoDeposits[index];
    const vehicle = demoFleetVehicle(index);
    const tareWeightKg = 10_900 + (index % 7) * 180;

    return {
      id: demoUuid(index + 1, "20000000"),
      fieldDepositId: deposit.id,
      ticketCode: deposit.scaleTicketCode,
      driverRegistration: driver.registration,
      driverName: driver.name,
      vehiclePlate: vehicle.plate,
      subproduct: spec.subproduct,
      grossWeightKg: tareWeightKg + spec.netWeightKg,
      tareWeightKg,
      netWeightKg: spec.netWeightKg,
      departureAt: isoFromLocal(spec.date, spec.time, -46 - (index % 4) * 6),
      returnAt: isoFromLocal(spec.date, spec.time, spec.cycleMinutes - 46 - (index % 4) * 6),
    };
  });

import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useMemo,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  DatabaseZap,
  Download,
  Filter,
  Gauge,
  Layers3,
  ListChecks,
  MapPinned,
  Minimize2,
  Presentation,
  RotateCcw,
  Search,
  Scale,
  TicketCheck,
  Truck,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { formatDate, formatMinutes, formatTonnes } from "../lib/format";
import { findFleetVehicleByPlate } from "../lib/fleet";
import farmParcelsGeoJson from "../data/farm-parcels.json";
import type { DashboardSummary, FieldDeposit, ScaleTicket, SyncStatus } from "../types";

interface DashboardProps {
  deposits: FieldDeposit[];
  scaleTickets: ScaleTicket[];
}

interface TicketMaps {
  byDepositId: Map<string, ScaleTicket>;
  byCode: Map<string, ScaleTicket>;
}

type DashboardView = "geral" | "coletas" | "conciliacao" | "analise";
type TicketStatusFilter = "all" | "matched" | "pending";
type SyncStatusFilter = "all" | SyncStatus;
type AnalysisFarmFilter = FarmId | "all";

interface Filters {
  search: string;
  dateFrom: string;
  dateTo: string;
  farm: string;
  subproduct: string;
  loadingOrigin: string;
  ticketStatus: TicketStatusFilter;
  syncStatus: SyncStatusFilter;
}

interface DashboardMetrics extends DashboardSummary {
  ticketRate: number;
  gpsCoverage: number;
  averageTonnes: number;
  betweenPlots: number;
  missingGps: number;
  longCycles: number;
  averageAccuracy: number;
}

interface PriorityItem {
  deposit: FieldDeposit;
  reasons: string[];
  severity: number;
}

type FarmId = "vila-nova" | "fe-em-deus";
type CoordinatePair = [number, number];
type GeoJsonPolygon = CoordinatePair[][];
type GeoJsonMultiPolygon = CoordinatePair[][][];

interface ParcelFeature {
  type: "Feature";
  properties: {
    farmId: string;
    farmName: string;
    parcelId: string;
    ID_PARCELA: string;
    HECTARE_PA: number;
    ANO?: string;
    CULTIVAR?: string;
  };
  geometry:
    | {
        type: "Polygon";
        coordinates: GeoJsonPolygon;
      }
    | {
        type: "MultiPolygon";
        coordinates: GeoJsonMultiPolygon;
      };
}

interface FarmMapConfig {
  id: FarmId;
  label: string;
  filterValue: string;
  status: string;
}

interface ProjectedParcel {
  id: string;
  label: string;
  hectares: number;
  year?: string;
  paths: string[];
  labelX: number;
  labelY: number;
  highlighted: boolean;
  depositCount: number;
  tonnes: number;
  betweenCount: number;
}

interface DischargeMapMarker {
  id: string;
  x: number;
  y: number;
  color: string;
  deposit: FieldDeposit & { latitude: number; longitude: number };
  plotLabel: string;
  modeLabel: string;
  accuracyLabel: string;
}

interface FarmMapData {
  farm: FarmMapConfig;
  parcels: ProjectedParcel[];
  markers: DischargeMapMarker[];
  totalHectares: number;
  betweenDeposits: number;
}

interface FarmMapViewState {
  x: number;
  y: number;
  scale: number;
}

interface MapDragState {
  farmId: FarmId;
  targetFarmId: FarmId;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  parcelId?: string;
  markerId?: string;
}

interface SelectedParcel {
  farmId: FarmId;
  farmLabel: string;
  parcelId: string;
  label: string;
  hectares: number;
  year?: string;
  depositCount: number;
  tonnes: number;
  betweenCount: number;
}

interface DriverControlItem {
  key: string;
  name: string;
  registration: string;
  trips: number;
  tonnes: number;
  cycleAverage: number;
  betweenPlots: number;
  pendingTickets: number;
  topSubproduct: string;
  topSubproductTrips: number;
  subproducts: { name: string; trips: number; tonnes: number }[];
  farms: string[];
  lastDeposit: FieldDeposit;
  lastTicket?: ScaleTicket;
}

interface FarmTripItem {
  id: AnalysisFarmFilter;
  name: string;
  viagens: number;
  toneladas: number;
  entreParcelas: number;
  pendencias: number;
}

interface ParcelRankItem {
  key: string;
  farmId: FarmId;
  farmLabel: string;
  parcel: string;
  label: string;
  trips: number;
  tonnes: number;
  betweenPlots: number;
  pendingTickets: number;
}

interface VehicleControlItem {
  fleetNumber: string;
  plate: string;
  displayPlate: string;
  vehicleDescription: string;
  operationalClass: string;
  trips: number;
  tonnes: number;
  betweenPlots: number;
  pendingTickets: number;
  drivers: string[];
  farms: string[];
  lastDeposit: FieldDeposit;
}

const chartColors = ["#1e5c3a", "#2f6f9f", "#e2a02c", "#e8551f", "#3a9b50", "#86c53c"];
const reconciliationColors = ["#1e5c3a", "#e2a02c", "#e8551f"];
const subproductMapColors = new Map([
  ["Borra", "#1e5c3a"],
  ["Cacho Vazio (Bucha)", "#2f6f9f"],
  ["Cacho Triturado", "#86c53c"],
  ["Cinza", "#8a9290"],
  ["Torta", "#e2a02c"],
  ["Outros", "#e8551f"],
  ["Outras", "#e8551f"],
]);

const farmMapWidth = 360;
const farmMapHeight = 230;
const minFarmMapScale = 1;
const maxFarmMapScale = 4;
const defaultFarmMapView: FarmMapViewState = { x: 0, y: 0, scale: 1 };
const initialFarmMapViews: Record<FarmId, FarmMapViewState> = {
  "vila-nova": defaultFarmMapView,
  "fe-em-deus": defaultFarmMapView,
};
const farmParcels = (farmParcelsGeoJson as unknown as { features: ParcelFeature[] }).features;
const focusFarms: FarmMapConfig[] = [
  {
    id: "vila-nova",
    label: "Vila Nova",
    filterValue: "VILA NOVA",
    status: "Com descarregos",
  },
  {
    id: "fe-em-deus",
    label: "Fé em Deus",
    filterValue: "FE EM DEUS",
    status: "Com descarregos",
  },
];
const focusFarmIds = new Set<FarmId>(focusFarms.map((farm) => farm.id));

const initialFilters: Filters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  farm: "",
  subproduct: "",
  loadingOrigin: "",
  ticketStatus: "all",
  syncStatus: "all",
};

function normalizeTicketCode(value: string) {
  return value.trim().toUpperCase();
}

function minutesBetween(start: string, end: string) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
}

function getCycleMinutes(ticket?: ScaleTicket | null) {
  if (!ticket) return 0;
  return minutesBetween(ticket.departureAt, ticket.returnAt);
}

function getLoadingOrigin(deposit: FieldDeposit) {
  return (deposit.loadingOrigin || "Extratora").trim();
}

function buildTicketMaps(scaleTickets: ScaleTicket[]): TicketMaps {
  const byDepositId = new Map<string, ScaleTicket>();
  const byCode = new Map<string, ScaleTicket>();

  scaleTickets.forEach((ticket) => {
    if (ticket.fieldDepositId) {
      byDepositId.set(ticket.fieldDepositId, ticket);
    }

    if (ticket.ticketCode) {
      byCode.set(normalizeTicketCode(ticket.ticketCode), ticket);
    }
  });

  return { byDepositId, byCode };
}

function getTicketForDeposit(deposit: FieldDeposit, ticketMaps: TicketMaps) {
  const ticketCode = normalizeTicketCode(deposit.scaleTicketCode);
  return ticketMaps.byDepositId.get(deposit.id) ?? ticketMaps.byCode.get(ticketCode);
}

function getMatchedTickets(deposits: FieldDeposit[], ticketMaps: TicketMaps) {
  const seen = new Set<string>();
  const matchedTickets: ScaleTicket[] = [];

  deposits.forEach((deposit) => {
    const ticket = getTicketForDeposit(deposit, ticketMaps);

    if (ticket && !seen.has(ticket.id)) {
      seen.add(ticket.id);
      matchedTickets.push(ticket);
    }
  });

  return matchedTickets;
}

function getUnmatchedScaleTickets(
  deposits: FieldDeposit[],
  scaleTickets: ScaleTicket[],
  ticketMaps: TicketMaps,
) {
  const matchedIds = new Set(
    deposits
      .map((deposit) => getTicketForDeposit(deposit, ticketMaps)?.id)
      .filter(Boolean),
  );

  return scaleTickets.filter((ticket) => !matchedIds.has(ticket.id));
}

function buildSummary(
  deposits: FieldDeposit[],
  matchedTickets: ScaleTicket[],
  ticketMaps: TicketMaps,
): DashboardMetrics {
  const matchedRecords = deposits.filter((deposit) => getTicketForDeposit(deposit, ticketMaps)).length;
  const totalTonnes = matchedTickets.reduce((sum, ticket) => sum + ticket.netWeightKg / 1000, 0);
  const cycleTimes = matchedTickets
    .map(getCycleMinutes)
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
  const gpsRecords = deposits.filter((deposit) => deposit.latitude && deposit.longitude);
  const accuracies = deposits
    .map((deposit) => deposit.locationAccuracy)
    .filter((accuracy): accuracy is number => typeof accuracy === "number" && Number.isFinite(accuracy));

  return {
    deposits: deposits.length,
    matchedTickets: matchedRecords,
    pendingTickets: deposits.length - matchedRecords,
    totalTonnes,
    averageCycleMinutes:
      cycleTimes.length > 0
        ? cycleTimes.reduce((sum, minutes) => sum + minutes, 0) / cycleTimes.length
        : 0,
    pendingSync: deposits.filter((deposit) => deposit.syncStatus !== "synced").length,
    synced: deposits.filter((deposit) => deposit.syncStatus === "synced").length,
    ticketRate: deposits.length ? (matchedRecords / deposits.length) * 100 : 0,
    gpsCoverage: deposits.length ? (gpsRecords.length / deposits.length) * 100 : 0,
    averageTonnes: matchedTickets.length ? totalTonnes / matchedTickets.length : 0,
    betweenPlots: deposits.filter((deposit) => deposit.placementMode === "between_plots").length,
    missingGps: deposits.length - gpsRecords.length,
    longCycles: cycleTimes.filter((minutes) => minutes > 180).length,
    averageAccuracy:
      accuracies.length > 0
        ? accuracies.reduce((sum, accuracy) => sum + accuracy, 0) / accuracies.length
        : 0,
  };
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function filterDeposits(deposits: FieldDeposit[], ticketMaps: TicketMaps, filters: Filters) {
  const search = filters.search.trim().toLowerCase();

  return deposits.filter((deposit) => {
    const ticket = getTicketForDeposit(deposit, ticketMaps);
    const loadingOrigin = getLoadingOrigin(deposit);

    if (filters.dateFrom && deposit.depositDate < filters.dateFrom) return false;
    if (filters.dateTo && deposit.depositDate > filters.dateTo) return false;
    if (filters.farm && deposit.farm !== filters.farm) return false;
    if (filters.subproduct && deposit.subproduct !== filters.subproduct) return false;
    if (filters.loadingOrigin && loadingOrigin !== filters.loadingOrigin) return false;
    if (filters.ticketStatus === "matched" && !ticket) return false;
    if (filters.ticketStatus === "pending" && ticket) return false;
    if (filters.syncStatus !== "all" && deposit.syncStatus !== filters.syncStatus) return false;

    if (!search) return true;

    const searchable = [
      deposit.driverRegistration,
      deposit.driverName,
      deposit.vehiclePlate,
      deposit.scaleTicketCode,
      ticket?.ticketCode,
      deposit.farm,
      deposit.plotPrimary,
      deposit.plotSecondary,
      deposit.subproduct,
      loadingOrigin,
      deposit.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(search);
  });
}

function getSubproductMapColor(subproduct: string) {
  return subproductMapColors.get(subproduct) ?? "#6d7b70";
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeParcelCode(value: string) {
  const compact = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const parsed = compact.match(/^([a-z]*)(0*\d+)([a-z]*)$/);

  if (!parsed) return compact;
  return `${parsed[1]}${Number(parsed[2])}${parsed[3]}`;
}

function getFocusFarmId(farmName: string): FarmId | null {
  const normalized = normalizeText(farmName);

  if (normalized === "VILA NOVA") return "vila-nova";
  if (normalized === "FE EM DEUS") return "fe-em-deus";
  return null;
}

function getFocusFarmLabel(farmId: AnalysisFarmFilter) {
  if (farmId === "all") return "Todas as fazendas";
  return focusFarms.find((farm) => farm.id === farmId)?.label ?? "Fazenda";
}

function getDriverKey(deposit: FieldDeposit) {
  return `${deposit.driverRegistration || "sem-matricula"}-${deposit.driverName || "sem-nome"}`;
}

function hasGps(deposit: FieldDeposit): deposit is FieldDeposit & { latitude: number; longitude: number } {
  return typeof deposit.latitude === "number" && typeof deposit.longitude === "number";
}

function geometryRings(geometry: ParcelFeature["geometry"]) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  return geometry.coordinates.flat();
}

function geometryPolygons(geometry: ParcelFeature["geometry"]) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  return geometry.coordinates;
}

function ringBounds(ring: CoordinatePair[]) {
  return ring.reduce(
    (bounds, [longitude, latitude]) => ({
      minLongitude: Math.min(bounds.minLongitude, Number(longitude)),
      maxLongitude: Math.max(bounds.maxLongitude, Number(longitude)),
      minLatitude: Math.min(bounds.minLatitude, Number(latitude)),
      maxLatitude: Math.max(bounds.maxLatitude, Number(latitude)),
    }),
    {
      minLongitude: Infinity,
      maxLongitude: -Infinity,
      minLatitude: Infinity,
      maxLatitude: -Infinity,
    },
  );
}

function ringAreaAbs(ring: CoordinatePair[]) {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    area += (Number(ring[index][0]) * Number(ring[index + 1][1]))
      - (Number(ring[index + 1][0]) * Number(ring[index][1]));
  }

  return Math.abs(area / 2);
}

function ringCentroid(ring: CoordinatePair[]): CoordinatePair {
  let areaFactor = 0;
  let longitudeSum = 0;
  let latitudeSum = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    const cross = (Number(current[0]) * Number(next[1])) - (Number(next[0]) * Number(current[1]));

    areaFactor += cross;
    longitudeSum += (Number(current[0]) + Number(next[0])) * cross;
    latitudeSum += (Number(current[1]) + Number(next[1])) * cross;
  }

  if (!areaFactor) {
    const bounds = ringBounds(ring);
    return [
      (bounds.minLongitude + bounds.maxLongitude) / 2,
      (bounds.minLatitude + bounds.maxLatitude) / 2,
    ];
  }

  return [longitudeSum / (3 * areaFactor), latitudeSum / (3 * areaFactor)];
}

function pointInRing(point: CoordinatePair, ring: CoordinatePair[]) {
  const [longitude, latitude] = point;
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentLongitude = Number(ring[index][0]);
    const currentLatitude = Number(ring[index][1]);
    const previousLongitude = Number(ring[previous][0]);
    const previousLatitude = Number(ring[previous][1]);
    const intersects = ((currentLatitude > latitude) !== (previousLatitude > latitude))
      && (
        longitude
          < ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
            / ((previousLatitude - currentLatitude) || 1e-12)
            + currentLongitude
      );

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygon(point: CoordinatePair, polygon: GeoJsonPolygon) {
  const outerRing = polygon[0] || [];

  if (!pointInRing(point, outerRing)) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function pointSegmentDistanceSquared(point: CoordinatePair, start: CoordinatePair, end: CoordinatePair) {
  const x = Number(point[0]);
  const y = Number(point[1]);
  const x1 = Number(start[0]);
  const y1 = Number(start[1]);
  const x2 = Number(end[0]);
  const y2 = Number(end[1]);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const segmentLength = (dx * dx) + (dy * dy);
  const ratio = segmentLength
    ? Math.max(0, Math.min(1, (((x - x1) * dx) + ((y - y1) * dy)) / segmentLength))
    : 0;
  const projectionX = x1 + ratio * dx;
  const projectionY = y1 + ratio * dy;

  return ((x - projectionX) ** 2) + ((y - projectionY) ** 2);
}

function pointDistanceToPolygonEdge(point: CoordinatePair, polygon: GeoJsonPolygon) {
  return polygon.reduce((minDistance, ring) => {
    let ringMin = minDistance;

    for (let index = 0; index < ring.length - 1; index += 1) {
      ringMin = Math.min(ringMin, pointSegmentDistanceSquared(point, ring[index], ring[index + 1]));
    }

    return ringMin;
  }, Infinity);
}

function featureLabelCoordinate(feature: ParcelFeature): CoordinatePair | null {
  const polygons = geometryPolygons(feature.geometry)
    .filter((polygon) => polygon?.[0]?.length >= 4)
    .sort((left, right) => ringAreaAbs(right[0]) - ringAreaAbs(left[0]));
  const polygon = polygons[0];

  if (!polygon) return null;

  const outerRing = polygon[0];
  const bounds = ringBounds(outerRing);
  const centroid = ringCentroid(outerRing);
  const candidates: CoordinatePair[] = [centroid];
  const gridSteps = 8;

  for (let xIndex = 1; xIndex < gridSteps; xIndex += 1) {
    for (let yIndex = 1; yIndex < gridSteps; yIndex += 1) {
      candidates.push([
        bounds.minLongitude + ((bounds.maxLongitude - bounds.minLongitude) * xIndex) / gridSteps,
        bounds.minLatitude + ((bounds.maxLatitude - bounds.minLatitude) * yIndex) / gridSteps,
      ]);
    }
  }

  const best = candidates
    .filter((point) => pointInPolygon(point, polygon))
    .map((point) => ({
      point,
      distance: pointDistanceToPolygonEdge(point, polygon),
    }))
    .sort((left, right) => right.distance - left.distance)[0]?.point;

  return best || centroid;
}

function getFarmBounds(features: ParcelFeature[]) {
  const coordinates = features.flatMap((feature) => geometryRings(feature.geometry).flat());
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);

  return {
    minLongitude: Math.min(...longitudes),
    maxLongitude: Math.max(...longitudes),
    minLatitude: Math.min(...latitudes),
    maxLatitude: Math.max(...latitudes),
  };
}

function createFarmProjector(bounds: ReturnType<typeof getFarmBounds>) {
  const padding = 12;
  const longitudeRange = bounds.maxLongitude - bounds.minLongitude || 0.01;
  const latitudeRange = bounds.maxLatitude - bounds.minLatitude || 0.01;
  const centerLatitude = (bounds.maxLatitude + bounds.minLatitude) / 2;
  const longitudeFactor = Math.max(0.2, Math.cos((centerLatitude * Math.PI) / 180));
  const projectedWidth = longitudeRange * longitudeFactor;
  const projectedHeight = latitudeRange;
  const availableWidth = farmMapWidth - padding * 2;
  const availableHeight = farmMapHeight - padding * 2;
  const scale = Math.min(availableWidth / projectedWidth, availableHeight / projectedHeight);
  const contentWidth = projectedWidth * scale;
  const contentHeight = projectedHeight * scale;
  const offsetX = (farmMapWidth - contentWidth) / 2;
  const offsetY = (farmMapHeight - contentHeight) / 2;

  return ([longitude, latitude]: CoordinatePair) => {
    const x = offsetX + ((longitude - bounds.minLongitude) * longitudeFactor * scale);
    const y = farmMapHeight - offsetY - ((latitude - bounds.minLatitude) * scale);

    return { x, y };
  };
}

function clampMapScale(value: number) {
  return Math.max(minFarmMapScale, Math.min(maxFarmMapScale, Number(value.toFixed(2))));
}

function clampMapOffset(value: number, scale: number, axisLength: number) {
  const maxOffset = axisLength * Math.max(0.25, scale - 0.72);
  return Math.max(-maxOffset, Math.min(maxOffset, value));
}

function buildFarmMaps(deposits: FieldDeposit[], ticketMaps: TicketMaps): FarmMapData[] {
  const allFeatures = farmParcels.filter((feature) => focusFarmIds.has(feature.properties.farmId as FarmId));
  const project = createFarmProjector(getFarmBounds(allFeatures));

  return focusFarms.map((farm) => {
    const features = farmParcels.filter((feature) => feature.properties.farmId === farm.id);
    const farmDeposits = deposits.filter((deposit) => getFocusFarmId(deposit.farm) === farm.id);
    const highlightedPlots = new Set(
      farmDeposits
        .flatMap((deposit) => [deposit.plotPrimary, deposit.plotSecondary].filter(Boolean))
        .map((plot) => normalizeParcelCode(String(plot))),
    );

    const parcels = features.map((feature) => {
      const rings = geometryRings(feature.geometry);
      const hectares = Number(feature.properties.HECTARE_PA || 0);
      const label = feature.properties.ID_PARCELA;
      const normalizedLabel = normalizeParcelCode(label);
      const labelCoordinate = featureLabelCoordinate(feature) ?? rings[0][0];
      const labelPoint = project(labelCoordinate);
      const parcelDeposits = farmDeposits.filter(
        (deposit) => (
          normalizeParcelCode(deposit.plotPrimary) === normalizedLabel
          || normalizeParcelCode(deposit.plotSecondary) === normalizedLabel
        ),
      );
      const tonnes = parcelDeposits.reduce((sum, deposit) => {
        const ticket = getTicketForDeposit(deposit, ticketMaps);
        return sum + (ticket ? ticket.netWeightKg / 1000 : 0);
      }, 0);

      return {
        id: feature.properties.parcelId,
        label,
        hectares,
        year: feature.properties.ANO,
        paths: rings.map((ring) => ring.map((coordinate) => {
          const point = project(coordinate);
          return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        }).join(" ")),
        labelX: labelPoint.x,
        labelY: labelPoint.y,
        highlighted: highlightedPlots.has(normalizedLabel),
        depositCount: parcelDeposits.length,
        tonnes: Number(tonnes.toFixed(1)),
        betweenCount: parcelDeposits.filter((deposit) => deposit.placementMode === "between_plots").length,
      };
    });

    const markers = farmDeposits.filter(hasGps).map((deposit) => {
      const point = project([deposit.longitude, deposit.latitude]);
      const modeLabel = deposit.placementMode === "between_plots" ? "Entre parcelas" : "Na parcela";

      return {
        id: deposit.id,
        x: point.x,
        y: point.y,
        color: getSubproductMapColor(deposit.subproduct),
        deposit,
        plotLabel: formatPlot(deposit),
        modeLabel,
        accuracyLabel:
          typeof deposit.locationAccuracy === "number"
            ? `${Math.round(deposit.locationAccuracy)} m`
            : "Sem precisao",
      };
    });

    return {
      farm,
      parcels,
      markers,
      totalHectares: parcels.reduce((sum, parcel) => sum + parcel.hectares, 0),
      betweenDeposits: farmDeposits.filter((deposit) => deposit.placementMode === "between_plots").length,
    };
  });
}

function groupBySubproduct(scaleTickets: ScaleTicket[]) {
  const grouped = new Map<string, number>();

  scaleTickets.forEach((ticket) => {
    grouped.set(ticket.subproduct, (grouped.get(ticket.subproduct) ?? 0) + ticket.netWeightKg / 1000);
  });

  return Array.from(grouped, ([name, toneladas]) => ({
    name,
    toneladas: Number(toneladas.toFixed(1)),
  })).sort((left, right) => right.toneladas - left.toneladas);
}

function groupByFarm(deposits: FieldDeposit[]) {
  const grouped = new Map<string, number>();

  deposits.forEach((deposit) => {
    grouped.set(deposit.farm, (grouped.get(deposit.farm) ?? 0) + 1);
  });

  return Array.from(grouped, ([name, value]) => ({
    name,
    value,
  })).sort((left, right) => right.value - left.value);
}

function groupByOrigin(deposits: FieldDeposit[], ticketMaps: TicketMaps) {
  const grouped = new Map<string, { name: string; coletas: number; toneladas: number }>();

  deposits.forEach((deposit) => {
    const name = getLoadingOrigin(deposit);
    const ticket = getTicketForDeposit(deposit, ticketMaps);
    const current = grouped.get(name) ?? { name, coletas: 0, toneladas: 0 };

    current.coletas += 1;
    current.toneladas += ticket ? ticket.netWeightKg / 1000 : 0;
    grouped.set(name, current);
  });

  return Array.from(grouped.values())
    .sort((left, right) => right.coletas - left.coletas)
    .map((item) => ({
      ...item,
      toneladas: Number(item.toneladas.toFixed(1)),
    }));
}

function groupByReconciliation(summary: DashboardMetrics) {
  return [
    {
      name: "Conciliado",
      value: summary.matchedTickets,
    },
    {
      name: "Aguardando ticket",
      value: summary.pendingTickets,
    },
    {
      name: "Fila local",
      value: summary.pendingSync,
    },
  ];
}

function groupByDay(deposits: FieldDeposit[], ticketMaps: TicketMaps) {
  const grouped = new Map<string, { date: string; coletas: number; toneladas: number; pendencias: number }>();

  deposits.forEach((deposit) => {
    const current = grouped.get(deposit.depositDate) ?? {
      date: deposit.depositDate,
      coletas: 0,
      toneladas: 0,
      pendencias: 0,
    };
    const ticket = getTicketForDeposit(deposit, ticketMaps);

    current.coletas += 1;
    current.toneladas += ticket ? ticket.netWeightKg / 1000 : 0;
    current.pendencias += ticket ? 0 : 1;
    grouped.set(deposit.depositDate, current);
  });

  return Array.from(grouped.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((item) => ({
      ...item,
      dia: formatDate(item.date),
      diaMes: item.date.split("-")[2] ?? item.date,
      semana: getWeekdayAbbreviation(item.date),
      toneladas: Number(item.toneladas.toFixed(1)),
    }));
}

function getWeekdayAbbreviation(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return "";
  const weekDays = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
  return weekDays[new Date(year, month - 1, day).getDay()] ?? "";
}

function getDailyAxisLabel(value: string | number | undefined) {
  const label = String(value ?? "");
  const [day, month, year] = label.split("/").map(Number);
  if (!day || !month || !year) return { dayLabel: label, weekdayLabel: "" };

  return {
    dayLabel: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
    weekdayLabel: getWeekdayAbbreviation(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`),
  };
}

function DailyAxisTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: {
    value?: string | number;
    payload?: {
      semana?: string;
    };
  };
}) {
  const { dayLabel, weekdayLabel } = getDailyAxisLabel(payload?.value);

  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle">
        <tspan x={0} dy={9} fill="#53665a" fontSize={8} fontWeight={850}>
          {dayLabel}
        </tspan>
        <tspan x={0} dy={10} fill="#6b7b70" fontSize={8} fontWeight={900}>
          {weekdayLabel}
        </tspan>
      </text>
    </g>
  );
}

function groupByDriver(deposits: FieldDeposit[], ticketMaps: TicketMaps) {
  const grouped = new Map<string, { name: string; coletas: number; toneladas: number; ciclos: number[] }>();

  deposits.forEach((deposit) => {
    const name = deposit.driverName || deposit.driverRegistration;
    const ticket = getTicketForDeposit(deposit, ticketMaps);
    const current = grouped.get(name) ?? { name, coletas: 0, toneladas: 0, ciclos: [] };

    current.coletas += 1;
    current.toneladas += ticket ? ticket.netWeightKg / 1000 : 0;
    if (ticket) current.ciclos.push(getCycleMinutes(ticket));
    grouped.set(name, current);
  });

  return Array.from(grouped.values())
    .sort((left, right) => right.toneladas - left.toneladas || right.coletas - left.coletas)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      toneladas: Number(item.toneladas.toFixed(1)),
      cicloMedio: item.ciclos.length
        ? item.ciclos.reduce((sum, minutes) => sum + minutes, 0) / item.ciclos.length
        : 0,
    }));
}

function buildDriverControlData(deposits: FieldDeposit[], ticketMaps: TicketMaps): DriverControlItem[] {
  const grouped = new Map<
    string,
    {
      key: string;
      name: string;
      registration: string;
      trips: number;
      tonnes: number;
      cycles: number[];
      betweenPlots: number;
      pendingTickets: number;
      subproducts: Map<string, { name: string; trips: number; tonnes: number }>;
      farms: Set<string>;
      lastDeposit: FieldDeposit;
      lastTicket?: ScaleTicket;
    }
  >();

  deposits.forEach((deposit) => {
    const key = getDriverKey(deposit);
    const ticket = getTicketForDeposit(deposit, ticketMaps);
    const current = grouped.get(key) ?? {
      key,
      name: deposit.driverName || deposit.driverRegistration,
      registration: deposit.driverRegistration,
      trips: 0,
      tonnes: 0,
      cycles: [],
      betweenPlots: 0,
      pendingTickets: 0,
      subproducts: new Map<string, { name: string; trips: number; tonnes: number }>(),
      farms: new Set<string>(),
      lastDeposit: deposit,
      lastTicket: ticket,
    };
    const tonnes = ticket ? ticket.netWeightKg / 1000 : 0;
    const subproduct = current.subproducts.get(deposit.subproduct) ?? {
      name: deposit.subproduct,
      trips: 0,
      tonnes: 0,
    };

    current.trips += 1;
    current.tonnes += tonnes;
    current.betweenPlots += deposit.placementMode === "between_plots" ? 1 : 0;
    current.pendingTickets += ticket ? 0 : 1;
    current.farms.add(deposit.farm);
    if (ticket) current.cycles.push(getCycleMinutes(ticket));
    subproduct.trips += 1;
    subproduct.tonnes += tonnes;
    current.subproducts.set(deposit.subproduct, subproduct);

    if (`${deposit.depositDate}T${deposit.depositTime}` > `${current.lastDeposit.depositDate}T${current.lastDeposit.depositTime}`) {
      current.lastDeposit = deposit;
      current.lastTicket = ticket;
    }

    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .map((item) => {
      const subproducts = Array.from(item.subproducts.values())
        .map((subproduct) => ({
          ...subproduct,
          tonnes: Number(subproduct.tonnes.toFixed(1)),
        }))
        .sort((left, right) => right.trips - left.trips || right.tonnes - left.tonnes);
      const topSubproduct = subproducts[0];

      return {
        key: item.key,
        name: item.name,
        registration: item.registration,
        trips: item.trips,
        tonnes: Number(item.tonnes.toFixed(1)),
        cycleAverage: item.cycles.length
          ? item.cycles.reduce((sum, minutes) => sum + minutes, 0) / item.cycles.length
          : 0,
        betweenPlots: item.betweenPlots,
        pendingTickets: item.pendingTickets,
        topSubproduct: topSubproduct?.name ?? "-",
        topSubproductTrips: topSubproduct?.trips ?? 0,
        subproducts,
        farms: Array.from(item.farms).sort((left, right) => left.localeCompare(right)),
        lastDeposit: item.lastDeposit,
        lastTicket: item.lastTicket,
      };
    })
    .sort((left, right) => right.trips - left.trips || right.tonnes - left.tonnes);
}

function buildFarmTripData(deposits: FieldDeposit[], ticketMaps: TicketMaps, farmFilter: AnalysisFarmFilter): FarmTripItem[] {
  const farms = farmFilter === "all" ? focusFarms : focusFarms.filter((farm) => farm.id === farmFilter);

  return farms.map((farm) => {
    const farmDeposits = deposits.filter((deposit) => getFocusFarmId(deposit.farm) === farm.id);
    const tonnes = farmDeposits.reduce((sum, deposit) => {
      const ticket = getTicketForDeposit(deposit, ticketMaps);
      return sum + (ticket ? ticket.netWeightKg / 1000 : 0);
    }, 0);

    return {
      id: farm.id,
      name: farm.label,
      viagens: farmDeposits.length,
      toneladas: Number(tonnes.toFixed(1)),
      entreParcelas: farmDeposits.filter((deposit) => deposit.placementMode === "between_plots").length,
      pendencias: farmDeposits.filter((deposit) => !getTicketForDeposit(deposit, ticketMaps)).length,
    };
  });
}

function buildParcelRankData(deposits: FieldDeposit[], ticketMaps: TicketMaps): ParcelRankItem[] {
  const grouped = new Map<string, ParcelRankItem>();

  deposits.forEach((deposit) => {
    const farmId = getFocusFarmId(deposit.farm);
    if (!farmId) return;

    const farmLabel = focusFarms.find((farm) => farm.id === farmId)?.label ?? deposit.farm;
    const touchedParcels = Array.from(new Set(
      [deposit.plotPrimary, deposit.plotSecondary]
        .filter(Boolean)
        .map((parcel) => parcel.trim().toUpperCase()),
    ));
    const ticket = getTicketForDeposit(deposit, ticketMaps);
    const sharedTonnes = ticket ? (ticket.netWeightKg / 1000) / Math.max(1, touchedParcels.length) : 0;

    touchedParcels.forEach((parcel) => {
      const key = `${farmId}-${normalizeParcelCode(parcel)}`;
      const current = grouped.get(key) ?? {
        key,
        farmId,
        farmLabel,
        parcel,
        label: `${farmLabel} ${parcel}`,
        trips: 0,
        tonnes: 0,
        betweenPlots: 0,
        pendingTickets: 0,
      };

      current.trips += 1;
      current.tonnes += sharedTonnes;
      current.betweenPlots += deposit.placementMode === "between_plots" ? 1 : 0;
      current.pendingTickets += ticket ? 0 : 1;
      grouped.set(key, current);
    });
  });

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      tonnes: Number(item.tonnes.toFixed(1)),
    }))
    .sort((left, right) => right.trips - left.trips || right.tonnes - left.tonnes)
    .slice(0, 6);
}

function buildVehicleControlData(deposits: FieldDeposit[], ticketMaps: TicketMaps): VehicleControlItem[] {
  const grouped = new Map<
    string,
    {
      plate: string;
      trips: number;
      tonnes: number;
      betweenPlots: number;
      pendingTickets: number;
      drivers: Set<string>;
      farms: Set<string>;
      lastDeposit: FieldDeposit;
    }
  >();

  deposits.forEach((deposit) => {
    const plate = deposit.vehiclePlate || "SEM PLACA";
    const ticket = getTicketForDeposit(deposit, ticketMaps);
    const current = grouped.get(plate) ?? {
      plate,
      trips: 0,
      tonnes: 0,
      betweenPlots: 0,
      pendingTickets: 0,
      drivers: new Set<string>(),
      farms: new Set<string>(),
      lastDeposit: deposit,
    };

    current.trips += 1;
    current.tonnes += ticket ? ticket.netWeightKg / 1000 : 0;
    current.betweenPlots += deposit.placementMode === "between_plots" ? 1 : 0;
    current.pendingTickets += ticket ? 0 : 1;
    current.drivers.add(deposit.driverName || deposit.driverRegistration);
    current.farms.add(deposit.farm);

    if (`${deposit.depositDate}T${deposit.depositTime}` > `${current.lastDeposit.depositDate}T${current.lastDeposit.depositTime}`) {
      current.lastDeposit = deposit;
    }

    grouped.set(plate, current);
  });

  return Array.from(grouped.values())
    .map((item) => {
      const fleetVehicle = findFleetVehicleByPlate(item.plate);

      return {
        fleetNumber: fleetVehicle?.fleetNumber ?? "Sem frota",
        plate: item.plate,
        displayPlate: fleetVehicle?.plate ?? item.plate,
        vehicleDescription: fleetVehicle?.description ?? "Veículo sem cadastro",
        operationalClass: fleetVehicle?.operationalClass ?? "Classe não definida",
        trips: item.trips,
        tonnes: Number(item.tonnes.toFixed(1)),
        betweenPlots: item.betweenPlots,
        pendingTickets: item.pendingTickets,
        drivers: Array.from(item.drivers).sort((left, right) => left.localeCompare(right)),
        farms: Array.from(item.farms).sort((left, right) => left.localeCompare(right)),
        lastDeposit: item.lastDeposit,
      };
    })
    .sort((left, right) => right.trips - left.trips || right.tonnes - left.tonnes);
}

function groupFarmPerformance(deposits: FieldDeposit[], ticketMaps: TicketMaps) {
  const grouped = new Map<
    string,
    { name: string; coletas: number; toneladas: number; pendencias: number; ciclos: number[] }
  >();

  deposits.forEach((deposit) => {
    const ticket = getTicketForDeposit(deposit, ticketMaps);
    const current = grouped.get(deposit.farm) ?? {
      name: deposit.farm,
      coletas: 0,
      toneladas: 0,
      pendencias: 0,
      ciclos: [],
    };

    current.coletas += 1;
    current.toneladas += ticket ? ticket.netWeightKg / 1000 : 0;
    current.pendencias += ticket ? 0 : 1;
    if (ticket) current.ciclos.push(getCycleMinutes(ticket));
    grouped.set(deposit.farm, current);
  });

  return Array.from(grouped.values())
    .sort((left, right) => right.toneladas - left.toneladas || right.coletas - left.coletas)
    .map((item) => ({
      ...item,
      toneladas: Number(item.toneladas.toFixed(1)),
      cicloMedio: item.ciclos.length
        ? item.ciclos.reduce((sum, minutes) => sum + minutes, 0) / item.ciclos.length
        : 0,
    }));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildEvaluationData(summary: DashboardMetrics) {
  const syncRate = summary.deposits ? (summary.synced / summary.deposits) * 100 : 0;
  const cycleScore = summary.deposits ? 100 - (summary.longCycles / summary.deposits) * 100 : 100;

  return [
    { name: "Conciliação", score: clampScore(summary.ticketRate) },
    { name: "GPS", score: clampScore(summary.gpsCoverage) },
    { name: "Sync", score: clampScore(syncRate) },
    { name: "Ciclo", score: clampScore(cycleScore) },
  ];
}

function buildFarmEvaluationData(farms: ReturnType<typeof groupFarmPerformance>) {
  return farms.slice(0, 5).map((farm) => {
    const pendingPenalty = farm.coletas ? (farm.pendencias / farm.coletas) * 42 : 0;
    const cyclePenalty = Math.max(0, (farm.cicloMedio - 150) / 90) * 28;

    return {
      name: farm.name,
      score: clampScore(100 - pendingPenalty - cyclePenalty),
    };
  });
}

function getReconciliationIssues(deposits: FieldDeposit[], ticketMaps: TicketMaps) {
  return deposits
    .flatMap((deposit) => {
      const ticket = getTicketForDeposit(deposit, ticketMaps);
      if (!ticket) return [];

      const issues = [
        deposit.vehiclePlate !== ticket.vehiclePlate ? "Placa diferente" : "",
        deposit.driverRegistration !== ticket.driverRegistration ? "Motorista diferente" : "",
        deposit.subproduct !== ticket.subproduct ? "Subproduto diferente" : "",
      ].filter(Boolean);

      return issues.length ? [{ deposit, ticket, issues }] : [];
    })
    .slice(0, 8);
}

function buildPriorityItems(deposits: FieldDeposit[], ticketMaps: TicketMaps): PriorityItem[] {
  return deposits
    .map((deposit) => {
      const ticket = getTicketForDeposit(deposit, ticketMaps);
      const reasons = [
        !ticket ? "Aguardando ticket" : "",
        deposit.syncStatus !== "synced" ? "Fila local" : "",
        !deposit.latitude || !deposit.longitude ? "Sem GPS" : "",
        deposit.locationAccuracy && deposit.locationAccuracy > 25 ? "GPS baixa precisao" : "",
        ticket && getCycleMinutes(ticket) > 180 ? "Ciclo acima de 3h" : "",
      ].filter(Boolean);

      return {
        deposit,
        reasons,
        severity: reasons.includes("Aguardando ticket") || deposit.syncStatus === "error" ? 3 : reasons.length,
      };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((left, right) => {
      if (right.severity !== left.severity) return right.severity - left.severity;
      return `${right.deposit.depositDate}T${right.deposit.depositTime}`.localeCompare(
        `${left.deposit.depositDate}T${left.deposit.depositTime}`,
      );
    });
}

function formatPlot(deposit: FieldDeposit) {
  if (deposit.placementMode === "between_plots") {
    return `${deposit.plotPrimary} / ${deposit.plotSecondary || "-"}`;
  }

  return deposit.plotPrimary;
}

function formatCompactTonnes(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} t`;
}

function formatDriverSubproductMix(subproducts: DriverControlItem["subproducts"]) {
  if (!subproducts.length) return "-";
  if (subproducts.length === 1) return subproducts[0].name;

  const visibleNames = subproducts.slice(0, 2).map((subproduct) => subproduct.name).join(" + ");
  const remaining = subproducts.length > 2 ? ` +${subproducts.length - 2}` : "";

  return `${subproducts.length} tipos: ${visibleNames}${remaining}`;
}

function formatDriverSubproductDetail(subproducts: DriverControlItem["subproducts"]) {
  if (!subproducts.length) return "-";

  return subproducts
    .slice(0, 4)
    .map((subproduct) => `${subproduct.name} ${subproduct.trips}v`)
    .join(" · ");
}

interface DailyChartLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
}

function chartNumber(value: number | string | undefined, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function DailyBarCountLabel({ x, y, width, height, value }: DailyChartLabelProps) {
  const count = chartNumber(value);

  if (!count) return null;

  const barX = chartNumber(x);
  const barY = chartNumber(y);
  const barWidth = chartNumber(width);
  const barHeight = chartNumber(height);
  const labelX = barX + (barWidth / 2);
  const labelOffset = barHeight < 38
    ? Math.max(12, barHeight / 2)
    : Math.min(barHeight - 18, Math.max(28, barHeight * 0.42));
  const labelY = barY + labelOffset;

  return (
    <g className="daily-bar-count-label">
      <rect x={labelX - 12} y={labelY - 9} width={24} height={16} rx={8} />
      <text x={labelX} y={labelY + 4} textAnchor="middle">
        {count.toLocaleString("pt-BR")}
      </text>
    </g>
  );
}

function DailyTonnesLabel({ x, y, value }: DailyChartLabelProps) {
  const tonnes = chartNumber(value);

  if (!tonnes) return null;

  const label = formatCompactTonnes(tonnes);
  const labelX = chartNumber(x);
  const labelY = Math.max(14, chartNumber(y) - 18);
  const labelWidth = Math.max(32, label.length * 5.8);

  return (
    <g className="daily-tonnes-label" transform={`translate(${labelX} ${labelY})`}>
      <rect x={-labelWidth / 2} y={-11} width={labelWidth} height={17} rx={7} />
      <text y={2.8} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value).toLocaleString("pt-BR")}%`;
}

function syncLabel(status: SyncStatus) {
  if (status === "synced") return "Sincronizado";
  if (status === "syncing") return "Sincronizando";
  if (status === "error") return "Erro";
  return "Pendente";
}

function escapeCsv(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv(deposits: FieldDeposit[], ticketMaps: TicketMaps) {
  const rows = [
    [
      "Data",
      "Hora",
      "Ticket",
      "Placa",
      "Matricula",
      "Motorista",
      "Origem",
      "Fazenda",
      "Parcela",
      "Subproduto",
      "Peso liquido",
      "Ciclo balanca",
      "GPS",
      "Status ticket",
      "Sync",
    ],
    ...deposits.map((deposit) => {
      const ticket = getTicketForDeposit(deposit, ticketMaps);

      return [
        deposit.depositDate,
        deposit.depositTime,
        ticket?.ticketCode || deposit.scaleTicketCode || "",
        deposit.vehiclePlate,
        deposit.driverRegistration,
        deposit.driverName,
        getLoadingOrigin(deposit),
        deposit.farm,
        formatPlot(deposit),
        deposit.subproduct,
        ticket ? formatTonnes(ticket.netWeightKg) : "",
        ticket ? formatMinutes(getCycleMinutes(ticket)) : "",
        deposit.latitude && deposit.longitude ? `${deposit.latitude}, ${deposit.longitude}` : "",
        ticket ? "Conciliado" : "Aguardando",
        syncLabel(deposit.syncStatus),
      ];
    }),
  ];
  const csv = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `subprodutos-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function Dashboard({ deposits, scaleTickets }: DashboardProps) {
  const [activeView, setActiveView] = useState<DashboardView>("geral");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [selectedDepositId, setSelectedDepositId] = useState<string | null>(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [selectedFarmId, setSelectedFarmId] = useState<AnalysisFarmFilter>("all");
  const [selectedDriverKey, setSelectedDriverKey] = useState<string | null>(null);
  const [selectedAnalysisSubproduct, setSelectedAnalysisSubproduct] = useState<string | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [farmMapViews, setFarmMapViews] = useState<Record<FarmId, FarmMapViewState>>(initialFarmMapViews);
  const [draggingMap, setDraggingMap] = useState<MapDragState | null>(null);

  const ticketMaps = useMemo(() => buildTicketMaps(scaleTickets), [scaleTickets]);
  const scopedDeposits = useMemo(
    () => deposits.filter((deposit) => getFocusFarmId(deposit.farm)),
    [deposits],
  );
  const filteredDeposits = useMemo(
    () => filterDeposits(scopedDeposits, ticketMaps, filters),
    [scopedDeposits, filters, ticketMaps],
  );
  const matchedTickets = useMemo(
    () => getMatchedTickets(filteredDeposits, ticketMaps),
    [filteredDeposits, ticketMaps],
  );
  const unmatchedScaleTickets = useMemo(
    () => getUnmatchedScaleTickets(filteredDeposits, scaleTickets, ticketMaps),
    [filteredDeposits, scaleTickets, ticketMaps],
  );
  const summary = useMemo(
    () => buildSummary(filteredDeposits, matchedTickets, ticketMaps),
    [filteredDeposits, matchedTickets, ticketMaps],
  );
  const farmOptions = useMemo(() => focusFarms.map((farm) => farm.filterValue), []);
  const subproductOptions = useMemo(
    () => uniqueSorted(scopedDeposits.map((deposit) => deposit.subproduct)),
    [scopedDeposits],
  );
  const originOptions = useMemo(
    () => uniqueSorted(scopedDeposits.map(getLoadingOrigin)),
    [scopedDeposits],
  );
  const subproductData = useMemo(() => groupBySubproduct(matchedTickets), [matchedTickets]);
  const farmData = useMemo(() => groupByFarm(filteredDeposits), [filteredDeposits]);
  const originData = useMemo(() => groupByOrigin(filteredDeposits, ticketMaps), [filteredDeposits, ticketMaps]);
  const reconciliationData = useMemo(() => groupByReconciliation(summary), [summary]);
  const dailyData = useMemo(() => groupByDay(filteredDeposits, ticketMaps), [filteredDeposits, ticketMaps]);
  const driverData = useMemo(() => groupByDriver(filteredDeposits, ticketMaps), [filteredDeposits, ticketMaps]);
  const farmPerformance = useMemo(
    () => groupFarmPerformance(filteredDeposits, ticketMaps),
    [filteredDeposits, ticketMaps],
  );
  const analysisBaseDeposits = useMemo(
    () => (
      selectedAnalysisSubproduct
        ? filteredDeposits.filter((deposit) => deposit.subproduct === selectedAnalysisSubproduct)
        : filteredDeposits
    ),
    [filteredDeposits, selectedAnalysisSubproduct],
  );
  const analysisFarmDeposits = useMemo(
    () => (
      selectedFarmId === "all"
        ? analysisBaseDeposits
        : analysisBaseDeposits.filter((deposit) => getFocusFarmId(deposit.farm) === selectedFarmId)
    ),
    [analysisBaseDeposits, selectedFarmId],
  );
  const analysisLocationDeposits = useMemo(
    () => (
      selectedParcel
        ? analysisFarmDeposits.filter((deposit) => (
          getFocusFarmId(deposit.farm) === selectedParcel.farmId
            && (
              deposit.plotPrimary === selectedParcel.label
              || deposit.plotSecondary === selectedParcel.label
            )
        ))
        : analysisFarmDeposits
    ),
    [analysisFarmDeposits, selectedParcel],
  );
  const analysisLocationApprovedDeposits = useMemo(
    () => analysisLocationDeposits.filter((deposit) => getTicketForDeposit(deposit, ticketMaps)),
    [analysisLocationDeposits, ticketMaps],
  );
  const driverControlData = useMemo(
    () => buildDriverControlData(analysisLocationApprovedDeposits, ticketMaps),
    [analysisLocationApprovedDeposits, ticketMaps],
  );
  const selectedDriverData = useMemo(
    () => (selectedDriverKey ? driverControlData.find((driver) => driver.key === selectedDriverKey) ?? null : null),
    [driverControlData, selectedDriverKey],
  );
  const analysisDriverDeposits = useMemo(
    () => (
      selectedDriverKey
        ? analysisLocationDeposits.filter((deposit) => getDriverKey(deposit) === selectedDriverKey)
        : analysisLocationDeposits
    ),
    [analysisLocationDeposits, selectedDriverKey],
  );
  const analysisDeposits = useMemo(
    () => analysisDriverDeposits.filter((deposit) => getTicketForDeposit(deposit, ticketMaps)),
    [analysisDriverDeposits, ticketMaps],
  );
  const farmMapData = useMemo(
    () => buildFarmMaps(analysisDeposits, ticketMaps),
    [analysisDeposits, ticketMaps],
  );
  const analysisMatchedTickets = useMemo(
    () => getMatchedTickets(analysisDeposits, ticketMaps),
    [analysisDeposits, ticketMaps],
  );
  const analysisSummary = useMemo(
    () => buildSummary(analysisDeposits, analysisMatchedTickets, ticketMaps),
    [analysisDeposits, analysisMatchedTickets, ticketMaps],
  );
  const analysisSubproductData = useMemo(() => groupBySubproduct(analysisMatchedTickets), [analysisMatchedTickets]);
  const analysisDailyData = useMemo(
    () => groupByDay(analysisDeposits, ticketMaps),
    [analysisDeposits, ticketMaps],
  );
  const parcelRankData = useMemo(
    () => buildParcelRankData(analysisDeposits, ticketMaps),
    [analysisDeposits, ticketMaps],
  );
  const vehicleControlData = useMemo(
    () => buildVehicleControlData(analysisDeposits, ticketMaps),
    [analysisDeposits, ticketMaps],
  );
  const analysisFarmTotals = useMemo(
    () => buildFarmTripData(analysisDeposits, ticketMaps, "all"),
    [analysisDeposits, ticketMaps],
  );
  const selectedFarmLabel = getFocusFarmLabel(selectedFarmId);
  const analysisScopeLabel = [
    selectedFarmLabel,
    selectedParcel ? `Parcela ${selectedParcel.label}` : null,
    selectedAnalysisSubproduct,
    selectedDriverData?.name,
  ].filter(Boolean).join(" · ");
  const priorityItems = useMemo(
    () => buildPriorityItems(filteredDeposits, ticketMaps),
    [filteredDeposits, ticketMaps],
  );
  const reconciliationIssues = useMemo(
    () => getReconciliationIssues(filteredDeposits, ticketMaps),
    [filteredDeposits, ticketMaps],
  );
  const longestCycleItem = useMemo(() => (
    filteredDeposits
      .map((deposit) => ({ deposit, ticket: getTicketForDeposit(deposit, ticketMaps) }))
      .filter((item): item is { deposit: FieldDeposit; ticket: ScaleTicket } => Boolean(item.ticket))
      .sort((left, right) => getCycleMinutes(right.ticket) - getCycleMinutes(left.ticket))[0] ?? null
  ), [filteredDeposits, ticketMaps]);
  const pendingDeposits = useMemo(
    () => filteredDeposits.filter((deposit) => !getTicketForDeposit(deposit, ticketMaps)),
    [filteredDeposits, ticketMaps],
  );
  const selectedDeposit = useMemo(
    () => filteredDeposits.find((deposit) => deposit.id === selectedDepositId) ?? filteredDeposits[0] ?? null,
    [filteredDeposits, selectedDepositId],
  );
  const selectedTicket = selectedDeposit ? getTicketForDeposit(selectedDeposit, ticketMaps) : null;
  const hasFilters = Object.entries(filters).some(([key, value]) => (
    key === "ticketStatus" || key === "syncStatus" ? value !== "all" : Boolean(value)
  ));
  const hasAnalysisFilters = Boolean(
    hasFilters
      || selectedFarmId !== "all"
      || selectedAnalysisSubproduct
      || selectedDriverKey
      || selectedParcel,
  );
  const maxDriverTonnes = Math.max(...driverControlData.map((driver) => driver.tonnes), 1);
  const maxVehicleTrips = Math.max(...vehicleControlData.map((vehicle) => vehicle.trips), 1);
  const visibleDriverControlData = selectedDriverData
    ? [selectedDriverData]
    : driverControlData.slice(0, presentationMode ? 3 : 4);
  const visibleParcelRankData = (presentationMode ? parcelRankData.slice(0, 5) : parcelRankData).map((item) => ({
    ...item,
    metricLabel: `${item.trips} apl · ${formatCompactTonnes(item.tonnes)}`,
  }));
  const visibleParcelRankTotals = visibleParcelRankData.reduce(
    (total, item) => ({
      trips: total.trips + item.trips,
      tonnes: total.tonnes + item.tonnes,
    }),
    { trips: 0, tonnes: 0 },
  );
  const visibleVehicleControlData = presentationMode ? vehicleControlData.slice(0, 4) : vehicleControlData.slice(0, 5);
  const visibleDailyVehicleData = vehicleControlData.slice(0, 3);
  const maxDailyVehicleTonnes = Math.max(...visibleDailyVehicleData.map((vehicle) => vehicle.tonnes), 1);
  const maxFarmDataValue = Math.max(...farmData.map((farm) => farm.value), 1);
  const maxReconciliationValue = Math.max(...reconciliationData.map((item) => item.value), 1);
  const vilaNovaAnalysisTotal = analysisFarmTotals.find((farm) => farm.id === "vila-nova") ?? null;
  const feEmDeusAnalysisTotal = analysisFarmTotals.find((farm) => farm.id === "fe-em-deus") ?? null;
  const activeFarmMapId = selectedFarmId === "all" ? focusFarms[0].id : selectedFarmId;
  const activeFarmMap = farmMapData.find((farmMap) => farmMap.farm.id === activeFarmMapId) ?? farmMapData[0] ?? null;
  const combinedMapView = farmMapViews[activeFarmMapId] ?? defaultFarmMapView;
  const activeMapScopeLabel = selectedFarmId === "all"
    ? "Vila Nova + Fé em Deus"
    : activeFarmMap?.farm.label ?? "Fazendas";
  const totalMapParcels = farmMapData.reduce((sum, farmMap) => sum + farmMap.parcels.length, 0);
  const totalMapMarkers = farmMapData.reduce((sum, farmMap) => sum + farmMap.markers.length, 0);
  const totalMapHectares = farmMapData.reduce((sum, farmMap) => sum + farmMap.totalHectares, 0);
  const totalMapBetweenPlots = farmMapData.reduce(
    (sum, farmMap) => sum + farmMap.betweenDeposits,
    0,
  );
  const activeMapParcels = selectedFarmId === "all" ? totalMapParcels : activeFarmMap?.parcels.length ?? 0;
  const activeMapMarkers = selectedFarmId === "all" ? totalMapMarkers : activeFarmMap?.markers.length ?? 0;
  const activeMapHectares = selectedFarmId === "all" ? totalMapHectares : activeFarmMap?.totalHectares ?? 0;
  const activeMapBetweenPlots = selectedFarmId === "all"
    ? totalMapBetweenPlots
    : activeFarmMap?.betweenDeposits ?? 0;
  const isDraggingCombinedMap = Boolean(draggingMap && draggingMap.farmId === activeFarmMapId);

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
    setSelectedDriverKey(null);
    setSelectedParcel(null);
  };

  const clearAnalysisFilters = () => {
    setFilters(initialFilters);
    setSelectedFarmId("all");
    setSelectedAnalysisSubproduct(null);
    setSelectedDriverKey(null);
    setSelectedParcel(null);
    setSelectedDepositId(null);
  };

  const updateFarmMapView = (
    farmId: FarmId,
    updater: (view: FarmMapViewState) => FarmMapViewState,
  ) => {
    setFarmMapViews((current) => {
      const currentView = current[farmId] ?? defaultFarmMapView;
      return {
        ...current,
        [farmId]: updater(currentView),
      };
    });
  };

  const toggleFarmForAnalysis = (farmId: AnalysisFarmFilter) => {
    setSelectedFarmId((current) => (current === farmId ? "all" : farmId));
    setSelectedDriverKey(null);
    setSelectedParcel(null);
  };

  const toggleSubproductForAnalysis = (subproduct: string) => {
    setSelectedAnalysisSubproduct((current) => (current === subproduct ? null : subproduct));
    setSelectedDriverKey(null);
    setSelectedParcel(null);
  };

  const handleSubproductBarClick = (entry: unknown) => {
    const payload = entry as { name?: string; payload?: { name?: string } };
    const subproduct = payload.payload?.name ?? payload.name;

    if (subproduct) {
      toggleSubproductForAnalysis(subproduct);
    }
  };

  const selectParcelForAnalysis = (farm: FarmMapConfig, parcel: ProjectedParcel) => {
    setSelectedParcel({
      farmId: farm.id,
      farmLabel: farm.label,
      parcelId: parcel.id,
      label: parcel.label,
      hectares: parcel.hectares,
      year: parcel.year,
      depositCount: parcel.depositCount,
      tonnes: parcel.tonnes,
      betweenCount: parcel.betweenCount,
    });
    setSelectedFarmId(farm.id);
    setSelectedDriverKey(null);
  };

  const selectParcelRankItem = (item: ParcelRankItem) => {
    const farmMap = farmMapData.find((mapItem) => mapItem.farm.id === item.farmId);
    const parcel = farmMap?.parcels.find(
      (mapParcel) => normalizeParcelCode(mapParcel.label) === normalizeParcelCode(item.parcel),
    );

    if (farmMap && parcel) {
      selectParcelForAnalysis(farmMap.farm, parcel);
      return;
    }

    setSelectedFarmId(item.farmId);
    setSelectedDriverKey(null);
    setSelectedParcel(null);
  };

  const handleParcelRankBarClick = (entry: unknown) => {
    const item = (entry as { payload?: ParcelRankItem }).payload;
    if (item) {
      selectParcelRankItem(item);
    }
  };

  const zoomFarmMap = (farmId: FarmId, factor: number) => {
    updateFarmMapView(farmId, (view) => {
      const scale = clampMapScale(view.scale * factor);
      return {
        scale,
        x: clampMapOffset(view.x, scale, farmMapWidth),
        y: clampMapOffset(view.y, scale, farmMapHeight),
      };
    });
  };

  const resetFarmMap = (farmId: FarmId) => {
    setFarmMapViews((current) => ({
      ...current,
      [farmId]: defaultFarmMapView,
    }));
  };

  const handleMapWheel = (farmId: FarmId, event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoomFarmMap(farmId, event.deltaY < 0 ? 1.14 : 0.88);
  };

  const handleMapPointerDown = (
    farmId: FarmId,
    view: FarmMapViewState,
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (event.button !== 0) return;

    const target = event.target as Element;
    const mapTarget = target.closest("[data-farm-id]");
    const targetFarmId = (mapTarget?.getAttribute("data-farm-id") as FarmId | null) ?? farmId;
    const parcelId = target
      .closest(".geo-parcel-real, .geo-parcel-label-chip")
      ?.getAttribute("data-parcel-id") ?? undefined;
    const markerId = target.closest(".geo-marker")?.getAttribute("data-marker-id") ?? undefined;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingMap({
      farmId,
      targetFarmId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      parcelId,
      markerId,
    });
  };

  const handleMapPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingMap) return;

    updateFarmMapView(draggingMap.farmId, (view) => ({
      ...view,
      x: clampMapOffset(draggingMap.originX + event.clientX - draggingMap.startX, view.scale, farmMapWidth),
      y: clampMapOffset(draggingMap.originY + event.clientY - draggingMap.startY, view.scale, farmMapHeight),
    }));
  };

  const stopMapDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (draggingMap && event.currentTarget.hasPointerCapture(draggingMap.pointerId)) {
      event.currentTarget.releasePointerCapture(draggingMap.pointerId);
    }

    if (draggingMap) {
      const moved = Math.hypot(event.clientX - draggingMap.startX, event.clientY - draggingMap.startY);
      const farmMap = farmMapData.find((item) => item.farm.id === draggingMap.targetFarmId);

      if (moved < 6 && farmMap) {
        if (draggingMap.markerId) {
          const marker = farmMap.markers.find((item) => item.id === draggingMap.markerId);

          if (marker) {
            setSelectedDepositId(marker.id);
            setSelectedDriverKey(getDriverKey(marker.deposit));
            setSelectedFarmId(farmMap.farm.id);
            setSelectedParcel(null);
          }
        } else if (draggingMap.parcelId) {
          const parcel = farmMap.parcels.find((item) => item.id === draggingMap.parcelId);

          if (parcel) {
            selectParcelForAnalysis(farmMap.farm, parcel);
          }
        }
      }
    }

    setDraggingMap(null);
  };

  const exportFilteredCsv = () => {
    exportCsv(filteredDeposits, ticketMaps);
  };

  const startPresentation = () => {
    setActiveView("analise");
    setPresentationMode(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const stopPresentation = () => {
    setPresentationMode(false);
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
    }
  };

  return (
    <section className={`dashboard-view ${presentationMode ? "presentation-mode" : ""}`}>
      <div className="surface-heading dashboard-heading">
        <div>
          <p className="eyebrow">Operacao e analise</p>
          <h1>Dashboard Subprodutos</h1>
          <div className="header-meta">
            <span>Base Supabase</span>
            <span>Operação real</span>
            <span>Tomé-Açu / PA</span>
          </div>
        </div>
        <div className="dashboard-actions">
          {presentationMode ? (
            <button type="button" className="ghost-button compact presentation-toggle" onClick={stopPresentation}>
              <Minimize2 aria-hidden="true" />
              Sair
            </button>
          ) : (
            <button type="button" className="ghost-button compact presentation-toggle" onClick={startPresentation}>
              <Presentation aria-hidden="true" />
              Apresentação
            </button>
          )}
          <button type="button" className="ghost-button compact" onClick={exportFilteredCsv}>
            <Download aria-hidden="true" />
            CSV
          </button>
          <BarChart3 aria-hidden="true" />
        </div>
      </div>

      <div className="dashboard-tabs dashboard-tabs-4" role="tablist" aria-label="Areas do dashboard">
        <button
          type="button"
          className={activeView === "geral" ? "active" : ""}
          onClick={() => {
            setActiveView("geral");
            stopPresentation();
          }}
        >
          <Gauge aria-hidden="true" />
          Geral
        </button>
        <button
          type="button"
          className={activeView === "coletas" ? "active" : ""}
          onClick={() => {
            setActiveView("coletas");
            stopPresentation();
          }}
        >
          <ClipboardList aria-hidden="true" />
          Coletas
        </button>
        <button
          type="button"
          className={activeView === "conciliacao" ? "active" : ""}
          onClick={() => {
            setActiveView("conciliacao");
            stopPresentation();
          }}
        >
          <TicketCheck aria-hidden="true" />
          Conciliacao
        </button>
        <button
          type="button"
          className={activeView === "analise" ? "active" : ""}
          onClick={() => setActiveView("analise")}
        >
          <BarChart3 aria-hidden="true" />
          Analise
        </button>
      </div>

      {activeView !== "analise" ? (
        <>
          <section className="filter-panel" aria-label="Filtros do dashboard">
            <header>
              <div>
                <span className="panel-kicker">
                  <Filter aria-hidden="true" />
                  Filtros
                </span>
                <strong>{filteredDeposits.length} registros na selecao</strong>
              </div>
              <button
                type="button"
                className="ghost-button compact"
                onClick={() => setFilters(initialFilters)}
                disabled={!hasFilters}
              >
                <X aria-hidden="true" />
                Limpar
              </button>
            </header>

            <div className="filter-grid filter-grid-extended">
              <label className="search-filter">
                Buscar
                <span className="input-icon">
                  <Search aria-hidden="true" />
                  <input
                    value={filters.search}
                    onChange={(event) => updateFilter("search", event.target.value)}
                    placeholder="Ticket, placa, motorista ou parcela"
                  />
                </span>
              </label>

              <label>
                De
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => updateFilter("dateFrom", event.target.value)}
                />
              </label>

              <label>
                Ate
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => updateFilter("dateTo", event.target.value)}
                />
              </label>

              <label>
                Fazenda
                <select value={filters.farm} onChange={(event) => updateFilter("farm", event.target.value)}>
                  <option value="">Todas</option>
                  {farmOptions.map((farm) => (
                    <option key={farm} value={farm}>
                      {farm}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Subproduto
                <select
                  value={filters.subproduct}
                  onChange={(event) => updateFilter("subproduct", event.target.value)}
                >
                  <option value="">Todos</option>
                  {subproductOptions.map((subproduct) => (
                    <option key={subproduct} value={subproduct}>
                      {subproduct}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Origem
                <select
                  value={filters.loadingOrigin}
                  onChange={(event) => updateFilter("loadingOrigin", event.target.value)}
                >
                  <option value="">Todas</option>
                  {originOptions.map((origin) => (
                    <option key={origin} value={origin}>
                      {origin}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Ticket
                <select
                  value={filters.ticketStatus}
                  onChange={(event) => updateFilter("ticketStatus", event.target.value as TicketStatusFilter)}
                >
                  <option value="all">Todos</option>
                  <option value="matched">Conciliados</option>
                  <option value="pending">Aguardando</option>
                </select>
              </label>

              <label>
                Sync
                <select
                  value={filters.syncStatus}
                  onChange={(event) => updateFilter("syncStatus", event.target.value as SyncStatusFilter)}
                >
                  <option value="all">Todos</option>
                  <option value="synced">Sincronizados</option>
                  <option value="pending">Fila local</option>
                  <option value="error">Erro</option>
                </select>
              </label>
            </div>
          </section>

          <div className="metrics-grid metrics-grid-6">
            <article className="metric-card">
              <Truck aria-hidden="true" />
              <span>Registros campo</span>
              <strong>{summary.deposits}</strong>
              <small>{summary.betweenPlots} entre parcelas</small>
            </article>
            <article className="metric-card">
              <DatabaseZap aria-hidden="true" />
              <span>Conciliacao</span>
              <strong>{formatPercent(summary.ticketRate)}</strong>
              <small>
                {summary.matchedTickets}/{summary.deposits} com ticket
              </small>
            </article>
            <article className="metric-card">
              <Scale aria-hidden="true" />
              <span>Peso balanca</span>
              <strong>{summary.totalTonnes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} t</strong>
              <small>Media {formatCompactTonnes(summary.averageTonnes)}</small>
            </article>
            <article className="metric-card">
              <Clock3 aria-hidden="true" />
              <span>Ciclo medio</span>
              <strong>{formatMinutes(summary.averageCycleMinutes)}</strong>
              <small>{summary.longCycles} acima de 3h</small>
            </article>
            <article className="metric-card">
              <MapPinned aria-hidden="true" />
              <span>GPS na coleta</span>
              <strong>{formatPercent(summary.gpsCoverage)}</strong>
              <small>Precisao media {Math.round(summary.averageAccuracy || 0)} m</small>
            </article>
            <article className="metric-card">
              <WifiOff aria-hidden="true" />
              <span>Fila local</span>
              <strong>{summary.pendingSync}</strong>
              <small>{summary.synced} sincronizadas</small>
            </article>
          </div>
        </>
      ) : null}

      {activeView === "geral" ? (
        <>
          <div className="executive-grid">
            <article className="collection-panel">
              <header>
                <span className="panel-kicker">
                  <AlertTriangle aria-hidden="true" />
                  Atencao
                </span>
                <h2>Pendencias operacionais</h2>
              </header>
              <div className="alert-list">
                <div className={`alert-row ${summary.pendingTickets ? "alert-warn" : "alert-ok"}`}>
                  <TicketCheck aria-hidden="true" />
                  <div>
                    <strong>{summary.pendingTickets} coletas aguardando ticket</strong>
                    <span>Conciliacao com a balanca para liberar analise final.</span>
                  </div>
                </div>
                <div className={`alert-row ${summary.pendingSync ? "alert-warn" : "alert-ok"}`}>
                  <WifiOff aria-hidden="true" />
                  <div>
                    <strong>{summary.pendingSync} registros na fila local</strong>
                    <span>Motorista ainda nao enviou ou precisa de Wi-Fi.</span>
                  </div>
                </div>
                <div className={`alert-row ${summary.missingGps ? "alert-warn" : "alert-ok"}`}>
                  <MapPinned aria-hidden="true" />
                  <div>
                    <strong>{summary.missingGps} coletas sem GPS</strong>
                    <span>Validar evidencias quando o ponto nao foi capturado.</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="collection-panel">
              <header>
                <span className="panel-kicker">
                  <ListChecks aria-hidden="true" />
                  Revisao
                </span>
                <h2>Fila de conferencia</h2>
              </header>
              <div className="review-list">
                {priorityItems.length > 0 ? (
                  priorityItems.slice(0, 5).map((item) => (
                    <button
                      type="button"
                      className="review-item"
                      key={item.deposit.id}
                      onClick={() => {
                        setSelectedDepositId(item.deposit.id);
                        setActiveView("coletas");
                      }}
                    >
                      <div>
                        <strong>{item.deposit.scaleTicketCode || "Sem ticket"}</strong>
                        <span>
                          {item.deposit.farm} · {formatPlot(item.deposit)}
                        </span>
                      </div>
                      <em>{item.reasons.join(" · ")}</em>
                    </button>
                  ))
                ) : (
                  <div className="empty-inline">Nenhuma pendencia critica nos filtros atuais.</div>
                )}
              </div>
            </article>
          </div>

          <div className="chart-grid">
            <article className="chart-panel wide">
              <header>
                <h2>Fluxo diario</h2>
                <span className="chart-note">Coletas e peso conciliado</span>
              </header>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="dia" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar yAxisId="left" dataKey="coletas" name="Coletas" fill="#1e5c3a" radius={[6, 6, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="toneladas"
                    name="Toneladas"
                    stroke="#2f6f9f"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </article>

            <article className="chart-panel">
              <header>
                <h2>Origem do carregamento</h2>
              </header>
              <div className="origin-list">
                {originData.map((item, index) => (
                  <div className="origin-row" key={item.name}>
                    <div>
                      <i style={{ background: chartColors[index % chartColors.length] }} />
                      <strong>{item.name}</strong>
                      <span>{item.coletas} coletas</span>
                    </div>
                    <em>{formatCompactTonnes(item.toneladas)}</em>
                  </div>
                ))}
              </div>
            </article>

            <article className="chart-panel">
              <header>
                <h2>Destino por fazenda</h2>
                <Layers3 aria-hidden="true" />
              </header>
              <div className="status-progress-list">
                {farmData.map((item, index) => (
                  <button
                    type="button"
                    className="status-progress-row"
                    key={item.name}
                    onClick={() => updateFilter("farm", item.name)}
                  >
                    <div>
                      <span>
                        <i style={{ background: chartColors[index % chartColors.length] }} />
                        {item.name}
                      </span>
                      <strong>{item.value} viagens</strong>
                      <em>
                        {formatCompactTonnes(
                          farmPerformance.find((farm) => farm.name === item.name)?.toneladas ?? 0,
                        )}
                      </em>
                    </div>
                    <b>
                      <i
                        style={{
                          width: `${Math.max(6, (item.value / maxFarmDataValue) * 100)}%`,
                          background: chartColors[index % chartColors.length],
                        }}
                      />
                    </b>
                  </button>
                ))}
              </div>
            </article>
          </div>
        </>
      ) : null}

      {activeView === "coletas" ? (
        <>
          <div className="collection-grid collection-grid-detail">
            <article className="collection-panel">
              <header>
                <span className="panel-kicker">
                  <ListChecks aria-hidden="true" />
                  Operacao
                </span>
                <h2>Coletas aguardando ticket</h2>
              </header>
              <div className="pending-list">
                {pendingDeposits.length > 0 ? (
                  pendingDeposits.slice(0, 6).map((deposit) => (
                    <button
                      type="button"
                      className="pending-item pending-button"
                      key={deposit.id}
                      onClick={() => setSelectedDepositId(deposit.id)}
                    >
                      <div>
                        <strong>{deposit.scaleTicketCode || "Sem ticket"}</strong>
                        <span>
                          {deposit.farm} · {formatPlot(deposit)} · {getLoadingOrigin(deposit)}
                        </span>
                      </div>
                      <span className="reconcile-pill reconcile-pending">Aguardando</span>
                    </button>
                  ))
                ) : (
                  <div className="empty-inline">Nenhuma coleta aguardando ticket nesta selecao.</div>
                )}
              </div>
            </article>

            <article className="detail-panel">
              <header>
                <span className="panel-kicker">
                  <ClipboardCheck aria-hidden="true" />
                  Detalhe
                </span>
                <h2>{selectedDeposit ? selectedDeposit.scaleTicketCode || selectedDeposit.id : "Sem registro"}</h2>
              </header>
              {selectedDeposit ? (
                <>
                  <div className="detail-grid">
                    <div>
                      <span>Motorista</span>
                      <strong>{selectedDeposit.driverName || selectedDeposit.driverRegistration}</strong>
                    </div>
                    <div>
                      <span>Veiculo</span>
                      <strong>{selectedDeposit.vehiclePlate}</strong>
                    </div>
                    <div>
                      <span>Destino</span>
                      <strong>
                        {selectedDeposit.farm} · {formatPlot(selectedDeposit)}
                      </strong>
                    </div>
                    <div>
                      <span>Origem</span>
                      <strong>{getLoadingOrigin(selectedDeposit)}</strong>
                    </div>
                    <div>
                      <span>Subproduto</span>
                      <strong>{selectedDeposit.subproduct}</strong>
                    </div>
                    <div>
                      <span>Balanca</span>
                      <strong>{selectedTicket ? formatTonnes(selectedTicket.netWeightKg) : "Aguardando"}</strong>
                    </div>
                    <div>
                      <span>Ciclo</span>
                      <strong>{selectedTicket ? formatMinutes(getCycleMinutes(selectedTicket)) : "-"}</strong>
                    </div>
                    <div>
                      <span>GPS</span>
                      <strong>
                        {selectedDeposit.latitude && selectedDeposit.longitude
                          ? `${selectedDeposit.latitude}, ${selectedDeposit.longitude}`
                          : "Nao capturado"}
                      </strong>
                    </div>
                    <div>
                      <span>Foto</span>
                      <strong>
                        {selectedDeposit.dumpPhotoDataUrl
                          ? selectedDeposit.dumpPhotoLatitude && selectedDeposit.dumpPhotoLongitude
                            ? "Anexada com GPS"
                            : "Anexada"
                          : "Nao anexada"}
                      </strong>
                    </div>
                  </div>
                  {selectedDeposit.dumpPhotoDataUrl ? (
                    <img
                      className="deposit-photo-preview"
                      src={selectedDeposit.dumpPhotoDataUrl}
                      alt="Foto do despejo"
                    />
                  ) : null}
                </>
              ) : (
                <div className="empty-inline">Selecione uma coleta na tabela.</div>
              )}
            </article>
          </div>

          <article className="table-panel">
            <header>
              <div>
                <h2>Coletas de campo</h2>
                <span className="table-caption">Registros filtrados com situacao de balanca, GPS e sync</span>
              </div>
            </header>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Ticket</th>
                    <th>Veiculo</th>
                    <th>Motorista</th>
                    <th>Origem</th>
                    <th>Fazenda</th>
                    <th>Parcelas</th>
                    <th>Subproduto</th>
                    <th>Balanca</th>
                    <th>GPS</th>
                    <th>Sync</th>
                    <th>Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeposits.length > 0 ? (
                    filteredDeposits.map((deposit) => {
                      const ticket = getTicketForDeposit(deposit, ticketMaps);
                      const ticketCode = ticket?.ticketCode ?? deposit.scaleTicketCode;

                      return (
                        <tr
                          key={deposit.id}
                          className={selectedDeposit?.id === deposit.id ? "selected-row" : ""}
                        >
                          <td>{formatDate(deposit.depositDate)}</td>
                          <td>{ticketCode || "-"}</td>
                          <td>{deposit.vehiclePlate}</td>
                          <td>{deposit.driverName || deposit.driverRegistration}</td>
                          <td>{getLoadingOrigin(deposit)}</td>
                          <td>{deposit.farm}</td>
                          <td>{formatPlot(deposit)}</td>
                          <td>{deposit.subproduct}</td>
                          <td>
                            <span className="scale-cell">
                              <strong>{ticket ? formatTonnes(ticket.netWeightKg) : "-"}</strong>
                              <small>{ticket ? formatMinutes(getCycleMinutes(ticket)) : "-"}</small>
                            </span>
                          </td>
                          <td>
                            <span className={`mini-chip ${deposit.latitude && deposit.longitude ? "ok" : "warn"}`}>
                              {deposit.latitude && deposit.longitude ? "GPS" : "Sem GPS"}
                            </span>
                          </td>
                          <td>
                            <span className={`mini-chip sync-${deposit.syncStatus}`}>
                              {syncLabel(deposit.syncStatus)}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="row-action"
                              onClick={() => setSelectedDepositId(deposit.id)}
                            >
                              Abrir
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="empty-table-cell" colSpan={12}>
                        Nenhum registro encontrado para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {activeView === "conciliacao" ? (
        <>
          <div className="reconciliation-layout">
            <article className="collection-panel">
              <header>
                <span className="panel-kicker">
                  <TicketCheck aria-hidden="true" />
                  Conciliacao
                </span>
                <h2>Campo x balanca</h2>
              </header>
              <div className="compact-stat-grid compact-stat-grid-3">
                <div>
                  <span>Conciliados</span>
                  <strong>{summary.matchedTickets}</strong>
                </div>
                <div>
                  <span>Aguardando ticket</span>
                  <strong>{summary.pendingTickets}</strong>
                </div>
                <div>
                  <span>Tickets sem coleta</span>
                  <strong>{unmatchedScaleTickets.length}</strong>
                </div>
              </div>
              <div className="reconciliation-chart">
                <div className="status-progress-list reconciliation-progress-list">
                  {reconciliationData.map((item, index) => (
                    <div className="status-progress-row" key={item.name}>
                      <div>
                        <span>
                          <i style={{ background: reconciliationColors[index % reconciliationColors.length] }} />
                          {item.name}
                        </span>
                        <strong>{item.value} registros</strong>
                        <em>{formatPercent(summary.deposits ? (item.value / Math.max(summary.deposits, 1)) * 100 : 0)}</em>
                      </div>
                      <b>
                        <i
                          style={{
                            width: `${Math.max(6, (item.value / maxReconciliationValue) * 100)}%`,
                            background: reconciliationColors[index % reconciliationColors.length],
                          }}
                        />
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="collection-panel">
              <header>
                <span className="panel-kicker">
                  <AlertTriangle aria-hidden="true" />
                  Divergencias
                </span>
                <h2>Conferencias automaticas</h2>
              </header>
              <div className="review-list">
                {reconciliationIssues.length > 0 ? (
                  reconciliationIssues.map((item) => (
                    <button
                      type="button"
                      className="review-item"
                      key={`${item.deposit.id}-${item.ticket.id}`}
                      onClick={() => setSelectedDepositId(item.deposit.id)}
                    >
                      <div>
                        <strong>{item.ticket.ticketCode}</strong>
                        <span>{item.deposit.vehiclePlate}</span>
                      </div>
                      <em>{item.issues.join(" · ")}</em>
                    </button>
                  ))
                ) : (
                  <div className="empty-inline">Nenhuma divergencia automatica nos registros conciliados.</div>
                )}
              </div>
            </article>
          </div>

          <article className="table-panel">
            <header>
              <div>
                <h2>Fila de conciliacao</h2>
                <span className="table-caption">Registros que precisam de importacao ou ajuste de ticket</span>
              </div>
            </header>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data campo</th>
                    <th>Ticket informado</th>
                    <th>Placa</th>
                    <th>Motorista</th>
                    <th>Destino</th>
                    <th>Status</th>
                    <th>Acao sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingDeposits.length > 0 ? (
                    pendingDeposits.map((deposit) => (
                      <tr key={deposit.id}>
                        <td>{formatDate(deposit.depositDate)}</td>
                        <td>{deposit.scaleTicketCode || "-"}</td>
                        <td>{deposit.vehiclePlate}</td>
                        <td>{deposit.driverName || deposit.driverRegistration}</td>
                        <td>
                          {deposit.farm} · {formatPlot(deposit)}
                        </td>
                        <td>
                          <span className="reconcile-pill reconcile-pending">Aguardando</span>
                        </td>
                        <td>Buscar ticket de balanca por placa/data</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="empty-table-cell" colSpan={7}>
                        Todas as coletas filtradas estao conciliadas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {activeView === "analise" ? (
        <section className="analysis-presentation" aria-label="Analise em uma tela">
          <article className="chart-panel analysis-filter-card">
            <header>
              <div>
                <h2>Filtros da análise</h2>
                <span className="chart-note">
                  {analysisScopeLabel} · {analysisSummary.deposits} viagens · {formatCompactTonnes(analysisSummary.totalTonnes)}
                </span>
              </div>
              <button
                type="button"
                className="ghost-button compact"
                disabled={!hasAnalysisFilters}
                onClick={clearAnalysisFilters}
              >
                <X aria-hidden="true" />
                Limpar
              </button>
            </header>
            <div className="analysis-filter-grid">
              <label>
                Buscar
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="Placa, motorista, parcela"
                />
              </label>
              <label>
                Fazenda
                <select
                  value={selectedFarmId}
                  onChange={(event) => toggleFarmForAnalysis(event.target.value as AnalysisFarmFilter)}
                >
                  <option value="all">Todas</option>
                  {focusFarms.map((farm) => (
                    <option key={farm.id} value={farm.id}>
                      {farm.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Subproduto
                <select
                  value={selectedAnalysisSubproduct ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedAnalysisSubproduct(value || null);
                    setSelectedDriverKey(null);
                    setSelectedParcel(null);
                  }}
                >
                  <option value="">Todos</option>
                  {subproductOptions.map((subproduct) => (
                    <option key={subproduct} value={subproduct}>
                      {subproduct}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Motorista
                <select
                  value={selectedDriverData ? selectedDriverKey ?? "" : ""}
                  onChange={(event) => {
                    setSelectedDriverKey(event.target.value || null);
                    setSelectedParcel(null);
                  }}
                >
                  <option value="">Todos</option>
                  {driverControlData.map((driver) => (
                    <option key={driver.key} value={driver.key}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                De
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => updateFilter("dateFrom", event.target.value)}
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => updateFilter("dateTo", event.target.value)}
                />
              </label>
              <label>
                Origem
                <select value={filters.loadingOrigin} onChange={(event) => updateFilter("loadingOrigin", event.target.value)}>
                  <option value="">Todas</option>
                  {originOptions.map((origin) => (
                    <option key={origin} value={origin}>
                      {origin}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ticket
                <select
                  value={filters.ticketStatus}
                  onChange={(event) => updateFilter("ticketStatus", event.target.value as TicketStatusFilter)}
                >
                  <option value="all">Todos</option>
                  <option value="matched">Conciliado</option>
                  <option value="pending">Pendente</option>
                </select>
              </label>
            </div>
          </article>

          <div className="analysis-stat-strip" aria-label="Estatísticas principais da análise">
            <article className="analysis-stat-card">
              <span>
                <Scale aria-hidden="true" />
                Total aplicado
              </span>
              <strong>{formatCompactTonnes(analysisSummary.totalTonnes)}</strong>
              <em>{analysisSummary.deposits} viagens</em>
            </article>
            <article className="analysis-stat-card">
              <span>
                <Layers3 aria-hidden="true" />
                Vila Nova
              </span>
              <strong>{formatCompactTonnes(vilaNovaAnalysisTotal?.toneladas ?? 0)}</strong>
              <em>{vilaNovaAnalysisTotal?.viagens ?? 0} viagens</em>
            </article>
            <article className="analysis-stat-card">
              <span>
                <Layers3 aria-hidden="true" />
                Fé em Deus
              </span>
              <strong>{formatCompactTonnes(feEmDeusAnalysisTotal?.toneladas ?? 0)}</strong>
              <em>{feEmDeusAnalysisTotal?.viagens ?? 0} viagens</em>
            </article>
            <article className="analysis-stat-card">
              <span>
                <Truck aria-hidden="true" />
                Viagens no período
              </span>
              <strong>{analysisSummary.deposits}</strong>
            </article>
          </div>

          <article className="chart-panel analysis-map-card">
            <header>
              <div>
                <h2>Mapa CQO dos descarregos</h2>
                <span className="chart-note">
                  Shapes no mesmo mapa · {activeMapScopeLabel} · {activeMapParcels} parcelas e {activeMapMarkers} pontos GPS
                </span>
              </div>
              <MapPinned aria-hidden="true" />
            </header>
            <div className="map-farm-switcher map-farm-switcher-row" aria-label="Filtrar fazenda dentro do mapa">
              <button
                type="button"
                className={selectedFarmId === "all" ? "selected" : ""}
                onClick={() => toggleFarmForAnalysis("all")}
              >
                <span>Todos</span>
              </button>
              {farmMapData.map((farmMap) => (
                <button
                  type="button"
                  className={selectedFarmId === farmMap.farm.id ? "selected" : ""}
                  key={farmMap.farm.id}
                  onClick={() => toggleFarmForAnalysis(farmMap.farm.id)}
                >
                  <span>{farmMap.farm.label}</span>
                </button>
              ))}
            </div>
            <div className="geo-map-layout">
              <div className={`farm-map-panel farm-map-panel-combined ${activeMapMarkers === 0 ? "farm-map-panel-empty" : ""}`}>
                <div className="farm-map-head">
                  <div className="farm-map-title-static">
                    <strong>Vila Nova + Fé em Deus</strong>
                    <span>{totalMapParcels} parcelas reais · foco {activeMapScopeLabel}</span>
                  </div>
                  <div className="farm-map-actions">
                    <em>{activeMapMarkers ? `${activeMapMarkers} GPS` : "Sem GPS no filtro"}</em>
                    <div className="farm-map-tools" aria-label={`Ferramentas do mapa ${activeMapScopeLabel}`}>
                      <button
                        type="button"
                        aria-label={`Aproximar mapa ${activeMapScopeLabel}`}
                        title="Aproximar"
                        onClick={() => zoomFarmMap(activeFarmMapId, 1.18)}
                      >
                        <ZoomIn aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Afastar mapa ${activeMapScopeLabel}`}
                        title="Afastar"
                        onClick={() => zoomFarmMap(activeFarmMapId, 0.86)}
                      >
                        <ZoomOut aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Resetar mapa ${activeMapScopeLabel}`}
                        title="Resetar visão"
                        onClick={() => resetFarmMap(activeFarmMapId)}
                      >
                        <RotateCcw aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
                <div
                  className={`geo-map-canvas ${isDraggingCombinedMap ? "is-dragging" : ""}`}
                  aria-label="Mapa real das fazendas Vila Nova e Fé em Deus"
                >
                  <svg
                    viewBox={`0 0 ${farmMapWidth} ${farmMapHeight}`}
                    role="img"
                    aria-label="Shapes reais de Vila Nova e Fé em Deus no mesmo mapa"
                    onWheel={(event) => handleMapWheel(activeFarmMapId, event)}
                    onPointerDown={(event) => handleMapPointerDown(activeFarmMapId, combinedMapView, event)}
                    onPointerMove={handleMapPointerMove}
                    onPointerUp={stopMapDrag}
                    onPointerCancel={stopMapDrag}
                  >
                    <defs>
                      <pattern id="geo-grid-combined" width="22" height="22" patternUnits="userSpaceOnUse">
                        <path d="M 22 0 L 0 0 0 22" fill="none" stroke="#dbe5da" strokeWidth="1" />
                      </pattern>
                      <filter id="marker-shadow-combined" x="-40%" y="-40%" width="180%" height="180%">
                        <feDropShadow dx="0" dy="2" stdDeviation="1.8" floodColor="#0a2c1f" floodOpacity="0.18" />
                      </filter>
                    </defs>
                    <rect className="geo-map-bg" width={farmMapWidth} height={farmMapHeight} rx="10" />
                    <rect width={farmMapWidth} height={farmMapHeight} fill="url(#geo-grid-combined)" opacity="0.58" />
                    <g transform={`translate(${combinedMapView.x} ${combinedMapView.y}) scale(${combinedMapView.scale})`}>
                      {farmMapData.map((farmMap) => {
                        const farmIsMuted = selectedFarmId !== "all" && selectedFarmId !== farmMap.farm.id;
                        const farmLabelX = farmMap.parcels.length
                          ? farmMap.parcels.reduce((sum, parcel) => sum + parcel.labelX, 0) / farmMap.parcels.length
                          : 0;
                        const farmLabelY = farmMap.parcels.length
                          ? Math.min(...farmMap.parcels.map((parcel) => parcel.labelY))
                          : 0;

                        return (
                          <g
                            className={`farm-map-layer ${farmIsMuted ? "farm-map-layer-muted" : ""}`}
                            data-farm-id={farmMap.farm.id}
                            key={farmMap.farm.id}
                          >
                            {farmMap.parcels.length ? (
                              <text
                                className={`farm-map-zone-label farm-map-zone-label-${farmMap.farm.id}`}
                                x={farmLabelX}
                                y={Math.max(12 / combinedMapView.scale, farmLabelY - 10 / combinedMapView.scale)}
                                fontSize={9 / combinedMapView.scale}
                                textAnchor="middle"
                              >
                                {farmMap.farm.label}
                              </text>
                            ) : null}
                            {farmMap.parcels.map((parcel) => {
                              const isSelectedParcel =
                                selectedParcel?.farmId === farmMap.farm.id && selectedParcel.parcelId === parcel.id;
                              const labelWidth = Math.max(18, parcel.label.length * 5.3 + 8) / combinedMapView.scale;
                              const labelHeight = 13 / combinedMapView.scale;
                              const labelFontSize = 7.1 / combinedMapView.scale;

                              return (
                                <g data-farm-id={farmMap.farm.id} key={parcel.id}>
                                  <title>
                                    {`${farmMap.farm.label} · Parcela ${parcel.label} · ${parcel.hectares.toLocaleString("pt-BR", {
                                      maximumFractionDigits: 1,
                                    })} ha · ${parcel.depositCount} viagens`}
                                  </title>
                                  {parcel.paths.map((path, index) => (
                                    <polygon
                                      aria-label={`Parcela ${parcel.label} da fazenda ${farmMap.farm.label}`}
                                      className={`geo-parcel-real geo-parcel-farm-${farmMap.farm.id} ${
                                        parcel.highlighted ? "geo-parcel-highlighted" : ""
                                      } ${isSelectedParcel ? "geo-parcel-selected" : ""}`}
                                      data-farm-id={farmMap.farm.id}
                                      data-parcel-id={parcel.id}
                                      key={`${parcel.id}-${index}`}
                                      points={path}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        selectParcelForAnalysis(farmMap.farm, parcel);
                                      }}
                                    />
                                  ))}
                                  {parcel.label ? (
                                    <g
                                      aria-hidden="true"
                                      className={`geo-parcel-label-chip ${
                                        parcel.depositCount ? "" : "geo-parcel-label-chip-muted"
                                      } ${isSelectedParcel ? "geo-parcel-label-chip-selected" : ""}`}
                                      data-farm-id={farmMap.farm.id}
                                      data-parcel-id={parcel.id}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        selectParcelForAnalysis(farmMap.farm, parcel);
                                      }}
                                      transform={`translate(${parcel.labelX} ${parcel.labelY})`}
                                    >
                                      <rect
                                        x={-labelWidth / 2}
                                        y={-labelHeight / 2}
                                        width={labelWidth}
                                        height={labelHeight}
                                        rx={labelHeight / 2}
                                      />
                                      <text
                                        className="geo-parcel-label"
                                        dominantBaseline="middle"
                                        fontSize={labelFontSize}
                                        textAnchor="middle"
                                        y={0.45 / combinedMapView.scale}
                                      >
                                        {parcel.label}
                                      </text>
                                    </g>
                                  ) : null}
                                </g>
                              );
                            })}
                            {farmMap.markers.map((marker) => (
                              <g
                                key={marker.id}
                                className={`geo-marker ${
                                  marker.deposit.placementMode === "between_plots"
                                    ? "geo-marker-between"
                                    : "geo-marker-single"
                                } ${selectedDepositId === marker.id ? "geo-marker-selected" : ""}`}
                                data-farm-id={farmMap.farm.id}
                                data-marker-id={marker.id}
                                style={{ filter: "url(#marker-shadow-combined)" }}
                                transform={`translate(${marker.x} ${marker.y})`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedDepositId(marker.id);
                                  setSelectedDriverKey(getDriverKey(marker.deposit));
                                  setSelectedFarmId(farmMap.farm.id);
                                  setSelectedParcel(null);
                                }}
                              >
                                <title>
                                  {`${marker.deposit.farm} · ${marker.plotLabel} · ${marker.deposit.subproduct} · ${marker.modeLabel}`}
                                </title>
                                {marker.deposit.placementMode === "between_plots" ? (
                                  <>
                                    <circle r="3.8" fill="#ffffff" stroke={marker.color} strokeWidth="1.7" />
                                    <path d="M-2.7 -0.8 L2.7 -0.8 M-2.7 1.2 L2.7 1.2" stroke={marker.color} strokeWidth="1.1" />
                                  </>
                                ) : (
                                  <rect
                                    x="-3.6"
                                    y="-3.6"
                                    width="7.2"
                                    height="7.2"
                                    rx="1.5"
                                    fill="#ffffff"
                                    stroke={marker.color}
                                    strokeWidth="1.7"
                                    transform="rotate(45)"
                                  />
                                )}
                                <circle r="1.2" fill={marker.color} />
                              </g>
                            ))}
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                </div>
                <div className="farm-map-foot">
                  <span>{activeMapHectares.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ha no foco</span>
                  <span>{activeMapBetweenPlots} entre parcelas</span>
                </div>
              </div>
            </div>
          </article>

          <article className="chart-panel analysis-driver-card">
            <header>
              <div>
                <h2>Controle dos motoristas</h2>
                <span className="chart-note">
                  {analysisSummary.deposits} viagens · {formatCompactTonnes(analysisSummary.totalTonnes)}
                </span>
              </div>
              <Truck aria-hidden="true" />
            </header>
            <div className="driver-control-summary">
              <div>
                <span>Viagens</span>
                <strong>{analysisSummary.deposits}</strong>
              </div>
              <div>
                <span>Peso</span>
                <strong>{formatCompactTonnes(analysisSummary.totalTonnes)}</strong>
              </div>
              <div>
                <span>Entre parcelas</span>
                <strong>{analysisSummary.betweenPlots}</strong>
              </div>
            </div>
            <div className="driver-control-list">
              {visibleDriverControlData.length > 0 ? (
                visibleDriverControlData.map((driver) => {
                  const subproductMix = formatDriverSubproductMix(driver.subproducts);

                  return (
                    <button
                      type="button"
                      className={`driver-vertical-card ${selectedDriverData?.key === driver.key ? "selected" : ""}`}
                      key={driver.key}
                      onClick={() => {
                        setSelectedDriverKey((current) => (current === driver.key ? null : driver.key));
                        setSelectedParcel(null);
                      }}
                      title={`${driver.name} · ${formatDriverSubproductDetail(driver.subproducts)}`}
                    >
                      <strong>{formatCompactTonnes(driver.tonnes)}</strong>
                      <span className="simple-vertical-track" aria-hidden="true">
                        <span
                          style={{
                            height: `${Math.max(10, (driver.tonnes / maxDriverTonnes) * 100)}%`,
                          }}
                        />
                      </span>
                      <span>{driver.name}</span>
                      <em>{driver.trips} viagens</em>
                      <small>{subproductMix}</small>
                    </button>
                  );
                })
              ) : (
                <div className="empty-inline">Nenhum motorista no filtro atual.</div>
              )}
            </div>
            {selectedDriverData ? (
              <div className="driver-detail-card">
                <div>
                  <span>Matrícula</span>
                  <strong>{selectedDriverData.registration}</strong>
                  <em>{selectedDriverData.name}</em>
                </div>
                <div>
                  <span>Subprodutos</span>
                  <strong>
                    {selectedDriverData.subproducts.length > 1
                      ? `${selectedDriverData.subproducts.length} tipos`
                      : selectedDriverData.topSubproduct}
                  </strong>
                  <em>{formatDriverSubproductDetail(selectedDriverData.subproducts)}</em>
                </div>
                <div>
                  <span>Último destino</span>
                  <strong>{selectedDriverData.lastDeposit.farm}</strong>
                  <em>{formatPlot(selectedDriverData.lastDeposit)}</em>
                </div>
                <div>
                  <span>Ciclo médio</span>
                  <strong>{formatMinutes(selectedDriverData.cycleAverage)}</strong>
                  <em>somente viagens</em>
                </div>
              </div>
            ) : null}
          </article>

          <article className="chart-panel analysis-volume-card">
            <header>
              <div>
                <h2>Volume por subproduto</h2>
                <span className="chart-note">
                  {analysisScopeLabel} · total {formatCompactTonnes(analysisSummary.totalTonnes)}
                </span>
              </div>
              <div className="chart-header-actions">
                {selectedAnalysisSubproduct ? (
                  <button
                    type="button"
                    className="analysis-filter-chip"
                    onClick={() => toggleSubproductForAnalysis(selectedAnalysisSubproduct)}
                  >
                    <span>{selectedAnalysisSubproduct}</span>
                    <X aria-hidden="true" />
                  </button>
                ) : null}
                <Scale aria-hidden="true" />
              </div>
            </header>
            {analysisSubproductData.length > 0 ? (
              <ResponsiveContainer width="100%" height={presentationMode ? "100%" : 430}>
                <BarChart
                  data={analysisSubproductData}
                  layout="vertical"
                  margin={{ top: 10, right: 78, bottom: 10, left: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={146}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#53665a", fontSize: 12, fontWeight: 850 }}
                  />
                  <Tooltip cursor={false} formatter={(value) => [`${value} t`, "Peso balanca"]} />
                  <Bar
                    className="volume-filter-bar"
                    dataKey="toneladas"
                    barSize={presentationMode ? 38 : 42}
                    isAnimationActive={false}
                    onClick={handleSubproductBarClick}
                    radius={[0, 6, 6, 0]}
                  >
                    {analysisSubproductData.map((entry) => (
                      <Cell
                        cursor="pointer"
                        fill={getSubproductMapColor(entry.name)}
                        key={entry.name}
                        opacity={selectedAnalysisSubproduct && selectedAnalysisSubproduct !== entry.name ? 0.35 : 1}
                      />
                    ))}
                    <LabelList
                      dataKey="toneladas"
                      fill="#0a2c1f"
                      fontSize={13}
                      fontWeight={900}
                      formatter={(value) => formatCompactTonnes(Number(value ?? 0))}
                      position="right"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-chart-state">
                <strong>Sem volume no recorte</strong>
                <span>Selecione outra parcela, motorista ou periodo para comparar viagens.</span>
              </div>
            )}
          </article>

          <article className="chart-panel analysis-farm-control-card analysis-parcel-card">
            <header>
              <div>
                <h2>Parcelas mais utilizadas</h2>
                <span className="chart-note">{analysisScopeLabel} · aplicações e toneladas por parcela</span>
              </div>
              <Layers3 aria-hidden="true" />
            </header>
            {parcelRankData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={presentationMode ? "100%" : 248}>
                  <BarChart data={visibleParcelRankData} layout="vertical" margin={{ top: 4, right: 98, bottom: 2, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      width={112}
                      tick={{ fontSize: 11, fontWeight: 850 }}
                    />
                    <Tooltip
                      cursor={false}
                      formatter={(value, _name, item) => {
                        const payload = item.payload as ParcelRankItem | undefined;
                        return [
                          payload
                            ? `${payload.trips} aplicações · ${formatCompactTonnes(payload.tonnes)}`
                            : `${Number(value)} aplicações`,
                          "Parcela",
                        ];
                      }}
                    />
                    <Bar
                      dataKey="trips"
                      name="Aplicações"
                      radius={[0, 6, 6, 0]}
                      isAnimationActive={false}
                      onClick={handleParcelRankBarClick}
                    >
                      {visibleParcelRankData.map((entry) => {
                        const selected = selectedParcel?.farmId === entry.farmId
                          && normalizeParcelCode(selectedParcel.label) === normalizeParcelCode(entry.parcel);
                        return (
                          <Cell
                            fill={selected ? "#e8551f" : entry.farmId === "vila-nova" ? "#1e5c3a" : "#e2a02c"}
                            key={entry.key}
                          />
                        );
                      })}
                      <LabelList dataKey="metricLabel" fill="#0a2c1f" fontSize={10} fontWeight={900} position="right" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="farm-control-total">
                  <span>{visibleParcelRankData.length} parcelas · {visibleParcelRankTotals.trips} aplicações</span>
                  <strong>{formatCompactTonnes(visibleParcelRankTotals.tonnes)} no ranking</strong>
                </div>
              </>
            ) : (
              <div className="empty-chart-state">
                <strong>Sem parcelas no recorte</strong>
                <span>Ajuste os filtros para visualizar as parcelas mais usadas.</span>
              </div>
            )}
          </article>

          <article className="chart-panel analysis-ranking-card">
            <header>
              <div>
                <h2>Viagens diárias</h2>
                <span className="chart-note">{analysisScopeLabel} · viagens e toneladas</span>
              </div>
              <Clock3 aria-hidden="true" />
            </header>
            {analysisDailyData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={presentationMode ? "100%" : 176} className="analysis-daily-chart">
                  <ComposedChart data={analysisDailyData} margin={{ top: 28, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="dia"
                      tickLine={false}
                      axisLine={false}
                      height={34}
                      interval={0}
                      minTickGap={8}
                      tick={<DailyAxisTick />}
                      tickMargin={6}
                    />
                    <YAxis yAxisId="left" allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                    <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={42} />
                    <Tooltip
                      cursor={false}
                      formatter={(value, name) => [
                        name === "Toneladas" ? formatCompactTonnes(Number(value)) : `${Number(value)} viagens`,
                        name,
                      ]}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="coletas"
                      name="Viagens"
                      fill="#1e5c3a"
                      barSize={42}
                      radius={[6, 6, 0, 0]}
                      isAnimationActive={false}
                    >
                      <LabelList dataKey="coletas" content={<DailyBarCountLabel />} />
                    </Bar>
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="toneladas"
                      name="Toneladas"
                      stroke="#2f6f9f"
                      strokeWidth={2.6}
                      dot={{ r: 3.5, fill: "#ffffff", stroke: "#2f6f9f", strokeWidth: 2.4 }}
                      isAnimationActive={false}
                    >
                      <LabelList dataKey="toneladas" content={<DailyTonnesLabel />} />
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="analysis-daily-summary">
                  <span>{analysisSummary.deposits} viagens</span>
                  <strong>{formatCompactTonnes(analysisSummary.totalTonnes)}</strong>
                  <em>base de viagens</em>
                </div>
                <div className="daily-vehicle-table">
                  <div className="daily-vehicle-table-head">
                    <strong>Caminhões</strong>
                    <span>{vehicleControlData.length} no recorte</span>
                  </div>
                  {visibleDailyVehicleData.length > 0 ? (
                    <div className="daily-vehicle-vertical-list">
                      {visibleDailyVehicleData.map((vehicle) => (
                        <button
                          type="button"
                          className="daily-vehicle-vertical-card"
                          key={vehicle.plate}
                          onClick={() => updateFilter("search", vehicle.plate)}
                          title={`Filtrar ${vehicle.fleetNumber} - ${vehicle.displayPlate}`}
                        >
                          <strong>{formatCompactTonnes(vehicle.tonnes)}</strong>
                          <span className="simple-vertical-track" aria-hidden="true">
                            <span
                              style={{
                                height: `${Math.max(10, (vehicle.tonnes / maxDailyVehicleTonnes) * 100)}%`,
                              }}
                            />
                          </span>
                          <span>{vehicle.fleetNumber}</span>
                          <em>{vehicle.displayPlate}</em>
                          <small>{vehicle.trips} viagens</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-inline">Nenhum caminhão no filtro atual.</div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-chart-state">
                <strong>Sem viagens no recorte</strong>
                <span>Ajuste os filtros para visualizar a evolução diária.</span>
              </div>
            )}
          </article>

          <article className="chart-panel analysis-vehicle-card">
            <header>
              <div>
                <h2>Caminhões</h2>
                <span className="chart-note">{analysisScopeLabel} · placas, viagens e motoristas</span>
              </div>
              <Truck aria-hidden="true" />
            </header>
            <div className="vehicle-control-list">
              {vehicleControlData.length > 0 ? (
                visibleVehicleControlData.map((vehicle) => (
                  <button
                    type="button"
                    className="vehicle-control-row"
                    key={vehicle.plate}
                    onClick={() => updateFilter("search", vehicle.plate)}
                    title={`Filtrar ${vehicle.fleetNumber} - ${vehicle.displayPlate}`}
                  >
                    <div className="vehicle-control-body">
                      <div className="vehicle-control-topline">
                        <strong>{vehicle.fleetNumber}</strong>
                        <span>{vehicle.displayPlate}</span>
                      </div>
                      <span className="vehicle-control-model">{vehicle.vehicleDescription}</span>
                      <div className="vehicle-control-metrics">
                        <span>{vehicle.trips} viagens</span>
                        <strong>{formatCompactTonnes(vehicle.tonnes)}</strong>
                      </div>
                    </div>
                    <em>{vehicle.operationalClass}</em>
                    <i style={{ width: `${Math.max(8, (vehicle.trips / maxVehicleTrips) * 100)}%` }} />
                  </button>
                ))
              ) : (
                <div className="empty-inline">Nenhum caminhão no filtro atual.</div>
              )}
            </div>
            <div className="vehicle-control-total">
              <span>{vehicleControlData.length} caminhões no recorte</span>
              <strong>{vehicleControlData[0] ? `${vehicleControlData[0].fleetNumber} · ${vehicleControlData[0].displayPlate}` : "-"}</strong>
            </div>
          </article>
        </section>
      ) : null}
    </section>
  );
}

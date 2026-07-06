import farmParcelsGeoJson from "../data/farm-parcels.json";

export type FieldFarmId = "vila-nova" | "fe-em-deus";

export interface FieldFarmOption {
  id: FieldFarmId;
  label: string;
  value: string;
}

export interface FieldParcelOption {
  farmId: FieldFarmId;
  label: string;
  value: string;
  hectares: number;
}

interface GeoJsonFeature {
  properties: {
    farmId: string;
    parcelId: string;
    ID_PARCELA: string;
    HECTARE_PA?: number;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}

interface Point {
  x: number;
  y: number;
}

interface ParcelShape extends FieldParcelOption {
  normalized: string;
  points: Point[];
  segments: Array<[Point, Point]>;
  bbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

const ROAD_GAP_METERS = 35;
const FALLBACK_NEIGHBOR_LIMIT = 4;
const FALLBACK_MAX_DISTANCE_METERS = 120;

const collator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export const fieldFarmOptions: FieldFarmOption[] = [
  { id: "vila-nova", label: "Vila Nova", value: "VILA NOVA" },
  { id: "fe-em-deus", label: "Fé em Deus", value: "FE EM DEUS" },
];

const fieldFarmIds = new Set<FieldFarmId>(fieldFarmOptions.map((farm) => farm.id));

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeParcel(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

export function getFieldFarmByValue(value: string) {
  const normalized = normalizeText(value);
  return fieldFarmOptions.find((farm) => normalizeText(farm.value) === normalized) ?? null;
}

function getRings(geometry: GeoJsonFeature["geometry"]) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates as number[][][];
  }

  return (geometry.coordinates as number[][][][]).flat();
}

function toMetricPoint([longitude, latitude]: number[]) {
  const latitudeReference = -2.86 * Math.PI / 180;

  return {
    x: longitude * 111_320 * Math.cos(latitudeReference),
    y: latitude * 110_540,
  };
}

function distancePointToSegment(point: Point, start: Point, end: Point) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const projection = lengthSquared
    ? ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared
    : 0;
  const t = Math.max(0, Math.min(1, projection));
  const closestX = start.x + t * segmentX;
  const closestY = start.y + t * segmentY;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

function bboxGap(first: ParcelShape["bbox"], second: ParcelShape["bbox"]) {
  const gapX = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const gapY = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);

  return Math.hypot(gapX, gapY);
}

function distanceBetweenParcels(first: ParcelShape, second: ParcelShape) {
  let distance = Infinity;

  first.points.forEach((point) => {
    second.segments.forEach(([start, end]) => {
      distance = Math.min(distance, distancePointToSegment(point, start, end));
    });
  });

  second.points.forEach((point) => {
    first.segments.forEach(([start, end]) => {
      distance = Math.min(distance, distancePointToSegment(point, start, end));
    });
  });

  return distance;
}

function toParcelShape(feature: GeoJsonFeature): ParcelShape | null {
  const farmId = feature.properties.farmId as FieldFarmId;

  if (!fieldFarmIds.has(farmId)) {
    return null;
  }

  const rings = getRings(feature.geometry);
  const points = rings.flatMap((ring) => ring.map(toMetricPoint));
  const segments: Array<[Point, Point]> = [];

  rings.forEach((ring) => {
    const metricRing = ring.map(toMetricPoint);
    for (let index = 0; index < metricRing.length - 1; index += 1) {
      segments.push([metricRing[index], metricRing[index + 1]]);
    }
  });

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const label = feature.properties.ID_PARCELA;

  return {
    farmId,
    label,
    value: label,
    normalized: normalizeParcel(label),
    hectares: Number(feature.properties.HECTARE_PA ?? 0),
    points,
    segments,
    bbox: {
      minX: Math.min(...xValues),
      minY: Math.min(...yValues),
      maxX: Math.max(...xValues),
      maxY: Math.max(...yValues),
    },
  };
}

const parcelShapes = (farmParcelsGeoJson.features as GeoJsonFeature[])
  .map(toParcelShape)
  .filter((parcel): parcel is ParcelShape => Boolean(parcel));

const parcelsByFarm = fieldFarmOptions.reduce<Record<FieldFarmId, ParcelShape[]>>((grouped, farm) => {
  grouped[farm.id] = parcelShapes
    .filter((parcel) => parcel.farmId === farm.id)
    .sort((left, right) => collator.compare(left.label, right.label));

  return grouped;
}, {
  "vila-nova": [],
  "fe-em-deus": [],
});

const adjacencyByFarm = fieldFarmOptions.reduce<Record<FieldFarmId, Record<string, string[]>>>((grouped, farm) => {
  const farmParcels = parcelsByFarm[farm.id];
  const distances = new Map<string, Array<{ parcel: string; distance: number }>>();

  farmParcels.forEach((parcel) => {
    distances.set(parcel.normalized, []);
    grouped[farm.id][parcel.normalized] = [];
  });

  for (let firstIndex = 0; firstIndex < farmParcels.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < farmParcels.length; secondIndex += 1) {
      const first = farmParcels[firstIndex];
      const second = farmParcels[secondIndex];

      if (bboxGap(first.bbox, second.bbox) > FALLBACK_MAX_DISTANCE_METERS) {
        continue;
      }

      const distance = distanceBetweenParcels(first, second);
      distances.get(first.normalized)?.push({ parcel: second.normalized, distance });
      distances.get(second.normalized)?.push({ parcel: first.normalized, distance });

      if (distance <= ROAD_GAP_METERS) {
        grouped[farm.id][first.normalized].push(second.normalized);
        grouped[farm.id][second.normalized].push(first.normalized);
      }
    }
  }

  Object.entries(grouped[farm.id]).forEach(([parcel, neighbors]) => {
    if (neighbors.length > 0) {
      return;
    }

    grouped[farm.id][parcel] = (distances.get(parcel) ?? [])
      .filter((item) => item.distance <= FALLBACK_MAX_DISTANCE_METERS)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, FALLBACK_NEIGHBOR_LIMIT)
      .map((item) => item.parcel);
  });

  Object.keys(grouped[farm.id]).forEach((parcel) => {
    const order = new Map(parcelsByFarm[farm.id].map((item, index) => [item.normalized, index]));
    grouped[farm.id][parcel] = Array.from(new Set(grouped[farm.id][parcel]))
      .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  });

  return grouped;
}, {
  "vila-nova": {},
  "fe-em-deus": {},
});

export function getParcelOptionsForFarm(farmId: FieldFarmId): FieldParcelOption[] {
  return parcelsByFarm[farmId].map(({ farmId: parcelFarmId, label, value, hectares }) => ({
    farmId: parcelFarmId,
    label,
    value,
    hectares,
  }));
}

export function getBetweenParcelOptions(farmId: FieldFarmId, primaryParcel: string): FieldParcelOption[] {
  const normalizedPrimary = normalizeParcel(primaryParcel);
  const neighborSet = new Set(adjacencyByFarm[farmId][normalizedPrimary] ?? []);

  return parcelsByFarm[farmId]
    .filter((parcel) => neighborSet.has(parcel.normalized))
    .map(({ farmId: parcelFarmId, label, value, hectares }) => ({
      farmId: parcelFarmId,
      label,
      value,
      hectares,
    }));
}

export function isValidFarmParcel(farmId: FieldFarmId, parcel: string) {
  const normalized = normalizeParcel(parcel);
  return parcelsByFarm[farmId].some((item) => item.normalized === normalized);
}

export function isValidBetweenParcelPair(farmId: FieldFarmId, primaryParcel: string, secondaryParcel: string) {
  const normalizedPrimary = normalizeParcel(primaryParcel);
  const normalizedSecondary = normalizeParcel(secondaryParcel);

  return Boolean(adjacencyByFarm[farmId][normalizedPrimary]?.includes(normalizedSecondary));
}

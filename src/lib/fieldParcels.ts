import farmParcelsGeoJson from "../data/farm-parcels.json";
import interparcelStreetsGeoJson from "../data/interparcel-streets.json";

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
}

interface ParcelShape extends FieldParcelOption {
  normalized: string;
}

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

function toParcelShape(feature: GeoJsonFeature): ParcelShape | null {
  const farmId = feature.properties.farmId as FieldFarmId;

  if (!fieldFarmIds.has(farmId)) {
    return null;
  }

  const label = feature.properties.ID_PARCELA;

  return {
    farmId,
    label,
    value: label,
    normalized: normalizeParcel(label),
    hectares: Number(feature.properties.HECTARE_PA ?? 0),
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
  farmParcels.forEach((parcel) => {
    grouped[farm.id][parcel.normalized] = [];
  });

  const streets = interparcelStreetsGeoJson.features as Array<{
    properties: {
      farmId: string;
      parcelA: string;
      parcelB: string;
    };
  }>;

  streets
    .filter((street) => street.properties.farmId === farm.id)
    .forEach((street) => {
      const first = normalizeParcel(street.properties.parcelA);
      const second = normalizeParcel(street.properties.parcelB);
      if (!grouped[farm.id][first] || !grouped[farm.id][second]) return;
      grouped[farm.id][first].push(second);
      grouped[farm.id][second].push(first);
    });

  const order = new Map(farmParcels.map((item, index) => [item.normalized, index]));
  Object.keys(grouped[farm.id]).forEach((parcel) => {
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

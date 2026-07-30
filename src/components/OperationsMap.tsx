import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Layers3, MapPinned, Satellite, WifiOff } from "lucide-react";
import farmParcelsGeoJson from "../data/farm-parcels.json";
import type { FieldDeposit } from "../types";

type FarmScope = "all" | "vila-nova" | "fe-em-deus";
type Coordinate = [number, number];

interface MapFeature {
  type: "Feature";
  id?: string;
  properties: Record<string, unknown>;
  geometry: {
    type: "Point" | "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
}

interface MapFeatureCollection {
  type: "FeatureCollection";
  features: MapFeature[];
}

interface OperationsMapProps {
  deposits: FieldDeposit[];
  farmScope: FarmScope;
  selectedDepositId: string | null;
  selectedParcelId?: string | null;
  onSelectDeposit: (depositId: string) => void;
  onSelectParcel: (farmId: Exclude<FarmScope, "all">, parcelId: string) => void;
}

const mapStyleUrl = "https://tiles.openfreemap.org/styles/liberty";
const mapCenter: Coordinate = [-48.22, -2.86];

const subproductColors: Record<string, string> = {
  Borra: "#1f6a44",
  "Cacho Vazio (Bucha)": "#2f6f9f",
  "Cacho Triturado": "#78a83e",
  Cinza: "#737d78",
  Torta: "#d99721",
  Outros: "#d86635",
};

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function farmIdFromName(value: string): Exclude<FarmScope, "all"> | null {
  const normalized = normalizeText(value);
  if (normalized.includes("VILA NOVA")) return "vila-nova";
  if (normalized.includes("FE EM DEUS")) return "fe-em-deus";
  return null;
}

function normalizeParcel(value: unknown) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, "");
}

function hasGps(deposit: FieldDeposit) {
  return typeof deposit.latitude === "number" && typeof deposit.longitude === "number";
}

function flattenCoordinates(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return [];
  if (
    value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
  ) {
    return [[value[0], value[1]]];
  }
  return value.flatMap(flattenCoordinates);
}

function fitMapToData(map: MapLibreMap, collections: MapFeatureCollection[]) {
  const coordinates = collections.flatMap((collection) => (
    collection.features.flatMap((feature) => flattenCoordinates(feature.geometry.coordinates))
  ));
  if (!coordinates.length) return;

  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );

  map.fitBounds(bounds, {
    padding: { top: 56, right: 42, bottom: 48, left: 42 },
    maxZoom: 15.4,
    duration: 650,
  });
}

function addOperationalLayers(
  map: MapLibreMap,
  parcels: MapFeatureCollection,
  markers: MapFeatureCollection,
) {
  map.addSource("vna-parcels", {
    type: "geojson",
    data: parcels as never,
  });
  map.addLayer({
    id: "vna-parcels-fill",
    type: "fill",
    source: "vna-parcels",
    paint: {
      "fill-color": [
        "case",
        ["==", ["get", "farmId"], "vila-nova"],
        "#27704a",
        "#2e6f94",
      ],
      "fill-opacity": [
        "case",
        ["boolean", ["get", "selected"], false],
        0.62,
        [">", ["number", ["get", "depositCount"], 0], 0],
        0.42,
        0.18,
      ],
    },
  });
  map.addLayer({
    id: "vna-parcels-outline",
    type: "line",
    source: "vna-parcels",
    paint: {
      "line-color": [
        "case",
        ["boolean", ["get", "selected"], false],
        "#f2b134",
        "#174a35",
      ],
      "line-width": [
        "case",
        ["boolean", ["get", "selected"], false],
        3,
        1.25,
      ],
      "line-opacity": 0.9,
    },
  });
  map.addLayer({
    id: "vna-parcels-label",
    type: "symbol",
    source: "vna-parcels",
    minzoom: 12.4,
    layout: {
      "text-field": ["get", "parcelLabel"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 13],
      "text-font": ["Noto Sans Bold"],
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#123d2b",
      "text-halo-color": "rgba(255,255,255,0.94)",
      "text-halo-width": 1.6,
    },
  });

  map.addSource("vna-discharges", {
    type: "geojson",
    data: markers as never,
    cluster: true,
    clusterRadius: 44,
    clusterMaxZoom: 14,
  });
  map.addLayer({
    id: "vna-discharge-clusters",
    type: "circle",
    source: "vna-discharges",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#34785a",
        10,
        "#d99721",
        25,
        "#d86635",
      ],
      "circle-radius": ["step", ["get", "point_count"], 18, 10, 23, 25, 29],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
      "circle-opacity": 0.94,
    },
  });
  map.addLayer({
    id: "vna-discharge-cluster-count",
    type: "symbol",
    source: "vna-discharges",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });
  map.addLayer({
    id: "vna-discharges-points",
    type: "circle",
    source: "vna-discharges",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": [
        "case",
        ["boolean", ["get", "selected"], false],
        10,
        7,
      ],
      "circle-stroke-color": [
        "case",
        ["boolean", ["get", "selected"], false],
        "#f2b134",
        "#ffffff",
      ],
      "circle-stroke-width": [
        "case",
        ["boolean", ["get", "selected"], false],
        4,
        2.5,
      ],
    },
  });
  map.addLayer({
    id: "vna-discharges-labels",
    type: "symbol",
    source: "vna-discharges",
    minzoom: 14.2,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": ["get", "ticket"],
      "text-size": 10,
      "text-offset": [0, 1.55],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#123d2b",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });
}

export function OperationsMap({
  deposits,
  farmScope,
  selectedDepositId,
  selectedParcelId,
  onSelectDeposit,
  onSelectParcel,
}: OperationsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbackRef = useRef({ onSelectDeposit, onSelectParcel });
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");

  callbackRef.current = { onSelectDeposit, onSelectParcel };

  const parcelData = useMemo<MapFeatureCollection>(() => {
    const depositCountByParcel = new Map<string, number>();
    deposits.forEach((deposit) => {
      const farmId = farmIdFromName(deposit.farm);
      if (!farmId) return;
      [deposit.plotPrimary, deposit.plotSecondary].filter(Boolean).forEach((parcel) => {
        const key = `${farmId}:${normalizeParcel(parcel)}`;
        depositCountByParcel.set(key, (depositCountByParcel.get(key) || 0) + 1);
      });
    });

    const source = farmParcelsGeoJson as unknown as MapFeatureCollection;
    return {
      type: "FeatureCollection",
      features: source.features
        .filter((feature) => farmScope === "all" || feature.properties.farmId === farmScope)
        .map((feature) => {
          const farmId = String(feature.properties.farmId || "");
          const parcelId = String(feature.properties.parcelId || "");
          const parcelLabel = String(feature.properties.ID_PARCELA || parcelId);
          return {
            ...feature,
            id: parcelId,
            properties: {
              ...feature.properties,
              parcelLabel,
              depositCount: depositCountByParcel.get(`${farmId}:${normalizeParcel(parcelLabel)}`) || 0,
              selected: parcelId === selectedParcelId,
            },
          };
        }),
    };
  }, [deposits, farmScope, selectedParcelId]);

  const markerData = useMemo<MapFeatureCollection>(() => ({
    type: "FeatureCollection",
    features: deposits
      .filter(hasGps)
      .filter((deposit) => {
        const farmId = farmIdFromName(deposit.farm);
        return farmId && (farmScope === "all" || farmId === farmScope);
      })
      .map((deposit) => ({
        type: "Feature",
        id: deposit.id,
        properties: {
          depositId: deposit.id,
          farmId: farmIdFromName(deposit.farm),
          ticket: deposit.scaleTicketCode || "Sem ticket",
          driver: deposit.driverName || deposit.driverRegistration,
          plate: deposit.vehiclePlate,
          parcel: [deposit.plotPrimary, deposit.plotSecondary].filter(Boolean).join(" / "),
          subproduct: deposit.subproduct,
          color: subproductColors[deposit.subproduct] || subproductColors.Outros,
          selected: deposit.id === selectedDepositId,
        },
        geometry: {
          type: "Point",
          coordinates: [deposit.longitude, deposit.latitude],
        },
      })),
  }), [deposits, farmScope, selectedDepositId]);

  const selectedDeposit = useMemo(
    () => deposits.find((deposit) => deposit.id === selectedDepositId) || null,
    [deposits, selectedDepositId],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleUrl,
      center: mapCenter,
      zoom: 11.2,
      attributionControl: false,
      maxPitch: 60,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const selectParcel = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const farmId = feature?.properties?.farmId as Exclude<FarmScope, "all"> | undefined;
      const parcelId = String(feature?.properties?.parcelId || "");
      if (farmId && parcelId) callbackRef.current.onSelectParcel(farmId, parcelId);
    };
    const selectDischarge = (event: MapLayerMouseEvent) => {
      const depositId = String(event.features?.[0]?.properties?.depositId || "");
      if (depositId) callbackRef.current.onSelectDeposit(depositId);
    };
    const expandCluster = async (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = Number(feature?.properties?.cluster_id);
      const source = map.getSource("vna-discharges") as GeoJSONSource | undefined;
      if (!source || !Number.isFinite(clusterId) || !feature?.geometry || feature.geometry.type !== "Point") return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({
        center: feature.geometry.coordinates as Coordinate,
        zoom,
      });
    };
    const pointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const defaultPointer = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("load", () => {
      addOperationalLayers(map, parcelData, markerData);
      fitMapToData(map, [parcelData, markerData]);
      map.on("click", "vna-parcels-fill", selectParcel);
      map.on("click", "vna-discharges-points", selectDischarge);
      map.on("click", "vna-discharge-clusters", expandCluster);
      ["vna-parcels-fill", "vna-discharges-points", "vna-discharge-clusters"].forEach((layer) => {
        map.on("mouseenter", layer, pointer);
        map.on("mouseleave", layer, defaultPointer);
      });
      setMapReady(true);
    });
    map.on("error", (event: { error?: Error }) => {
      if (!map.loaded()) {
        setMapError(event.error?.message || "Não foi possível carregar o mapa vetorial.");
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const parcels = map.getSource("vna-parcels") as GeoJSONSource | undefined;
    const markers = map.getSource("vna-discharges") as GeoJSONSource | undefined;
    parcels?.setData(parcelData as never);
    markers?.setData(markerData as never);
    fitMapToData(map, [parcelData, markerData]);
  }, [farmScope, mapReady, markerData, parcelData]);

  return (
    <div className="operations-map-shell">
      <div className="operations-map-canvas" ref={containerRef} aria-label="Mapa operacional dos descarregos" />

      {!mapReady && !mapError ? (
        <div className="operations-map-loading" role="status">
          <Satellite aria-hidden="true" />
          <span>Carregando mapa vetorial</span>
        </div>
      ) : null}

      {mapError ? (
        <div className="operations-map-error" role="alert">
          <WifiOff aria-hidden="true" />
          <strong>Mapa temporariamente indisponível</strong>
          <span>{mapError}</span>
        </div>
      ) : null}

      <div className="operations-map-tech">
        <Satellite aria-hidden="true" />
        <span>MapLibre · GeoJSON · tiles vetoriais</span>
      </div>

      <div className="operations-map-legend" aria-label="Legenda do mapa">
        <strong>
          <Layers3 aria-hidden="true" />
          Subprodutos
        </strong>
        {Object.entries(subproductColors).slice(0, 5).map(([label, color]) => (
          <span key={label}>
            <i style={{ backgroundColor: color }} />
            {label.replace("Cacho Vazio (Bucha)", "Bucha")}
          </span>
        ))}
      </div>

      {selectedDeposit ? (
        <button
          type="button"
          className="operations-map-selection"
          onClick={() => onSelectDeposit(selectedDeposit.id)}
          aria-label={`Abrir coleta ${selectedDeposit.scaleTicketCode || selectedDeposit.id}`}
        >
          <MapPinned aria-hidden="true" />
          <span>
            <small>{selectedDeposit.scaleTicketCode || "Sem ticket"}</small>
            <strong>{selectedDeposit.subproduct}</strong>
            <em>
              {selectedDeposit.vehiclePlate} · {[selectedDeposit.plotPrimary, selectedDeposit.plotSecondary]
                .filter(Boolean)
                .join(" / ")}
            </em>
          </span>
          <Crosshair aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

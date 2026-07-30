import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  StyleSpecification,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Box,
  Crosshair,
  Flame,
  Layers3,
  Map as MapIcon,
  MapPinned,
  Satellite,
  Sparkles,
  WifiOff,
} from "lucide-react";
import farmParcelsGeoJson from "../data/farm-parcels.json";
import type { FieldDeposit } from "../types";

type FarmScope = "all" | "vila-nova" | "fe-em-deus";
type Coordinate = [number, number];
type BasemapMode = "satellite" | "street" | "clean";
type MapStatus = "starting" | "ready" | "degraded" | "unsupported";

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

const mapCenter: Coordinate = [-48.22, -2.86];
const sourceIds = {
  parcels: "vna-parcels",
  discharges: "vna-discharges",
  basemap: "vna-basemap",
};
const operationalLayerIds = {
  heat: "vna-discharge-heat",
  extrusion: "vna-parcels-extrusion",
  fill: "vna-parcels-fill",
  outline: "vna-parcels-outline",
  clusters: "vna-discharge-clusters",
  clusterCount: "vna-discharge-cluster-count",
  pointsHalo: "vna-discharges-points-halo",
  points: "vna-discharges-points",
};

const localStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "vna-background",
      type: "background",
      paint: {
        "background-color": "#dce9df",
      },
    },
  ],
};

const basemaps: Record<Exclude<BasemapMode, "clean">, {
  label: string;
  tiles: string[];
  attribution: string;
}> = {
  satellite: {
    label: "Satélite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery © Esri",
  },
  street: {
    label: "Ruas",
    tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
    attribution: "© OpenStreetMap contributors © CARTO",
  },
};

const subproductColors: Record<string, string> = {
  Borra: "#176443",
  "Cacho Vazio (Bucha)": "#28719d",
  "Cacho Triturado": "#74a93e",
  Cinza: "#68736e",
  Torta: "#d99620",
  Outros: "#d65e32",
};

maplibregl.setWorkerUrl(maplibreWorkerUrl);

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
  return typeof deposit.latitude === "number"
    && typeof deposit.longitude === "number"
    && Number.isFinite(deposit.latitude)
    && Number.isFinite(deposit.longitude);
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

function browserSupportsWebGl() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGL2RenderingContext && canvas.getContext("webgl2")
      || window.WebGLRenderingContext && canvas.getContext("webgl"),
    );
  } catch {
    return false;
  }
}

function fitMapToData(map: MapLibreMap, collections: MapFeatureCollection[], animate = true) {
  const coordinates = collections.flatMap((collection) => (
    collection.features.flatMap((feature) => flattenCoordinates(feature.geometry.coordinates))
  ));
  if (!coordinates.length) {
    map.easeTo({ center: mapCenter, zoom: 11.2, duration: animate ? 500 : 0 });
    return;
  }

  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );

  map.fitBounds(bounds, {
    padding: { top: 92, right: 54, bottom: 110, left: 54 },
    maxZoom: 15.4,
    duration: animate ? 700 : 0,
  });
}

function setBasemap(map: MapLibreMap, mode: BasemapMode) {
  if (map.getLayer("vna-basemap-raster")) map.removeLayer("vna-basemap-raster");
  if (map.getSource(sourceIds.basemap)) map.removeSource(sourceIds.basemap);
  if (mode === "clean") return;

  const basemap = basemaps[mode];
  map.addSource(sourceIds.basemap, {
    type: "raster",
    tiles: basemap.tiles,
    tileSize: 256,
    maxzoom: 20,
    attribution: basemap.attribution,
  });
  map.addLayer(
    {
      id: "vna-basemap-raster",
      type: "raster",
      source: sourceIds.basemap,
      paint: {
        "raster-opacity": mode === "satellite" ? 0.92 : 1,
        "raster-saturation": mode === "satellite" ? -0.12 : -0.3,
        "raster-contrast": mode === "satellite" ? 0.08 : 0.02,
      },
    },
    operationalLayerIds.heat,
  );
}

function addOperationalLayers(
  map: MapLibreMap,
  parcels: MapFeatureCollection,
  markers: MapFeatureCollection,
  showHeat: boolean,
  show3d: boolean,
) {
  map.addSource(sourceIds.parcels, {
    type: "geojson",
    data: parcels as never,
  });
  map.addSource(sourceIds.discharges, {
    type: "geojson",
    data: markers as never,
    cluster: true,
    clusterRadius: 44,
    clusterMaxZoom: 14,
  });

  map.addLayer({
    id: operationalLayerIds.heat,
    type: "heatmap",
    source: sourceIds.discharges,
    maxzoom: 15.5,
    layout: { visibility: showHeat ? "visible" : "none" },
    paint: {
      "heatmap-weight": 0.82,
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 15, 1.8],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0, "rgba(24,101,67,0)",
        0.25, "rgba(102,164,73,0.54)",
        0.55, "rgba(239,177,50,0.72)",
        0.8, "rgba(224,91,46,0.82)",
        1, "rgba(123,35,24,0.92)",
      ],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 15, 15, 30],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.85, 16, 0.1],
    },
  });
  map.addLayer({
    id: operationalLayerIds.extrusion,
    type: "fill-extrusion",
    source: sourceIds.parcels,
    minzoom: 10.5,
    layout: { visibility: show3d ? "visible" : "none" },
    paint: {
      "fill-extrusion-color": [
        "case",
        ["==", ["get", "farmId"], "vila-nova"],
        "#1f7a4d",
        "#28749e",
      ],
      "fill-extrusion-height": [
        "interpolate",
        ["linear"],
        ["number", ["get", "depositCount"], 0],
        0, 2,
        1, 10,
        8, 32,
        20, 54,
      ],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.8,
    },
  });
  map.addLayer({
    id: operationalLayerIds.fill,
    type: "fill",
    source: sourceIds.parcels,
    paint: {
      "fill-color": [
        "case",
        ["boolean", ["get", "selected"], false], "#f2b134",
        ["==", ["get", "farmId"], "vila-nova"], "#25784e",
        "#2f759d",
      ],
      "fill-opacity": [
        "case",
        ["boolean", ["get", "selected"], false], 0.68,
        [">", ["number", ["get", "depositCount"], 0], 0], 0.48,
        0.24,
      ],
    },
  });
  map.addLayer({
    id: operationalLayerIds.outline,
    type: "line",
    source: sourceIds.parcels,
    paint: {
      "line-color": [
        "case",
        ["boolean", ["get", "selected"], false], "#ffd56a",
        "#103e2a",
      ],
      "line-width": [
        "case",
        ["boolean", ["get", "selected"], false], 4,
        1.5,
      ],
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: operationalLayerIds.clusters,
    type: "circle",
    source: sourceIds.discharges,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#256a49",
        10, "#d89520",
        25, "#d65e32",
      ],
      "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 25, 31],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
      "circle-opacity": 0.96,
    },
  });
  map.addLayer({
    id: operationalLayerIds.clusterCount,
    type: "symbol",
    source: sourceIds.discharges,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 12,
    },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: operationalLayerIds.pointsHalo,
    type: "circle",
    source: sourceIds.discharges,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": [
        "case",
        ["boolean", ["get", "selected"], false], 15,
        11,
      ],
      "circle-opacity": 0.96,
      "circle-blur": 0.15,
    },
  });
  map.addLayer({
    id: operationalLayerIds.points,
    type: "circle",
    source: sourceIds.discharges,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": [
        "case",
        ["boolean", ["get", "selected"], false], 10,
        7,
      ],
      "circle-stroke-color": [
        "case",
        ["boolean", ["get", "selected"], false], "#ffd56a",
        "#ffffff",
      ],
      "circle-stroke-width": [
        "case",
        ["boolean", ["get", "selected"], false], 3,
        1.5,
      ],
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
  const latestDataRef = useRef<MapFeatureCollection[]>([]);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<MapStatus>("starting");
  const [statusMessage, setStatusMessage] = useState("Preparando motor geoespacial");
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("satellite");
  const [showHeat, setShowHeat] = useState(false);
  const [show3d, setShow3d] = useState(false);

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
        .filter((feature) => ["vila-nova", "fe-em-deus"].includes(String(feature.properties.farmId || "")))
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

  latestDataRef.current = [parcelData, markerData];

  const selectedDeposit = useMemo(
    () => deposits.find((deposit) => deposit.id === selectedDepositId) || null,
    [deposits, selectedDepositId],
  );
  const gpsCount = markerData.features.length;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    if (!browserSupportsWebGl()) {
      setStatus("unsupported");
      setStatusMessage("Este navegador não disponibilizou aceleração gráfica.");
      return undefined;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const startupTimeout = window.setTimeout(() => {
      if (!readyRef.current && !disposed) {
        setStatus("degraded");
        setStatusMessage("O motor demorou mais que o esperado. O modo seguro foi ativado.");
      }
    }, 6_000);

    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: localStyle,
        center: mapCenter,
        zoom: 11.2,
        attributionControl: false,
        maxPitch: 65,
        pitchWithRotate: true,
        dragRotate: true,
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
        const source = map.getSource(sourceIds.discharges) as GeoJSONSource | undefined;
        if (!source || !Number.isFinite(clusterId) || feature?.geometry?.type !== "Point") return;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: feature.geometry.coordinates as Coordinate, zoom });
      };
      const pointer = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const defaultPointer = () => {
        map.getCanvas().style.cursor = "";
      };

      map.once("load", () => {
        if (disposed) return;
        const [parcels, markers] = latestDataRef.current;
        addOperationalLayers(map, parcels, markers, showHeat, show3d);
        setBasemap(map, basemapMode);
        fitMapToData(map, [parcels, markers], false);

        map.on("click", operationalLayerIds.fill, selectParcel);
        map.on("click", operationalLayerIds.points, selectDischarge);
        map.on("click", operationalLayerIds.clusters, expandCluster);
        [operationalLayerIds.fill, operationalLayerIds.points, operationalLayerIds.clusters].forEach((layer) => {
          map.on("mouseenter", layer, pointer);
          map.on("mouseleave", layer, defaultPointer);
        });

        readyRef.current = true;
        window.clearTimeout(startupTimeout);
        setStatus("ready");
        setStatusMessage("Mapa operacional");
      });

      map.on("error", (event: { error?: Error }) => {
        if (!readyRef.current) {
          setStatus("degraded");
          setStatusMessage(event.error?.message || "Falha ao iniciar a visualização geoespacial.");
        }
      });

      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);
    } catch (error) {
      window.clearTimeout(startupTimeout);
      setStatus("unsupported");
      setStatusMessage(error instanceof Error ? error.message : "Não foi possível iniciar o mapa.");
    }

    return () => {
      disposed = true;
      window.clearTimeout(startupTimeout);
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const parcels = map.getSource(sourceIds.parcels) as GeoJSONSource | undefined;
    const markers = map.getSource(sourceIds.discharges) as GeoJSONSource | undefined;
    parcels?.setData(parcelData as never);
    markers?.setData(markerData as never);
    fitMapToData(map, [parcelData, markerData]);
  }, [farmScope, markerData, parcelData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    try {
      setBasemap(map, basemapMode);
      setStatus("ready");
      setStatusMessage(basemapMode === "clean" ? "Mapa operacional · modo leve" : "Mapa operacional");
    } catch {
      setStatus("degraded");
      setStatusMessage("A imagem de fundo falhou; os dados operacionais continuam disponíveis.");
    }
  }, [basemapMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer(operationalLayerIds.heat)) return;
    map.setLayoutProperty(operationalLayerIds.heat, "visibility", showHeat ? "visible" : "none");
  }, [showHeat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer(operationalLayerIds.extrusion)) return;
    map.setLayoutProperty(operationalLayerIds.extrusion, "visibility", show3d ? "visible" : "none");
    map.easeTo({
      pitch: show3d ? 44 : 0,
      bearing: show3d ? -14 : 0,
      duration: 700,
    });
  }, [show3d]);

  const retryMap = () => window.location.reload();

  return (
    <div className="operations-map-shell" data-map-status={status}>
      <div
        className="operations-map-canvas"
        ref={containerRef}
        aria-label="Mapa operacional dos descarregos"
      />

      {status === "starting" ? (
        <div className="operations-map-loading" role="status">
          <span className="operations-map-loading-mark"><Satellite aria-hidden="true" /></span>
          <strong>Inicializando mapa operacional</strong>
          <span>Parcelas e pontos GPS serão exibidos mesmo sem imagem de satélite.</span>
        </div>
      ) : null}

      {status === "unsupported" ? (
        <div className="operations-map-error" role="alert">
          <WifiOff aria-hidden="true" />
          <strong>Visualização 3D indisponível</strong>
          <span>{statusMessage}</span>
          <button type="button" onClick={retryMap}>Tentar novamente</button>
        </div>
      ) : null}

      <div className={`operations-map-status is-${status}`} aria-live="polite">
        <span />
        <strong>{statusMessage}</strong>
        <em>{gpsCount} pontos GPS · {parcelData.features.length} parcelas</em>
      </div>

      <div className="operations-map-mode-switch" aria-label="Escolher visual do mapa">
        <button
          type="button"
          className={basemapMode === "satellite" ? "is-active" : ""}
          onClick={() => setBasemapMode("satellite")}
          aria-pressed={basemapMode === "satellite"}
        >
          <Satellite aria-hidden="true" />
          Satélite
        </button>
        <button
          type="button"
          className={basemapMode === "street" ? "is-active" : ""}
          onClick={() => setBasemapMode("street")}
          aria-pressed={basemapMode === "street"}
        >
          <MapIcon aria-hidden="true" />
          Ruas
        </button>
        <button
          type="button"
          className={basemapMode === "clean" ? "is-active" : ""}
          onClick={() => setBasemapMode("clean")}
          aria-pressed={basemapMode === "clean"}
        >
          <Sparkles aria-hidden="true" />
          Limpo
        </button>
      </div>

      <div className="operations-map-tools" aria-label="Ferramentas do mapa">
        <button
          type="button"
          className={showHeat ? "is-active" : ""}
          onClick={() => setShowHeat((current) => !current)}
          aria-pressed={showHeat}
          title="Mapa de calor dos descarregos"
        >
          <Flame aria-hidden="true" />
          <span>Calor</span>
        </button>
        <button
          type="button"
          className={show3d ? "is-active" : ""}
          onClick={() => setShow3d((current) => !current)}
          aria-pressed={show3d}
          title="Volume por parcela em 3D"
        >
          <Box aria-hidden="true" />
          <span>3D</span>
        </button>
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

      <div className="operations-map-signature">
        <Satellite aria-hidden="true" />
        <span>MapLibre GL · mapa resiliente</span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Camera, Crosshair, FileCheck2, MapPinned, Save, Truck } from "lucide-react";
import { normalizePlate, timeInputValue, todayInputValue } from "../lib/format";
import { subproductFleetVehicles } from "../lib/fleet";
import {
  fieldFarmOptions,
  getBetweenParcelOptions,
  getFieldFarmByValue,
  getParcelOptionsForFarm,
  isValidBetweenParcelPair,
  isValidFarmParcel,
} from "../lib/fieldParcels";
import { findDriverByRegistration, normalizeRegistration } from "../lib/headcount";
import { saveDeposit } from "../lib/localStore";
import type { FieldDeposit, LoadingOrigin, PlacementMode, Subproduct } from "../types";

interface FieldFormProps {
  onSaved: () => void;
}

const subproducts: Subproduct[] = [
  "Borra",
  "Cacho Vazio (Bucha)",
  "Cacho Triturado",
  "Cinza",
  "Torta",
  "Outros",
];

const loadingOrigins: LoadingOrigin[] = ["Extratora", "Patio", "Outras"];
const MAX_DUMP_PHOTO_EDGE = 1280;
const DUMP_PHOTO_QUALITY = 0.74;

interface FormState {
  driverRegistration: string;
  driverName: string;
  vehiclePlate: string;
  subproduct: Subproduct;
  subproductOther: string;
  loadingOrigin: LoadingOrigin;
  loadingOriginOther: string;
  scaleTicketCode: string;
  farm: string;
  placementMode: PlacementMode;
  plotPrimary: string;
  plotSecondary: string;
  depositDate: string;
  depositTime: string;
  dumpPhotoDataUrl: string;
  dumpPhotoName: string;
  dumpPhotoLatitude: number | null;
  dumpPhotoLongitude: number | null;
  dumpPhotoAccuracy: number | null;
  dumpPhotoCapturedAt: string;
  notes: string;
}

const initialForm: FormState = {
  driverRegistration: "",
  driverName: "",
  vehiclePlate: "",
  subproduct: "Borra",
  subproductOther: "",
  loadingOrigin: "Extratora",
  loadingOriginOther: "",
  scaleTicketCode: "",
  farm: "VILA NOVA",
  placementMode: "single_plot",
  plotPrimary: "",
  plotSecondary: "",
  depositDate: todayInputValue(),
  depositTime: timeInputValue(),
  dumpPhotoDataUrl: "",
  dumpPhotoName: "",
  dumpPhotoLatitude: null,
  dumpPhotoLongitude: null,
  dumpPhotoAccuracy: null,
  dumpPhotoCapturedAt: "",
  notes: "",
};

interface CapturedLocation {
  latitude: number;
  longitude: number;
  locationAccuracy: number | null;
}

interface PhotoStampData extends CapturedLocation {
  capturedAt: string;
  farm: string;
  plotPrimary: string;
  plotSecondary: string;
  scaleTicketCode: string;
}

function RequiredLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="required-label">
      {children}
      <span className="required-marker" aria-hidden="true">*</span>
    </span>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new Error("Nao foi possivel ler a foto.")));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Nao foi possivel abrir a foto.")));
    image.src = dataUrl;
  });
}

function getLocationErrorMessage(error?: unknown) {
  if (!window.isSecureContext) {
    return "GPS exige HTTPS ou localhost. No celular, abra o app por HTTPS ou instale como app seguro.";
  }

  if (error && typeof error === "object" && "code" in error) {
    const code = Number((error as GeolocationPositionError).code);

    if (code === 1) return "Permissao de GPS negada. Libere a localizacao no navegador.";
    if (code === 2) return "GPS indisponivel no momento. Tente em area aberta.";
    if (code === 3) return "Tempo de captura do GPS esgotado. Tente novamente.";
  }

  return "Nao foi possivel capturar o GPS.";
}

function requestCurrentLocation() {
  return new Promise<CapturedLocation>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS indisponivel neste aparelho."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude.toFixed(7)),
          longitude: Number(position.coords.longitude.toFixed(7)),
          locationAccuracy: Math.round(position.coords.accuracy),
        });
      },
      reject,
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 18_000,
      },
    );
  });
}

function formatCoordinate(value: number) {
  return value.toFixed(7);
}

function formatPhotoTimestamp(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function drawPhotoFooter(context: CanvasRenderingContext2D, width: number, height: number, stamp: PhotoStampData) {
  const fontSize = Math.max(16, Math.round(width * 0.022));
  const smallFontSize = Math.max(13, Math.round(fontSize * 0.78));
  const lineHeight = Math.round(fontSize * 1.38);
  const padding = Math.round(fontSize * 0.75);
  const locationLine = `GPS ${formatCoordinate(stamp.latitude)}, ${formatCoordinate(stamp.longitude)}${
    stamp.locationAccuracy ? ` | precisao ${stamp.locationAccuracy} m` : ""
  }`;
  const placeParts = [
    stamp.farm,
    stamp.plotPrimary ? `Parcela ${stamp.plotPrimary}${stamp.plotSecondary ? ` / ${stamp.plotSecondary}` : ""}` : "",
    stamp.scaleTicketCode ? `Ticket ${stamp.scaleTicketCode}` : "",
  ].filter(Boolean);
  const lines = [
    "Vila Nova Agroindustrial | Foto do despejo",
    locationLine,
    `${formatPhotoTimestamp(stamp.capturedAt)}${placeParts.length ? ` | ${placeParts.join(" | ")}` : ""}`,
  ];
  const footerHeight = padding * 2 + lineHeight * lines.length;
  const footerY = Math.max(0, height - footerHeight);

  context.fillStyle = "rgba(10, 44, 31, 0.88)";
  context.fillRect(0, footerY, width, footerHeight);
  context.fillStyle = "#ffffff";
  context.textBaseline = "top";

  lines.forEach((line, index) => {
    context.font = `${index === 0 ? 800 : 700} ${index === 0 ? fontSize : smallFontSize}px sans-serif`;
    context.fillText(line, padding, footerY + padding + index * lineHeight, width - padding * 2);
  });
}

async function compressDumpPhoto(file: File, stamp: PhotoStampData) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selecione uma imagem valida.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_DUMP_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Nao foi possivel processar a foto.");
  }

  context.drawImage(image, 0, 0, width, height);
  drawPhotoFooter(context, width, height, stamp);
  return canvas.toDataURL("image/jpeg", DUMP_PHOTO_QUALITY);
}

export function FieldForm({ onSaved }: FieldFormProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [driverLookupState, setDriverLookupState] = useState<"idle" | "loading" | "found" | "not-found">("idle");
  const [location, setLocation] = useState<Pick<
    FieldDeposit,
    "latitude" | "longitude" | "locationAccuracy"
  >>({
    latitude: null,
    longitude: null,
    locationAccuracy: null,
  });
  const [locationState, setLocationState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [photoState, setPhotoState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [photoMessage, setPhotoMessage] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [savedMessageIsError, setSavedMessageIsError] = useState(false);

  const selectedFarm = useMemo(
    () => getFieldFarmByValue(form.farm) ?? fieldFarmOptions[0],
    [form.farm],
  );

  const parcelOptions = useMemo(
    () => getParcelOptionsForFarm(selectedFarm.id),
    [selectedFarm.id],
  );

  const secondaryParcelOptions = useMemo(
    () => getBetweenParcelOptions(selectedFarm.id, form.plotPrimary),
    [selectedFarm.id, form.plotPrimary],
  );

  const missingRequiredFields = useMemo(() => {
    const missing: string[] = [];
    const subproductReady = form.subproduct !== "Outros" || form.subproductOther.trim();
    const loadingOriginReady = form.loadingOrigin !== "Outras" || form.loadingOriginOther.trim();
    const locationReady = typeof location.latitude === "number" && typeof location.longitude === "number";
    const photoReady = Boolean(
      form.dumpPhotoDataUrl
        && typeof form.dumpPhotoLatitude === "number"
        && typeof form.dumpPhotoLongitude === "number",
    );
    const farmReady = Boolean(getFieldFarmByValue(form.farm));
    const primaryParcelReady = isValidFarmParcel(selectedFarm.id, form.plotPrimary);
    const secondaryParcelReady =
      form.placementMode === "single_plot" ||
      isValidBetweenParcelPair(selectedFarm.id, form.plotPrimary, form.plotSecondary);

    if (!form.driverRegistration.trim()) missing.push("matricula");
    if (!form.driverName.trim()) missing.push("nome do motorista");
    if (form.vehiclePlate.trim().length < 7) missing.push("placa");
    if (!form.subproduct || !subproductReady) missing.push("subproduto");
    if (!form.loadingOrigin || !loadingOriginReady) missing.push("origem do carregamento");
    if (!form.scaleTicketCode.trim()) missing.push("ticket da balanca");
    if (!farmReady) missing.push("fazenda");
    if (!primaryParcelReady) missing.push(form.placementMode === "between_plots" ? "parcela principal" : "parcela");
    if (!secondaryParcelReady) missing.push("parcela vizinha");
    if (!form.depositDate) missing.push("data");
    if (!form.depositTime) missing.push("hora");
    if (!locationReady) missing.push("GPS do despejo");
    if (!photoReady) missing.push("foto do despejo com GPS");

    return missing;
  }, [form, location.latitude, location.longitude, selectedFarm.id]);

  const canSave = missingRequiredFields.length === 0;

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setSavedMessage("");
    setSavedMessageIsError(false);
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateFarm = (value: string) => {
    setSavedMessage("");
    setSavedMessageIsError(false);
    setForm((current) => ({
      ...current,
      farm: value,
      plotPrimary: "",
      plotSecondary: "",
    }));
  };

  const updatePlacementMode = (value: PlacementMode) => {
    setSavedMessage("");
    setSavedMessageIsError(false);
    setForm((current) => ({
      ...current,
      placementMode: value,
      plotSecondary: value === "single_plot" ? "" : current.plotSecondary,
    }));
  };

  const updatePlotPrimary = (value: string) => {
    setSavedMessage("");
    setSavedMessageIsError(false);
    setForm((current) => ({
      ...current,
      plotPrimary: value,
      plotSecondary: "",
    }));
  };

  const updateDriverRegistration = (value: string) => {
    const registration = normalizeRegistration(value).slice(0, 6);
    setSavedMessage("");
    setSavedMessageIsError(false);
    setDriverLookupState(registration ? "loading" : "idle");
    setForm((current) => ({
      ...current,
      driverRegistration: registration,
      driverName: registration === normalizeRegistration(current.driverRegistration) ? current.driverName : "",
    }));
  };

  const updateDumpPhoto = async (file: File | null) => {
    setSavedMessage("");
    setSavedMessageIsError(false);
    setPhotoMessage("");

    if (!file) {
      setPhotoState("idle");
      setForm((current) => ({
        ...current,
        dumpPhotoDataUrl: "",
        dumpPhotoName: "",
        dumpPhotoLatitude: null,
        dumpPhotoLongitude: null,
        dumpPhotoAccuracy: null,
        dumpPhotoCapturedAt: "",
      }));
      return;
    }

    setPhotoState("loading");
    setPhotoMessage("Capturando GPS para carimbar a foto.");

    try {
      const capturedAt = new Date().toISOString();
      const capturedLocation = typeof location.latitude === "number" && typeof location.longitude === "number"
        ? {
            latitude: location.latitude,
            longitude: location.longitude,
            locationAccuracy: location.locationAccuracy,
          }
        : await requestCurrentLocation();
      const photoDataUrl = await compressDumpPhoto(file, {
        ...capturedLocation,
        capturedAt,
        farm: form.farm,
        plotPrimary: form.plotPrimary,
        plotSecondary: form.placementMode === "between_plots" ? form.plotSecondary : "",
        scaleTicketCode: form.scaleTicketCode.trim().toUpperCase(),
      });

      setLocation(capturedLocation);
      setLocationState("ok");
      setLocationMessage("GPS capturado com a foto.");
      setForm((current) => ({
        ...current,
        dumpPhotoDataUrl: photoDataUrl,
        dumpPhotoName: file.name,
        dumpPhotoLatitude: capturedLocation.latitude,
        dumpPhotoLongitude: capturedLocation.longitude,
        dumpPhotoAccuracy: capturedLocation.locationAccuracy,
        dumpPhotoCapturedAt: capturedAt,
      }));
      setPhotoMessage("Foto anexada com GPS no rodape.");
      setPhotoState("ok");
    } catch (error) {
      setForm((current) => ({
        ...current,
        dumpPhotoDataUrl: "",
        dumpPhotoName: "",
        dumpPhotoLatitude: null,
        dumpPhotoLongitude: null,
        dumpPhotoAccuracy: null,
        dumpPhotoCapturedAt: "",
      }));
      setPhotoInputKey((current) => current + 1);
      setLocationState("error");
      setLocationMessage(getLocationErrorMessage(error));
      setPhotoMessage(getLocationErrorMessage(error));
      setPhotoState("error");
    }
  };

  useEffect(() => {
    const registration = normalizeRegistration(form.driverRegistration);

    if (registration.length < 2) {
      setDriverLookupState("idle");
      return undefined;
    }

    let cancelled = false;
    setDriverLookupState("loading");

    const timer = window.setTimeout(() => {
      findDriverByRegistration(registration)
        .then((driver) => {
          if (cancelled) return;

          if (!driver) {
            setDriverLookupState("not-found");
            return;
          }

          setForm((current) => (
            normalizeRegistration(current.driverRegistration) === registration
              ? {
                  ...current,
                  driverRegistration: driver.registration,
                  driverName: driver.name,
                }
              : current
          ));
          setDriverLookupState("found");
        })
        .catch(() => {
          if (!cancelled) setDriverLookupState("not-found");
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.driverRegistration]);

  const captureLocation = async () => {
    setLocationState("loading");
    setLocationMessage("");

    try {
      const capturedLocation = await requestCurrentLocation();
      setLocation(capturedLocation);
      setLocationState("ok");
      setLocationMessage("GPS do despejo capturado.");
      setSavedMessage("");
      setSavedMessageIsError(false);
    } catch (error) {
      setLocationState("error");
      setLocationMessage(getLocationErrorMessage(error));
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSave) {
      setSavedMessage(`Faltam campos obrigatorios: ${missingRequiredFields.join(", ")}.`);
      setSavedMessageIsError(true);
      return;
    }

    const now = new Date().toISOString();
    const subproduct = (form.subproduct === "Outros" ? form.subproductOther.trim() : form.subproduct) as Subproduct;
    const loadingOrigin = (
      form.loadingOrigin === "Outras" ? form.loadingOriginOther.trim() : form.loadingOrigin
    ) as LoadingOrigin;
    const deposit: FieldDeposit = {
      id: crypto.randomUUID(),
      driverRegistration: form.driverRegistration.trim().toUpperCase(),
      driverName: form.driverName.trim(),
      vehiclePlate: normalizePlate(form.vehiclePlate),
      subproduct,
      loadingOrigin,
      scaleTicketCode: form.scaleTicketCode.trim().toUpperCase(),
      farm: form.farm.trim(),
      placementMode: form.placementMode,
      plotPrimary: form.plotPrimary.trim(),
      plotSecondary:
        form.placementMode === "between_plots" ? form.plotSecondary.trim() : "",
      depositDate: form.depositDate,
      depositTime: form.depositTime,
      latitude: location.latitude,
      longitude: location.longitude,
      locationAccuracy: location.locationAccuracy,
      dumpPhotoDataUrl: form.dumpPhotoDataUrl,
      dumpPhotoName: form.dumpPhotoName || null,
      dumpPhotoLatitude: form.dumpPhotoLatitude,
      dumpPhotoLongitude: form.dumpPhotoLongitude,
      dumpPhotoAccuracy: form.dumpPhotoAccuracy,
      dumpPhotoCapturedAt: form.dumpPhotoCapturedAt || null,
      notes: form.notes.trim(),
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending",
      syncError: null,
      syncedAt: null,
    };

    await saveDeposit(deposit);
    setForm({
      ...initialForm,
      driverRegistration: deposit.driverRegistration,
      driverName: deposit.driverName,
      vehiclePlate: deposit.vehiclePlate,
      depositDate: todayInputValue(),
      depositTime: timeInputValue(),
    });
    setLocation({
      latitude: null,
      longitude: null,
      locationAccuracy: null,
    });
    setLocationState("idle");
    setLocationMessage("");
    setPhotoState("idle");
    setPhotoMessage("");
    setPhotoInputKey((current) => current + 1);
    setSavedMessage("Registro salvo no aparelho.");
    setSavedMessageIsError(false);
    onSaved();
  };

  return (
    <section className="work-surface">
      <div className="surface-heading">
        <div>
          <p className="eyebrow">Campo</p>
          <h1>Registro de despejo</h1>
        </div>
        <FileCheck2 aria-hidden="true" />
      </div>

      <form className="field-form" onSubmit={submit} noValidate>
        <div className="form-band">
          <div className="band-title">
            <Truck aria-hidden="true" />
            <span>Motorista e veiculo</span>
          </div>

          <label>
            <RequiredLabel>Matricula</RequiredLabel>
            <input
              value={form.driverRegistration}
              onChange={(event) => updateDriverRegistration(event.target.value)}
              placeholder="2985"
              required
            />
          </label>

          <label>
            <RequiredLabel>Nome do motorista</RequiredLabel>
            <input
              value={form.driverName}
              onChange={(event) => update("driverName", event.target.value)}
              placeholder={driverLookupState === "loading" ? "Consultando headcount" : "Nome do headcount"}
              readOnly={driverLookupState === "found" || driverLookupState === "loading"}
              required
            />
          </label>

          <label>
            <RequiredLabel>Placa</RequiredLabel>
            <input
              list="vehicle-plate-options"
              value={form.vehiclePlate}
              onChange={(event) => update("vehiclePlate", normalizePlate(event.target.value))}
              placeholder="RWL-9F61"
              required
              minLength={7}
            />
            <datalist id="vehicle-plate-options">
              {subproductFleetVehicles.map((vehicle) => (
                <option
                  key={vehicle.plate}
                  value={vehicle.plate}
                  label={`${vehicle.fleetNumber} · ${vehicle.description}`}
                />
              ))}
            </datalist>
          </label>
        </div>

        <div className="form-grid">
          <label>
            <RequiredLabel>Subproduto</RequiredLabel>
            <select
              value={form.subproduct}
              onChange={(event) => update("subproduct", event.target.value as Subproduct)}
              required
            >
              {subproducts.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>

          {form.subproduct === "Outros" ? (
            <label>
              <RequiredLabel>Qual subproduto?</RequiredLabel>
              <input
                value={form.subproductOther}
                onChange={(event) => update("subproductOther", event.target.value)}
                placeholder="Informe o subproduto"
                required
              />
            </label>
          ) : null}

          <label>
            <RequiredLabel>Ticket da balanca</RequiredLabel>
            <input
              value={form.scaleTicketCode}
              onChange={(event) => update("scaleTicketCode", event.target.value)}
              placeholder="BAL-2026-0001"
              required
            />
          </label>

          <label>
            <RequiredLabel>Origem do carregamento</RequiredLabel>
            <select
              value={form.loadingOrigin}
              onChange={(event) => update("loadingOrigin", event.target.value as LoadingOrigin)}
              required
            >
              {loadingOrigins.map((origin) => (
                <option key={origin}>{origin}</option>
              ))}
            </select>
          </label>

          {form.loadingOrigin === "Outras" ? (
            <label>
              <RequiredLabel>Qual origem?</RequiredLabel>
              <input
                value={form.loadingOriginOther}
                onChange={(event) => update("loadingOriginOther", event.target.value)}
                placeholder="Informe a origem"
                required
              />
            </label>
          ) : null}

          <label>
            <RequiredLabel>Fazenda</RequiredLabel>
            <select
              value={form.farm}
              onChange={(event) => updateFarm(event.target.value)}
              required
            >
              {fieldFarmOptions.map((farm) => (
                <option key={farm.id} value={farm.value}>
                  {farm.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="segmented" role="group" aria-label="Local do despejo">
          <button
            type="button"
            className={form.placementMode === "single_plot" ? "active" : ""}
            onClick={() => updatePlacementMode("single_plot")}
          >
            Na parcela
          </button>
          <button
            type="button"
            className={form.placementMode === "between_plots" ? "active" : ""}
            onClick={() => updatePlacementMode("between_plots")}
          >
            Entre parcelas
          </button>
        </div>

        <div className="form-grid">
          <label>
            <RequiredLabel>
              {form.placementMode === "between_plots" ? "Parcela principal" : "Parcela"}
            </RequiredLabel>
            <select
              value={form.plotPrimary}
              onChange={(event) => updatePlotPrimary(event.target.value)}
              required
            >
              <option value="">Selecione a parcela</option>
              {parcelOptions.map((parcel) => (
                <option key={parcel.value} value={parcel.value}>
                  {`${parcel.label} · ${parcel.hectares.toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })} ha`}
                </option>
              ))}
            </select>
          </label>

          {form.placementMode === "between_plots" ? (
            <label>
              <RequiredLabel>Parcela vizinha</RequiredLabel>
              <select
                value={form.plotSecondary}
                onChange={(event) => update("plotSecondary", event.target.value)}
                disabled={!form.plotPrimary || secondaryParcelOptions.length === 0}
                required
              >
                <option value="">
                  {form.plotPrimary ? "Selecione a vizinha" : "Escolha a principal primeiro"}
                </option>
                {secondaryParcelOptions.map((parcel) => (
                  <option key={parcel.value} value={parcel.value}>
                    {`${parcel.label} · ${parcel.hectares.toLocaleString("pt-BR", {
                      maximumFractionDigits: 1,
                    })} ha`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            <RequiredLabel>Data</RequiredLabel>
            <span className="input-icon">
              <CalendarClock aria-hidden="true" />
              <input
                type="date"
                value={form.depositDate}
                onChange={(event) => update("depositDate", event.target.value)}
                required
              />
            </span>
          </label>

          <label>
            <RequiredLabel>Hora</RequiredLabel>
            <input
              type="time"
              value={form.depositTime}
              onChange={(event) => update("depositTime", event.target.value)}
              required
            />
          </label>
        </div>

        <div className="location-strip">
          <button type="button" className="ghost-button" onClick={captureLocation}>
            <Crosshair aria-hidden="true" />
            {locationState === "loading" ? "Capturando" : "GPS do despejo"}
            <span className="required-marker" aria-hidden="true">*</span>
          </button>
          <div>
            <strong>
              {location.latitude && location.longitude
                ? `${location.latitude}, ${location.longitude}`
                : "Sem coordenada"}
            </strong>
            <span>
              {location.locationAccuracy
                ? `Precisao aproximada ${location.locationAccuracy} m`
                : locationState === "error"
                  ? locationMessage || "GPS indisponivel"
                  : "GPS do despejo obrigatorio"}
            </span>
          </div>
          <MapPinned aria-hidden="true" />
        </div>

        <div className={`photo-strip ${form.dumpPhotoDataUrl ? "ready" : ""}`}>
          <label>
            <span className="photo-label">
              <Camera aria-hidden="true" />
              <RequiredLabel>Foto do despejo</RequiredLabel>
            </span>
            <input
              key={photoInputKey}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => updateDumpPhoto(event.target.files?.[0] ?? null)}
              required={!form.dumpPhotoDataUrl}
            />
          </label>

          <div className="photo-status">
            {form.dumpPhotoDataUrl ? (
              <img src={form.dumpPhotoDataUrl} alt="Foto do despejo anexada" />
            ) : (
              <div className="photo-placeholder">
                <Camera aria-hidden="true" />
              </div>
            )}
            <div>
              <strong>
                {photoState === "loading"
                  ? "Processando foto"
                  : form.dumpPhotoName || "Foto obrigatoria"}
              </strong>
              <span>{photoMessage || "Use a camera do aparelho ou selecione uma imagem."}</span>
            </div>
          </div>
        </div>

        <label>
          Observacao
          <textarea
            value={form.notes}
            onChange={(event) => update("notes", event.target.value)}
            rows={3}
            placeholder="Anotacao de campo"
          />
        </label>

        <div className="form-actions">
          <span className={savedMessageIsError ? "form-message-error" : ""}>{savedMessage}</span>
          <button
            className={`primary-button ${canSave ? "" : "needs-required"}`}
            type="submit"
            disabled={photoState === "loading" || locationState === "loading"}
          >
            <Save aria-hidden="true" />
            Salvar registro
          </button>
        </div>
      </form>
    </section>
  );
}

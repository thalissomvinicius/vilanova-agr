export interface FleetVehicle {
  fleetNumber: string;
  description: string;
  operationalClass: string;
  plate: string;
}

export const subproductFleetVehicles: FleetVehicle[] = [
  {
    fleetNumber: "CM-02",
    description: "CAMINHÃO MERCEDEZ 3131",
    operationalClass: "CAMINHÕES SUB PRODUTO",
    plate: "RWL-9F61",
  },
  {
    fleetNumber: "CM-03",
    description: "CAMINHÃO MERCEDEZ 3131",
    operationalClass: "CAMINHÕES SUB PRODUTO",
    plate: "RWU-0F10",
  },
  {
    fleetNumber: "CM-04",
    description: "CAMINHÃO MERCEDEZ 3131",
    operationalClass: "CAMINHÕES SUB PRODUTO",
    plate: "RWR-9I58",
  },
];

function normalizeFleetPlate(value: string) {
  return value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function findFleetVehicleByPlate(plate: string) {
  const normalizedPlate = normalizeFleetPlate(plate);
  return subproductFleetVehicles.find((vehicle) => normalizeFleetPlate(vehicle.plate) === normalizedPlate) ?? null;
}

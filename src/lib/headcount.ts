import { supabase, supabaseConfigured } from "./supabase";

export interface HeadcountDriver {
  registration: string;
  name: string;
  cargo: string;
  department: string;
  status: "ATIVO" | "INATIVO";
  source: "supabase" | "demo";
}

export const demoHeadcountDrivers: HeadcountDriver[] = [
  { registration: "2985", name: "Marcos Vieira", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
  { registration: "1787", name: "Denis Silva", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
  { registration: "0341", name: "Claudio Martins", cargo: "MOTORISTA - N1", department: "GESTAO AGRICOLA", status: "ATIVO", source: "demo" },
  { registration: "0074", name: "Paulo Nascimento", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
  { registration: "2928", name: "Nelson Araujo", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
  { registration: "2988", name: "Sergio Batista", cargo: "MOTORISTA - N1", department: "GESTAO AGRICOLA", status: "ATIVO", source: "demo" },
  { registration: "2994", name: "Adriano Costa", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
  { registration: "2989", name: "Raimundo Lima", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
  { registration: "3010", name: "Jorge Ramos", cargo: "MOTORISTA - N1", department: "GESTAO AGRICOLA", status: "ATIVO", source: "demo" },
  { registration: "2064", name: "Elias Monteiro", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
  { registration: "2754", name: "Tiago Ferreira", cargo: "MOTORISTA - N1", department: "TRANSPORTE DE SUBPRODUTOS", status: "ATIVO", source: "demo" },
];

const driverCache = new Map<string, HeadcountDriver | null>();

export function normalizeRegistration(value: string) {
  return String(value || "").replace(/\D/g, "").trim();
}

export function findDemoDriverByRegistration(registration: string) {
  const normalized = normalizeRegistration(registration);
  return demoHeadcountDrivers.find((driver) => normalizeRegistration(driver.registration) === normalized) ?? null;
}

export async function findDriverByRegistration(registration: string): Promise<HeadcountDriver | null> {
  const normalized = normalizeRegistration(registration);

  if (!normalized) {
    return null;
  }

  if (driverCache.has(normalized)) {
    return driverCache.get(normalized) ?? null;
  }

  if (supabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("headcount_colaboradores")
        .select("matricula,nome,departamento,cargo,status")
        .eq("matricula", normalized)
        .eq("status", "ATIVO")
        .ilike("cargo", "%MOTORISTA%")
        .maybeSingle();

      if (!error && data?.matricula && data?.nome) {
        const driver: HeadcountDriver = {
          registration: normalizeRegistration(String(data.matricula)),
          name: String(data.nome),
          cargo: String(data.cargo || "MOTORISTA - N1"),
          department: String(data.departamento || ""),
          status: "ATIVO",
          source: "supabase",
        };
        driverCache.set(normalized, driver);
        return driver;
      }
    } catch {
      // Mantem o app funcional no campo mesmo quando o Supabase nao estiver disponivel.
    }
  }

  const fallbackDriver = findDemoDriverByRegistration(normalized);
  driverCache.set(normalized, fallbackDriver);
  return fallbackDriver;
}

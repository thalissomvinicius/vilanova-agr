import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const assetsDirectory = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const assets = await readdir(assetsDirectory);
const workerFiles = assets.filter((file) => /^maplibre-gl-worker-.*\.js$/.test(file));

if (workerFiles.length !== 1) {
  throw new Error(`Esperado um worker completo do MapLibre; encontrados: ${workerFiles.length}.`);
}

const workerPath = join(assetsDirectory, workerFiles[0]);
const [{ size }, source] = await Promise.all([stat(workerPath), readFile(workerPath, "utf8")]);

if (size < 100_000) {
  throw new Error(`Worker do MapLibre incompleto (${size} bytes).`);
}

if (source.includes("maplibre-gl-shared.mjs")) {
  throw new Error("Worker do MapLibre ainda depende de maplibre-gl-shared.mjs externo.");
}

console.log(`Worker do MapLibre validado: ${workerFiles[0]} (${size} bytes).`);

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  trustedRuntimePatchSchema,
  trustedRuntimeSeriesSchema,
  type TrustedRuntimePatch,
  type TrustedRuntimeSeries
} from "@/packages/site-contracts";
import { sha256 } from "@/packages/business-data";

export type RuntimeRegistry = {
  getSeries(id: string): Promise<TrustedRuntimeSeries | undefined>;
  getPatch(id: string): Promise<TrustedRuntimePatch | undefined>;
  savePatch(patch: TrustedRuntimePatch, bytes: Buffer): Promise<void>;
  saveSeries(series: TrustedRuntimeSeries): Promise<void>;
};

export async function createSiteRuntimePatch(input: {
  id: string;
  seriesId: string;
  version?: string;
  storageKey?: string;
  sourceRevision: string;
  builderVersion: string;
  securityStatus?: TrustedRuntimePatch["securityStatus"];
  compatibilityStatus?: TrustedRuntimePatch["compatibilityStatus"];
  bytes?: Buffer;
  createdAt?: string;
}) {
  const bytes = input.bytes ?? await buildSiteRuntimeBytes(input.seriesId);
  const contentHash = sha256(bytes);
  const seriesVersion = runtimeSeriesVersion(input.seriesId);
  const patch = trustedRuntimePatchSchema.parse({
    schemaVersion: 1,
    id: input.id,
    seriesId: input.seriesId,
    version: input.version ?? `${seriesVersion}.0.0+${contentHash.slice(7, 19)}`,
    contentHash,
    storageKey: input.storageKey ?? `trusted-runtime/site-v${seriesVersion}/${contentHash.slice(7)}.js`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    provenance: { sourceRevision: input.sourceRevision, builderVersion: input.builderVersion },
    securityStatus: input.securityStatus ?? "pending",
    compatibilityStatus: input.compatibilityStatus ?? "pending"
  });
  return { patch, bytes };
}

export async function buildSiteRuntimeBytes(seriesId: string) {
  const source = await readFile(join(process.cwd(), "packages", "trusted-runtime", "site-runtime-v1.js"), "utf8");
  if (seriesId === "site-runtime-v1") return Buffer.from(source);
  if (seriesId !== "site-runtime-v2" && seriesId !== "site-runtime-v3") {
    throw new Error(`Unknown trusted runtime source series ${seriesId}.`);
  }

  const resizeV1 = `  addEventListener("resize", () => {\n    if (activeNavigation?.behavior === "modal") positionNavigation(activeNavigation);\n  }, { passive: true });`;
  const resizeV2 = `  addEventListener("resize", () => {\n    if (!openNavigation) return;\n    if (!isNavigationRendered(openNavigation)) {\n      setNavigationOpen(openNavigation, false, false);\n      return;\n    }\n    if (activeNavigation?.behavior === "modal") positionNavigation(activeNavigation);\n  }, { passive: true });`;
  const galleryV1 = `\n  for (const button of document.querySelectorAll("[data-lodesta-gallery-direction]")) {\n    button.addEventListener("click", () => {\n      const galleryId = button.getAttribute("aria-controls");\n      const gallery = galleryId ? document.getElementById(galleryId) : null;\n      if (!gallery) return;\n      const direction = button.getAttribute("data-lodesta-gallery-direction") === "previous" ? -1 : 1;\n      gallery.scrollBy({ left: direction * Math.max(240, gallery.clientWidth * 0.8), behavior: "smooth" });\n    });\n  }\n`;
  const navigationVisibilityHelper = `\n  function isNavigationRendered(state) {\n    return state.toggle.getClientRects().length > 0\n      && state.target.getClientRects().length > 0\n      && getComputedStyle(state.toggle).visibility !== "hidden"\n      && getComputedStyle(state.target).visibility !== "hidden";\n  }\n`;
  if (!source.includes(resizeV1) || !source.includes(galleryV1)) {
    throw new Error("site-runtime-v2 transformation no longer matches the audited V1 source.");
  }
  const v2Source = source
    .replace(resizeV1, resizeV2)
    .replace(galleryV1, navigationVisibilityHelper);
  if (seriesId === "site-runtime-v2") return Buffer.from(v2Source);

  const presentationStart = "  let openNavigation = null;\n";
  const presentationEnd = "  for (const form of document.querySelectorAll(\"form[data-lodesta-form-id]\")) {\n";
  const startIndex = v2Source.indexOf(presentationStart);
  const endIndex = v2Source.indexOf(presentationEnd);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error("site-runtime-v3 transformation no longer matches the audited canonical source.");
  }
  return Buffer.from(`${v2Source.slice(0, startIndex)}${v2Source.slice(endIndex)}`);
}

function runtimeSeriesVersion(seriesId: string) {
  const match = /^site-runtime-v([1-9][0-9]*)$/.exec(seriesId);
  if (!match) throw new Error(`Trusted runtime series ID is not versioned: ${seriesId}.`);
  return Number(match[1]);
}

export async function promoteRuntimePatch(input: {
  registry: RuntimeRegistry;
  seriesId: string;
  patchId: string;
  actorId: string;
  now?: string;
}) {
  const patch = await input.registry.getPatch(input.patchId);
  if (!patch || patch.seriesId !== input.seriesId) throw new Error("Runtime patch does not belong to the requested series.");
  if (patch.securityStatus !== "audited" || patch.compatibilityStatus !== "passed") {
    throw new Error("Runtime patch must pass security and compatibility review before promotion.");
  }
  const current = await input.registry.getSeries(input.seriesId);
  const updated = trustedRuntimeSeriesSchema.parse({
    schemaVersion: 1,
    id: input.seriesId,
    name: current?.name ?? `Lodesta Site Runtime V${runtimeSeriesVersion(input.seriesId)}`,
    activePatchId: patch.id,
    previousPatchId: current?.activePatchId,
    updatedAt: input.now ?? new Date().toISOString(),
    updatedBy: input.actorId
  });
  await input.registry.saveSeries(updated);
  return updated;
}

export async function rollbackRuntimePatch(input: {
  registry: RuntimeRegistry;
  seriesId: string;
  actorId: string;
  now?: string;
}) {
  const current = await input.registry.getSeries(input.seriesId);
  if (!current?.previousPatchId) throw new Error("Runtime series has no previous patch to restore.");
  return promoteRuntimePatch({
    registry: input.registry,
    seriesId: input.seriesId,
    patchId: current.previousPatchId,
    actorId: input.actorId,
    now: input.now
  });
}

export function runtimeSeriesPath(seriesId: string) {
  return `/_lodesta/runtime/${encodeURIComponent(seriesId)}.js`;
}

export function runtimePatchPath(patch: TrustedRuntimePatch) {
  return `/_lodesta/runtime/patches/${patch.contentHash.slice("sha256:".length)}.js`;
}

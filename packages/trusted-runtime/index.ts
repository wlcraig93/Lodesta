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
  seriesId?: string;
  version?: string;
  storageKey?: string;
  sourceRevision: string;
  builderVersion: string;
  securityStatus?: TrustedRuntimePatch["securityStatus"];
  compatibilityStatus?: TrustedRuntimePatch["compatibilityStatus"];
  bytes?: Buffer;
  createdAt?: string;
}) {
  const bytes = input.bytes ?? await readFile(join(process.cwd(), "packages", "trusted-runtime", "site-runtime-v1.js"));
  const contentHash = sha256(bytes);
  const patch = trustedRuntimePatchSchema.parse({
    schemaVersion: 1,
    id: input.id,
    seriesId: input.seriesId ?? "site-runtime-v1",
    version: input.version ?? `1.0.0+${contentHash.slice(7, 19)}`,
    contentHash,
    storageKey: input.storageKey ?? `trusted-runtime/site-v1/${contentHash.slice(7)}.js`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    provenance: { sourceRevision: input.sourceRevision, builderVersion: input.builderVersion },
    securityStatus: input.securityStatus ?? "pending",
    compatibilityStatus: input.compatibilityStatus ?? "pending"
  });
  return { patch, bytes };
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
    name: current?.name ?? "Lodesta Site Runtime V1",
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

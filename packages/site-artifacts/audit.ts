import { sha256, stableJson } from "@/packages/business-data";
import {
  artifactBlobStores,
  normalizeBlobKey,
  type ArtifactBlobStoreName,
  type LocatedBlobInventoryObject
} from "./blob-store";

export type ArtifactBlobLocator = {
  store: ArtifactBlobStoreName;
  key: string;
};

export const managedArtifactBlobPrefixes: Record<ArtifactBlobStoreName, readonly string[]> = {
  artifact: ["site-assets/", "workspace-backups/", "workspace-sources/", "site-artifacts/", "site-captures/", "trusted-runtime/", "trace-payloads/"],
  workspace: ["workspace-backups/"]
};

export type ArtifactBlobOverlapV1 = {
  key: string;
  bytes: number;
  contentHash: `sha256:${string}`;
  source: ArtifactBlobLocator;
  destination: ArtifactBlobLocator;
};

export type ArtifactBlobAuditReportV2 = {
  schemaVersion: "artifact-blob-audit-v2";
  createdAt: string;
  reportHash: `sha256:${string}`;
  counts: {
    inventory: number;
    inventoryBytes: number;
    referenced: number;
    missingReferenced: number;
    orphanedManaged: number;
    orphanedManagedBytes: number;
    unknownPrefix: number;
    unknownPrefixBytes: number;
    rollbackOverlap: number;
    overlapMismatch: number;
  };
  inventoryObjects: LocatedBlobInventoryObject[];
  referencedObjects: ArtifactBlobLocator[];
  missingReferencedObjects: ArtifactBlobLocator[];
  orphanedManagedObjects: LocatedBlobInventoryObject[];
  unknownPrefixObjects: LocatedBlobInventoryObject[];
  rollbackOverlap: ArtifactBlobOverlapV1[];
  overlapMismatches: string[];
};

export function buildArtifactBlobAudit(input: {
  inventory: LocatedBlobInventoryObject[];
  referencedObjects: Iterable<ArtifactBlobLocator>;
  rollbackOverlap?: ArtifactBlobOverlapV1[];
  overlapMismatches?: string[];
  createdAt?: string;
}): ArtifactBlobAuditReportV2 {
  const inventoryObjects = canonicalInventory(input.inventory);
  const inventoryKeys = new Set(inventoryObjects.map(locatorId));
  const referencedObjects = canonicalLocators(input.referencedObjects);
  const referenced = new Set(referencedObjects.map(locatorId));
  const rollbackOverlap = canonicalOverlap(input.rollbackOverlap ?? []);
  for (const overlap of rollbackOverlap) {
    referenced.add(locatorId(overlap.source));
    referenced.add(locatorId(overlap.destination));
  }
  const missingReferencedObjects = referencedObjects.filter((object) => !inventoryKeys.has(locatorId(object)));
  for (const overlap of rollbackOverlap) {
    if (!inventoryKeys.has(locatorId(overlap.source))) missingReferencedObjects.push(overlap.source);
    if (!inventoryKeys.has(locatorId(overlap.destination))) missingReferencedObjects.push(overlap.destination);
  }
  const canonicalMissing = canonicalLocators(missingReferencedObjects);
  const orphanedManagedObjects = inventoryObjects.filter((object) => isManagedArtifactBlob(object) && !referenced.has(locatorId(object)));
  const unknownPrefixObjects = inventoryObjects.filter((object) => !isManagedArtifactBlob(object));
  const overlapMismatches = [...new Set(input.overlapMismatches ?? [])].sort();
  const counts = {
    inventory: inventoryObjects.length,
    inventoryBytes: sumBytes(inventoryObjects),
    referenced: referencedObjects.length,
    missingReferenced: canonicalMissing.length,
    orphanedManaged: orphanedManagedObjects.length,
    orphanedManagedBytes: sumBytes(orphanedManagedObjects),
    unknownPrefix: unknownPrefixObjects.length,
    unknownPrefixBytes: sumBytes(unknownPrefixObjects),
    rollbackOverlap: rollbackOverlap.length,
    overlapMismatch: overlapMismatches.length
  };
  const hashPayload = {
    schemaVersion: "artifact-blob-audit-v2",
    counts,
    inventoryObjects,
    referencedObjects,
    missingReferencedObjects: canonicalMissing,
    orphanedManagedObjects,
    unknownPrefixObjects,
    rollbackOverlap,
    overlapMismatches
  };
  return {
    schemaVersion: "artifact-blob-audit-v2",
    createdAt: input.createdAt ?? new Date().toISOString(),
    reportHash: sha256(stableJson(hashPayload)),
    counts,
    inventoryObjects,
    referencedObjects,
    missingReferencedObjects: canonicalMissing,
    orphanedManagedObjects,
    unknownPrefixObjects,
    rollbackOverlap,
    overlapMismatches
  };
}

export function parseArtifactBlobAuditReport(value: unknown): ArtifactBlobAuditReportV2 {
  if (!value || typeof value !== "object") throw new Error("Artifact blob audit report must be an object.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "artifact-blob-audit-v2" || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new Error("Artifact blob audit report has an invalid schema or timestamp.");
  }
  if (!Array.isArray(record.inventoryObjects) || !Array.isArray(record.referencedObjects) || !Array.isArray(record.rollbackOverlap) || !Array.isArray(record.overlapMismatches)) {
    throw new Error("Artifact blob audit report is missing its canonical inventory.");
  }
  const rebuilt = buildArtifactBlobAudit({
    inventory: record.inventoryObjects.map(parseInventoryObject),
    referencedObjects: record.referencedObjects.map(parseLocator),
    rollbackOverlap: record.rollbackOverlap.map(parseOverlap),
    overlapMismatches: record.overlapMismatches.map((message) => {
      if (typeof message !== "string" || !message) throw new Error("Artifact blob audit contains an invalid overlap mismatch.");
      return message;
    }),
    createdAt: record.createdAt
  });
  if (record.reportHash !== rebuilt.reportHash || stableJson(record) !== stableJson(rebuilt)) {
    throw new Error("Artifact blob audit report failed integrity verification.");
  }
  return rebuilt;
}

export function artifactBlobAuditConfirmation(report: Pick<ArtifactBlobAuditReportV2, "reportHash">) {
  return `delete-orphan-blobs:${report.reportHash}`;
}

export function assertArtifactBlobAuditDeletable(report: ArtifactBlobAuditReportV2) {
  if (report.missingReferencedObjects.length) {
    throw new Error(`Artifact blob audit is missing ${report.missingReferencedObjects.length} retained object(s); deletion is blocked.`);
  }
  if (report.overlapMismatches.length) {
    throw new Error(`Artifact blob audit found ${report.overlapMismatches.length} rollback-copy mismatch(es); deletion is blocked.`);
  }
}

export function isManagedArtifactBlob(value: ArtifactBlobLocator) {
  const locator = parseLocator(value);
  return managedArtifactBlobPrefixes[locator.store].some((prefix) => locator.key.startsWith(prefix));
}

export function workspaceSourceSidecarKey(sourceArchiveKey: string) {
  const match = normalizeBlobKey(sourceArchiveKey).match(/^workspace-backups\/([a-f0-9]{64})\.tar\.gz$/);
  if (!match) throw new Error(`Workspace archive key does not contain a canonical backup ID: ${sourceArchiveKey}.`);
  return `workspace-sources/${match[1]}.json`;
}

function canonicalInventory(values: LocatedBlobInventoryObject[]) {
  const objects = new Map<string, LocatedBlobInventoryObject>();
  for (const value of values) {
    const object = parseInventoryObject(value);
    const id = locatorId(object);
    if (objects.has(id)) throw new Error(`Artifact inventory contains duplicate location ${id}.`);
    objects.set(id, object);
  }
  return [...objects.values()].sort(compareLocator);
}

function canonicalLocators(values: Iterable<ArtifactBlobLocator>) {
  const objects = new Map<string, ArtifactBlobLocator>();
  for (const value of values) {
    const object = parseLocator(value);
    objects.set(locatorId(object), object);
  }
  return [...objects.values()].sort(compareLocator);
}

function canonicalOverlap(values: ArtifactBlobOverlapV1[]) {
  const result = values.map(parseOverlap).sort((left, right) => left.key.localeCompare(right.key));
  const keys = new Set<string>();
  for (const item of result) {
    if (keys.has(item.key)) throw new Error(`Artifact rollback overlap contains duplicate key ${item.key}.`);
    keys.add(item.key);
  }
  return result;
}

function parseLocator(value: unknown): ArtifactBlobLocator {
  if (!value || typeof value !== "object") throw new Error("Artifact blob locator must be an object.");
  const record = value as Record<string, unknown>;
  if (!artifactBlobStores.includes(record.store as ArtifactBlobStoreName) || typeof record.key !== "string") {
    throw new Error("Artifact blob locator has an invalid store or key.");
  }
  return { store: record.store as ArtifactBlobStoreName, key: normalizeBlobKey(record.key) };
}

function parseInventoryObject(value: unknown): LocatedBlobInventoryObject {
  const locator = parseLocator(value);
  const record = value as Record<string, unknown>;
  if (typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) || record.bytes < 0) {
    throw new Error("Artifact inventory object has an invalid byte count.");
  }
  if (record.etag !== undefined && typeof record.etag !== "string") throw new Error("Artifact inventory object has an invalid ETag.");
  if (record.uploadedAt !== undefined && (typeof record.uploadedAt !== "string" || !Number.isFinite(Date.parse(record.uploadedAt)))) {
    throw new Error("Artifact inventory object has an invalid upload timestamp.");
  }
  if (record.contentHash !== undefined && (typeof record.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.contentHash))) {
    throw new Error("Artifact inventory object has an invalid content hash.");
  }
  return {
    ...locator,
    bytes: record.bytes,
    etag: record.etag as string | undefined,
    uploadedAt: record.uploadedAt as string | undefined,
    contentHash: record.contentHash as `sha256:${string}` | undefined
  };
}

function parseOverlap(value: unknown): ArtifactBlobOverlapV1 {
  if (!value || typeof value !== "object") throw new Error("Artifact rollback overlap must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.key !== "string" || typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) || record.bytes < 0
    || typeof record.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.contentHash)) {
    throw new Error("Artifact rollback overlap has invalid content metadata.");
  }
  const key = normalizeBlobKey(record.key);
  const source = parseLocator(record.source);
  const destination = parseLocator(record.destination);
  if (source.key !== key || destination.key !== key || source.store === destination.store) {
    throw new Error("Artifact rollback overlap locations are invalid.");
  }
  return { key, bytes: record.bytes, contentHash: record.contentHash as `sha256:${string}`, source, destination };
}

function locatorId(value: ArtifactBlobLocator) {
  return `${value.store}:${value.key}`;
}

function compareLocator(left: ArtifactBlobLocator, right: ArtifactBlobLocator) {
  return left.store.localeCompare(right.store) || left.key.localeCompare(right.key);
}

function sumBytes(objects: LocatedBlobInventoryObject[]) {
  return objects.reduce((total, object) => total + object.bytes, 0);
}

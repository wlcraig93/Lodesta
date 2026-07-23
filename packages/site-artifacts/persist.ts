import type { SiteBuildArtifact } from "@/packages/site-contracts";
import { sha256 } from "@/packages/business-data";
import type { PreparedArtifactFile } from "@/packages/site-verification";
import type { ArtifactBlobStore } from "./blob-store";

export async function persistFinalArtifact(input: {
  artifact: SiteBuildArtifact;
  files: PreparedArtifactFile[];
  store: ArtifactBlobStore;
}) {
  if (input.artifact.qa.hardGate !== "passed") {
    throw new Error("A failed artifact cannot be persisted as a releasable build.");
  }
  const fileMap = new Map(input.files.map((file) => [file.path, file]));
  for (const record of input.artifact.files) {
    const file = fileMap.get(record.path);
    if (!file || sha256(file.bytes) !== record.contentHash || file.bytes.byteLength !== record.bytes) {
      throw new Error(`Artifact file ${record.path} does not match its immutable manifest.`);
    }
    await input.store.putImmutable({
      key: record.storageKey,
      bytes: file.bytes,
      contentType: record.contentType,
      contentHash: record.contentHash
    });
  }
}

export async function readVerifiedArtifactFile(input: {
  artifact: SiteBuildArtifact;
  path: string;
  store: ArtifactBlobStore;
}) {
  const normalized = input.path.replace(/^\/+/, "") || "index.html";
  const record = input.artifact.files.find((file) => file.path === normalized);
  if (!record) return undefined;
  const blob = await input.store.get(record.storageKey);
  if (!blob) throw new Error(`Retained artifact file ${record.storageKey} is missing.`);
  if (blob.contentHash !== record.contentHash || blob.bytes.byteLength !== record.bytes) {
    throw new Error(`Retained artifact file ${record.storageKey} failed manifest verification.`);
  }
  return blob;
}

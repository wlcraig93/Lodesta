import { mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";

const runId = process.env.LODESTA_EXPORT_RUN_ASSETS_RUN_ID?.trim();
const outputInput = process.env.LODESTA_EXPORT_RUN_ASSETS_OUTPUT_DIR?.trim();
if (!runId) throw new Error("LODESTA_EXPORT_RUN_ASSETS_RUN_ID is required.");
if (!outputInput) throw new Error("LODESTA_EXPORT_RUN_ASSETS_OUTPUT_DIR is required.");

const repositoryRoot = resolve(process.cwd());
const outputDirectory = resolve(repositoryRoot, outputInput);
const allowedRoot = resolve(repositoryRoot, ".design");
if (!outputDirectory.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("Retained asset exports must stay under .design/.");
}

const run = await sitePlatformRepository.getAgentRun(runId);
if (!run) throw new Error(`Unknown site-agent run ${runId}.`);
const buildInput = await sitePlatformRepository.getPublicBuildInput(run.publicBuildInputId);
if (!buildInput) throw new Error(`Run ${runId} has no retained public build input.`);

await mkdir(outputDirectory, { recursive: true });
const store = configuredArtifactBlobStore();
const exported = [];
for (const [index, asset] of buildInput.business.assets.entries()) {
  const blob = await store.get(asset.storageKey);
  if (!blob) throw new Error(`Retained asset blob is unavailable: ${asset.storageKey}`);
  const extension = asset.mimeType === "image/png" ? "png" : asset.mimeType === "image/webp" ? "webp" : "jpg";
  const filename = `${String(index + 1).padStart(2, "0")}-${asset.kind}-${asset.assetId}.${extension}`;
  await writeFile(resolve(outputDirectory, filename), blob.bytes);
  exported.push({
    filename,
    assetId: asset.assetId,
    revisionId: asset.revisionId,
    kind: asset.kind,
    alt: asset.alt,
    contentHash: asset.contentHash,
    bytes: blob.bytes.byteLength
  });
}

await writeFile(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify({ schemaVersion: 1, runId, publicBuildInputId: buildInput.id, assets: exported }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify({ ok: true, runId, outputDirectory, assets: exported })}\n`);

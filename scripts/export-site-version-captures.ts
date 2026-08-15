import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";

const versionId = process.env.LODESTA_SITE_VERSION_ID?.trim();
if (!versionId) throw new Error("LODESTA_SITE_VERSION_ID is required.");

const label = process.env.LODESTA_CAPTURE_EXPORT_LABEL?.trim()
  ?.replace(/[^a-zA-Z0-9._-]+/g, "-")
  || versionId;
const outputDirectory = join(
  process.cwd(),
  ".design",
  "pest-visual-quality-benchmark-2026-08-06",
  "screenshots",
  `${label}-retained`
);

const version = await sitePlatformRepository.getSiteVersion(versionId);
if (!version) throw new Error(`Site version not found: ${versionId}`);
const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
if (!artifact) throw new Error(`Build artifact not found: ${version.artifactId}`);
if (artifact.artifactHash !== version.artifactHash) {
  throw new Error(`Artifact hash mismatch for version ${version.id}.`);
}

await mkdir(outputDirectory, { recursive: true });
const store = configuredArtifactBlobStore();
const exported = [];
for (const key of artifact.qa.screenshotKeys) {
  const blob = await store.get(key);
  if (!blob) throw new Error(`Retained screenshot is missing: ${key}`);
  const file = join(outputDirectory, basename(key));
  await writeFile(file, blob.bytes, { flag: "wx" });
  exported.push({ key, file, bytes: blob.bytes.length, contentHash: blob.contentHash });
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  kind: "site-version-retained-capture-export",
  versionId: version.id,
  artifactId: artifact.id,
  outputDirectory,
  exported
}, null, 2)}\n`);

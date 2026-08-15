import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { sitePlatformRepository } from "../packages/platform-data";
import { evaluateArtifactVisualQuality } from "../packages/website-assessment/visual-quality-artifact";

const versionId = process.env.LODESTA_VISUAL_REVIEW_VERSION_ID?.trim();
const outputInput = process.env.LODESTA_VISUAL_REVIEW_OUTPUT?.trim();
if (!versionId || !outputInput) {
  throw new Error("LODESTA_VISUAL_REVIEW_VERSION_ID and LODESTA_VISUAL_REVIEW_OUTPUT are required.");
}

const root = resolve(process.cwd());
const allowedRoot = resolve(root, ".design");
const outputPath = resolve(root, outputInput);
if (!outputPath.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("The visual-review output must stay under .design/.");
}

const version = await sitePlatformRepository.getSiteVersion(versionId);
if (!version) throw new Error(`Unknown site version ${versionId}.`);
const [artifact, buildInput] = await Promise.all([
  sitePlatformRepository.getBuildArtifact(version.artifactId),
  sitePlatformRepository.getPublicBuildInput(version.publicBuildInputId)
]);
if (!artifact) throw new Error(`Missing retained build artifact ${version.artifactId}.`);
if (!buildInput) throw new Error(`Missing retained public build input ${version.publicBuildInputId}.`);

const review = await evaluateArtifactVisualQuality({
  artifact,
  buildInput,
  observedAt: new Date().toISOString()
});
const output = {
  schemaVersion: 1,
  kind: "retained-site-version-visual-quality-review",
  versionId: version.id,
  siteId: version.siteId,
  artifactId: artifact.id,
  review
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

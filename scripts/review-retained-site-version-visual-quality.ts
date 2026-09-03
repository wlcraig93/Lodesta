import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  LocalSitePlatformRepository,
  sitePlatformRepository
} from "../packages/platform-data";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import { evaluateArtifactVisualQuality } from "../packages/website-assessment/visual-quality-artifact";

const versionId = process.env.LODESTA_VISUAL_REVIEW_VERSION_ID?.trim();
const outputInput = process.env.LODESTA_VISUAL_REVIEW_OUTPUT?.trim();
const repositoryInput = process.env.LODESTA_VISUAL_REVIEW_REPOSITORY?.trim();
const blobInput = process.env.LODESTA_VISUAL_REVIEW_BLOBS?.trim();
if (!versionId || !outputInput) {
  throw new Error("LODESTA_VISUAL_REVIEW_VERSION_ID and LODESTA_VISUAL_REVIEW_OUTPUT are required.");
}

const root = resolve(process.cwd());
const allowedRoot = resolve(root, ".design");
const outputPath = resolve(root, outputInput);
if (!outputPath.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("The visual-review output must stay under .design/.");
}
const repositoryPath = repositoryInput ? resolve(root, repositoryInput) : undefined;
if (repositoryPath && !repositoryPath.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("A retained repository snapshot used for visual review must stay under .design/.");
}
const blobPath = blobInput ? resolve(root, blobInput) : undefined;
if (blobPath && !blobPath.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("A retained blob snapshot used for visual review must stay under .design/.");
}
const repository = repositoryPath
  ? new LocalSitePlatformRepository(repositoryPath)
  : sitePlatformRepository;

const version = await repository.getSiteVersion(versionId);
if (!version) throw new Error(`Unknown site version ${versionId}.`);
const [artifact, buildInput] = await Promise.all([
  repository.getBuildArtifact(version.artifactId),
  repository.getPublicBuildInput(version.publicBuildInputId)
]);
if (!artifact) throw new Error(`Missing retained build artifact ${version.artifactId}.`);
if (!buildInput) throw new Error(`Missing retained public build input ${version.publicBuildInputId}.`);

const review = await evaluateArtifactVisualQuality({
  artifact,
  buildInput,
  observedAt: new Date().toISOString(),
  store: blobPath ? new LocalArtifactBlobStore(blobPath) : undefined
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

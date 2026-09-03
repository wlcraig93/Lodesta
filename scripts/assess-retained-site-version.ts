import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  LocalSitePlatformRepository,
  sitePlatformRepository
} from "../packages/platform-data";
import { visualQualitySchema } from "../packages/website-assessment/contracts";
import { assessSiteArtifact } from "../packages/website-assessment/site-artifact-adapter";

const versionId = process.env.LODESTA_SITE_QUALITY_VERSION_ID?.trim();
const outputInput = process.env.LODESTA_SITE_QUALITY_OUTPUT?.trim();
const visualReviewInput = process.env.LODESTA_SITE_QUALITY_VISUAL_REVIEW?.trim();
const repositoryInput = process.env.LODESTA_SITE_QUALITY_REPOSITORY?.trim();
if (!versionId || !outputInput) {
  throw new Error("LODESTA_SITE_QUALITY_VERSION_ID and LODESTA_SITE_QUALITY_OUTPUT are required.");
}

const root = resolve(process.cwd());
const allowedRoot = resolve(root, ".design");
const outputPath = resolve(root, outputInput);
if (!outputPath.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("The canonical assessment output must stay under .design/.");
}
const repositoryPath = repositoryInput ? resolve(root, repositoryInput) : undefined;
if (repositoryPath && !repositoryPath.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("A retained repository snapshot used for assessment must stay under .design/.");
}
const repository = repositoryPath
  ? new LocalSitePlatformRepository(repositoryPath)
  : sitePlatformRepository;

const visualReviewPayload = visualReviewInput
  ? JSON.parse(await readFile(resolve(root, visualReviewInput), "utf8"))
  : undefined;
const visualQuality = visualReviewPayload
  ? visualQualitySchema.parse(visualReviewPayload.review ?? visualReviewPayload)
  : undefined;
const version = await repository.getSiteVersion(versionId);
if (!version) throw new Error(`Unknown site version ${versionId}.`);
const [artifact, buildInput] = await Promise.all([
  repository.getBuildArtifact(version.artifactId),
  repository.getPublicBuildInput(version.publicBuildInputId)
]);
if (!artifact) throw new Error(`Missing retained build artifact ${version.artifactId}.`);
if (!buildInput) throw new Error(`Missing retained public build input ${version.publicBuildInputId}.`);

const assessment = await assessSiteArtifact({
  artifact,
  buildInput,
  versionId: version.id,
  visualQuality
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(assessment, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  ok: true,
  assessmentId: assessment.id,
  artifactId: artifact.id,
  versionId: version.id,
  measuredWebsiteHealth: assessment.grade?.value,
  bandStatus: assessment.grade?.bandStatus,
  comparisonEligible: assessment.coverage.comparisonEligible,
  output: outputInput
})}\n`);

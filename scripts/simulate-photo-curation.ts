/**
 * Read-only photo-curation dry run for a retained site: computes the curated
 * gallery an initial build would start with and writes labeled contact sheets
 * to a local directory. Reads the repository and artifact store only; never
 * writes hosted data. The vision pass is metered and reported.
 *
 *   node --env-file=.env.local --import tsx scripts/simulate-photo-curation.ts <siteId> <outputDir> [--no-vision]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import type { AssetRevisionRef } from "@/packages/site-contracts";
import { createMediaContactSheet } from "@/packages/site-verification";
import { createOpenAiPhotoLabeler, curateSourcePhotos, sourcePhotoCurationPoolLimit } from "@/packages/site-platform/source-photo-curation";
import { SiteAuthoringWorkflow, sourcePhotoCurationCandidates, type SourcePhotoPoolItem } from "@/packages/site-platform/workflow";

const [siteId, outputDir] = process.argv.slice(2);
if (!siteId || !outputDir) throw new Error("usage: simulate-photo-curation <siteId> <outputDir> [--no-vision]");
const vision = !process.argv.includes("--no-vision");
const repository = sitePlatformRepository;
const blobStore = configuredArtifactBlobStore();
const workflow = new SiteAuthoringWorkflow(repository, blobStore);

const site = await repository.getSite(siteId);
if (!site?.currentPublicBuildInputId) throw new Error("site_or_input_missing");
const buildInput = await repository.getPublicBuildInput(site.currentPublicBuildInputId);
if (!buildInput) throw new Error("build_input_missing");
const snapshots = (await Promise.all(buildInput.sourceSnapshotIds.map((id) => repository.getSourceSnapshot(id))))
  .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));
const pages = (await Promise.all(snapshots.map((snapshot) => repository.listSourceSnapshotPages(snapshot.id)))).flat();
const startedAt = Date.now();
const pool = await Reflect.get(workflow, "selectSourcePhotoPool").call(
  workflow, snapshots, pages, sourcePhotoCurationPoolLimit
) as SourcePhotoPoolItem[];
const poolMs = Date.now() - startedAt;
const candidates = sourcePhotoCurationCandidates(pool);
const curationStartedAt = Date.now();
const result = await curateSourcePhotos({
  candidates,
  labeler: vision ? createOpenAiPhotoLabeler() : undefined,
  publicBuildInputId: buildInput.id,
  businessName: buildInput.business.name
});
const curationMs = Date.now() - curationStartedAt;

await mkdir(outputDir, { recursive: true });
const byId = new Map(candidates.map((candidate) => [candidate.resourceId, candidate]));
const sheetSize = 12;
const sheetPaths: string[] = [];
for (let index = 0; index < result.selected.length; index += sheetSize) {
  const chunk = result.selected.slice(index, index + sheetSize);
  const sheet = await createMediaContactSheet(chunk.map((photo, offset) => ({
    asset: {
      assetId: photo.candidate.resourceId, revisionId: "dry_run", kind: "photo", contentHash: photo.candidate.rawContentHash,
      storageKey: "dry-run", mimeType: "image/jpeg", alt: photo.alt, origin: "source_website", sourceFactIds: [],
      activeForFutureBuilds: true
    } as AssetRevisionRef,
    bytes: byId.get(photo.candidate.resourceId)!.bytes,
    cell: index + offset + 1,
    curation: { subject: photo.subject, quality: photo.quality, heroCapable: photo.heroCapable, alt: photo.alt }
  })), {
    neutralSemantics: true,
    sheet: { number: index / sheetSize + 1, count: Math.ceil(result.selected.length / sheetSize), total: result.selected.length, curated: true }
  });
  if (!sheet) continue;
  const path = join(outputDir, `curated-sheet-${index / sheetSize + 1}.webp`);
  await writeFile(path, sheet);
  sheetPaths.push(path);
}
// One review sheet of labeled photos that were not selected, with their labels.
const rejected = result.curation.labels.filter((label) => !result.curation.selected.some((photo) => photo.resourceId === label.resourceId));
for (let index = 0; index < rejected.length; index += sheetSize) {
  const chunk = rejected.slice(index, index + sheetSize);
  const sheet = await createMediaContactSheet(chunk.map((label, offset) => ({
    asset: {
      assetId: label.resourceId, revisionId: "dry_run", kind: "photo", contentHash: byId.get(label.resourceId)!.rawContentHash,
      storageKey: "dry-run", mimeType: "image/jpeg", alt: label.alt, origin: "source_website", sourceFactIds: [],
      activeForFutureBuilds: true
    } as AssetRevisionRef,
    bytes: byId.get(label.resourceId)!.bytes,
    cell: index + offset + 1,
    curation: {
      subject: label.subject,
      quality: `${label.quality}${label.stockLike ? " · stock-like" : ""}${label.overlay !== "none" ? ` · overlay ${label.overlay}` : ""}`,
      heroCapable: label.heroCapable,
      alt: label.alt
    }
  })), {
    neutralSemantics: true,
    sheet: { number: index / sheetSize + 1, count: Math.ceil(rejected.length / sheetSize), total: rejected.length, curated: false }
  });
  if (sheet) await writeFile(join(outputDir, `not-selected-sheet-${index / sheetSize + 1}.webp`), sheet);
}
const subjects: Record<string, number> = {};
for (const photo of result.selected) subjects[photo.subject] = (subjects[photo.subject] ?? 0) + 1;
const excluded: Record<string, number> = {};
for (const label of result.curation.labels) {
  if (result.curation.selected.some((photo) => photo.resourceId === label.resourceId)) continue;
  const reason = label.quality === "poor" ? "poor" : false ? "" : label.stockLike ? "stock_like_ranked_out"
    : label.overlay === "dominant" ? "overlay" : "ranked_out_or_small";
  excluded[reason] = (excluded[reason] ?? 0) + 1;
}
const summary = {
  siteId,
  business: buildInput.business.name,
  poolPhotos: pool.length,
  firstPartyCandidates: candidates.length,
  duplicates: result.curation.duplicates.length,
  flatArtwork: result.curation.flatArtwork.length,
  labeler: result.curation.labeler,
  fallbackReason: result.curation.fallbackReason,
  labeled: result.curation.labels.length,
  selected: result.selected.length,
  heroCapable: result.selected.filter((photo) => photo.heroCapable).length,
  subjects,
  excluded,
  usage: result.curation.usage,
  timing: { poolMs, curationMs },
  inputHash: result.curation.inputHash,
  sheets: sheetPaths,
  selection: result.selected.map((photo) => ({
    resourceId: photo.candidate.resourceId, subject: photo.subject, quality: photo.quality, heroCapable: photo.heroCapable,
    size: `${photo.candidate.width}x${photo.candidate.height}`, pageRole: photo.candidate.pageRole, alt: photo.alt
  }))
};
await writeFile(join(outputDir, "curation.json"), JSON.stringify({ summary, curation: result.curation }, null, 2));
console.log(JSON.stringify({ ...summary, selection: undefined }, null, 2));

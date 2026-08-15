import "./load-env";

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { sha256, stableJson } from "../packages/business-data";
import { sitePlatformRepository } from "../packages/platform-data";
import {
  canonicalSourceLogoAssetId,
  canonicalSourceLogoRevisionId,
  sourceLogoPreparedRevisionId
} from "../packages/site-platform/source-logo-materialization";

const sites = await sitePlatformRepository.listSites();
const activeSourceLogos: Array<{
  siteId: string;
  businessId: string;
  assetId: string;
  revisionId: string;
  expectedRevisionId?: string;
  prepared: boolean;
  dimensionsValid: boolean;
  referencedBuildInputIds: string[];
}> = [];

await mapConcurrent(sites, 12, async (site) => {
  const state = await sitePlatformRepository.getBusinessState(site.businessId);
  if (!state) throw new Error(`Site ${site.id} references missing business state ${site.businessId}.`);
  const versions = await sitePlatformRepository.listSiteVersions(site.id);
  const buildInputIds = [...new Set([
    ...(site.currentPublicBuildInputId ? [site.currentPublicBuildInputId] : []),
    ...versions.map((version) => version.publicBuildInputId)
  ])];
  const buildInputs = (await Promise.all(buildInputIds.map((id) => sitePlatformRepository.getPublicBuildInput(id))))
    .filter((input): input is NonNullable<typeof input> => Boolean(input));
  for (const asset of state.assets.filter((candidate) => candidate.kind === "logo" && candidate.origin === "source_website" && candidate.activeForFutureBuilds)) {
    const revision = await sitePlatformRepository.getAssetRevision(asset.revisionId);
    if (!revision || revision.provenance.origin !== "source_website") {
      throw new Error(`Active source logo ${asset.revisionId} is unavailable or has mismatched provenance.`);
    }
    const preparation = revision.provenance.preparation;
    const sourceResourceId = revision.provenance.sourceResourceId;
    const expectedRevisionId = preparation
      ? asset.assetId === canonicalSourceLogoAssetId(site.businessId)
        ? canonicalSourceLogoRevisionId({
            sourceSnapshotId: revision.provenance.sourceSnapshotId,
            sourceContentHash: preparation.sourceContentHash as `sha256:${string}`
          })
        : sourceResourceId
          ? sourceLogoPreparedRevisionId({
              sourceRevisionId: sourceResourceId,
              sourceContentHash: preparation.sourceContentHash as `sha256:${string}`
            })
          : undefined
      : undefined;
    activeSourceLogos.push({
      siteId: site.id,
      businessId: site.businessId,
      assetId: asset.assetId,
      revisionId: asset.revisionId,
      expectedRevisionId,
      prepared: Boolean(preparation),
      dimensionsValid: Boolean(revision.width && revision.height),
      referencedBuildInputIds: buildInputs
        .filter((input) => input.assetRevisionIds.includes(asset.revisionId))
        .map((input) => input.id)
        .sort()
    });
  }
});

const constructorSites = await findDirectAssetAndInputConstructors(process.cwd());
const requiresPreparation = activeSourceLogos.filter((logo) => !logo.prepared || !logo.dimensionsValid);
const legacyFormula = activeSourceLogos.filter((logo) => logo.expectedRevisionId && logo.expectedRevisionId !== logo.revisionId);
const reportBody = {
  schemaVersion: 1,
  siteCount: sites.length,
  activeSourceLogoCount: activeSourceLogos.length,
  activeSourceLogos,
  sourceLogosRequiringPreparation: requiresPreparation,
  adoptedSourceLogosUsingLegacyRevisionFormula: legacyFormula,
  retainedBuildInputIdsReferencingAffectedLogos: [...new Set(requiresPreparation.flatMap((logo) => logo.referencedBuildInputIds))].sort(),
  directAssetOrBuildInputConstructors: constructorSites
};
const report = {
  ...reportBody,
  generatedAt: new Date().toISOString(),
  reportHash: sha256(stableJson(reportBody))
};

const output = process.argv.includes("--summary")
  ? {
      schemaVersion: report.schemaVersion,
      generatedAt: report.generatedAt,
      reportHash: report.reportHash,
      siteCount: report.siteCount,
      activeSourceLogoCount: report.activeSourceLogoCount,
      sourceLogoCountRequiringPreparation: report.sourceLogosRequiringPreparation.length,
      legacyRevisionFormulaCount: report.adoptedSourceLogosUsingLegacyRevisionFormula.length,
      retainedBuildInputCountReferencingAffectedLogos: report.retainedBuildInputIdsReferencingAffectedLogos.length,
      directConstructorCount: report.directAssetOrBuildInputConstructors.length,
      directAssetOrBuildInputConstructors: report.directAssetOrBuildInputConstructors
    }
  : report;

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

async function findDirectAssetAndInputConstructors(root: string) {
  const files = await sourceFiles(root);
  const matches: Array<{ file: string; constructsBuildInput: boolean; clonesAssets: boolean }> = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const constructsBuildInput = /\bcreatePublicBuildInput\s*\(/.test(source);
    const clonesAssets = /\bcloneAssets\s*\(|assetRevisionSchema\.parse\s*\(\s*\{[\s\S]{0,600}\bretainedRevision\b/.test(source);
    if (constructsBuildInput || clonesAssets) {
      matches.push({ file: relative(root, file), constructsBuildInput, clonesAssets });
    }
  }
  return matches.sort((left, right) => left.file.localeCompare(right.file));
}

async function sourceFiles(root: string) {
  const output: string[] = [];
  const roots = [join(root, "app"), join(root, "lib"), join(root, "packages"), join(root, "scripts"), join(root, "workers")];
  for (const directory of roots) await visit(directory);
  return output;

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if ([".ts", ".tsx"].includes(extname(entry.name))) output.push(path);
    }
  }
}

async function mapConcurrent<Input>(values: Input[], concurrency: number, visit: (value: Input) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const value = values[index++];
      if (value !== undefined) await visit(value);
    }
  }));
}

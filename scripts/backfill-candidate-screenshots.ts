/**
 * Backfill durable QA screenshots for existing site candidates.
 *
 * Candidates generated before screenshot persistence landed have no
 * `generationQa.primaryScreenshot`, so admin queue thumbnails would need a
 * live renderer pass per card. This script renders each layout-v3 candidate
 * once with the same inspection path generation uses, stores the desktop
 * screenshot in asset storage, and writes the pointer back onto the
 * candidate bundle.
 *
 *   npm run backfill:candidate-screenshots            # only candidates without one
 *   npm run backfill:candidate-screenshots -- --force # re-capture all (e.g. after thumbnail format changes)
 *
 * Requires .env.local. No model calls; uses local Playwright rendering only.
 */
import "./load-env";
import { repository } from "../lib/repository";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import { summarizeRenderInspection } from "../lib/site-version-metadata";
import { persistPrimaryQaScreenshot } from "../lib/candidate-screenshot";

async function main() {
  const force = process.argv.includes("--force");
  const { candidates } = await repository.listSiteCandidates({ limit: 100 });
  let stored = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const versions = candidate.bundle.siteModel.versions;
    const version = versions.find((candidateVersion) => candidateVersion.status === "draft") ?? versions[0];
    if (!version || version.rendererVersion !== "layout-v3" || !version.generationQa) {
      skipped += 1;
      continue;
    }
    if (version.generationQa.primaryScreenshot && !force) {
      skipped += 1;
      continue;
    }

    try {
      const inspection = await inspectGeneratedSiteBundleRender({
        bundle: candidate.bundle,
        version,
        qaRunId: `screenshot_backfill_${candidate.id}`
      });
      const { artifactRefs } = summarizeRenderInspection(inspection);
      const screenshot = await persistPrimaryQaScreenshot({ candidateId: candidate.id, version, screenshots: artifactRefs });
      if (!screenshot) {
        failed += 1;
        console.warn(`no screenshot captured: ${candidate.id} (${candidate.businessName})`);
        continue;
      }
      const updated = await repository.updateSiteCandidateBundle(candidate.id, candidate.bundle);
      if (!updated) {
        failed += 1;
        console.warn(`candidate update failed: ${candidate.id}`);
        continue;
      }
      stored += 1;
      console.log(`stored ${screenshot.storagePath} (${candidate.businessName})`);
    } catch (error) {
      failed += 1;
      console.warn(`backfill failed for ${candidate.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`done: ${stored} stored, ${skipped} skipped, ${failed} failed (${candidates.length} candidates)`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

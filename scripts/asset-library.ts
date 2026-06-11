import "./load-env";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ASSET_LIBRARY_GENERATION_DEFAULT_LIMIT,
  backfillAssetLibraryTaxonomy,
  deriveApprovedAssetLibraryAsset,
  estimateAssetLibraryGeneration,
  generateAssetLibraryCandidates,
  getAssetLibraryAsset,
  listAssetLibraryAssets,
  readAssetLibraryManifest,
  retagApprovedAssetLibraryCloseupHeroes,
  selectAssetLibraryManifestPrompts,
  type AssetLibraryStatus,
  validateAssetLibraryManifest
} from "../lib/asset-library";
import type { Vertical } from "../lib/models";

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "validate":
      await validateCommand();
      return;
    case "estimate":
      await estimateCommand();
      return;
    case "generate":
      await generateCommand();
      return;
    case "review-sheet":
      await reviewSheetCommand();
      return;
    case "derive-approved":
      await deriveApprovedCommand();
      return;
    case "backfill-taxonomy":
      await backfillTaxonomyCommand();
      return;
    case "retag-closeup-heroes":
      await retagCloseupHeroesCommand();
      return;
    default:
      usage();
      process.exitCode = 1;
  }
}

async function validateCommand() {
  const manifestPath = requiredFlag("manifest");
  const manifest = await readManifestLoose(manifestPath);
  const result = validateAssetLibraryManifest(manifest);
  if (!result.ok) {
    process.stderr.write(`Invalid manifest ${manifestPath}\n${result.issues.map((issue) => `- ${issue}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        manifest: result.manifest.name,
        vertical: result.manifest.vertical,
        prompts: result.manifest.prompts.length
      },
      null,
      2
    )}\n`
  );
}

async function estimateCommand() {
  const manifest = await readAssetLibraryManifest(requiredFlag("manifest"));
  const candidates = numberFlag("candidates", 4);
  const selection = promptSelectionFromFlags();
  const estimate = estimateAssetLibraryGeneration({ manifest, candidates, ...selection });
  process.stdout.write(
    `${JSON.stringify(
      {
        manifest: manifest.name,
        vertical: manifest.vertical,
        model: manifest.defaultModel,
        size: manifest.defaultSize,
        quality: manifest.defaultQuality,
        ...estimate
      },
      null,
      2
    )}\n`
  );
}

async function generateCommand() {
  const manifest = await readAssetLibraryManifest(requiredFlag("manifest"));
  const candidates = numberFlag("candidates", 4);
  const selection = promptSelectionFromFlags();
  const explicitLimit = selection.limit;
  if (!explicitLimit) {
    throw new Error(`Generation requires explicit --limit. Use --limit ${ASSET_LIBRARY_GENERATION_DEFAULT_LIMIT} for a small pilot batch.`);
  }
  selectAssetLibraryManifestPrompts(manifest, selection);
  const result = await generateAssetLibraryCandidates({
    manifest,
    candidates,
    limit: explicitLimit,
    offset: selection.offset,
    promptIds: selection.promptIds,
    confirmCost: hasFlag("confirm-cost"),
    model: optionalFlag("model"),
    size: optionalFlag("size"),
    quality: optionalFlag("quality")
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        batchId: result.batch.id,
        generated: result.generated.length,
        estimate: result.estimate,
        assets: result.generated.map((asset) => ({
          id: asset.id,
          promptId: asset.promptId,
          status: asset.status,
          rawStoragePath: asset.rawStoragePath,
          qcOk: asset.qc.ok
        }))
      },
      null,
      2
    )}\n`
  );
}

async function reviewSheetCommand() {
  const batchId = requiredFlag("batch");
  const output = optionalFlag("output") ?? join(process.cwd(), ".data", "asset-library", "review-sheets", `${batchId}.html`);
  const baseUrl = (optionalFlag("base-url") ?? process.env.LODESTA_APP_ORIGIN ?? "http://127.0.0.1:4330").replace(/\/$/, "");
  const assets = await listAssetLibraryAssets({ batchId, limit: 500 });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderReviewSheet(batchId, assets, baseUrl), "utf8");
  process.stdout.write(`${JSON.stringify({ batchId, assets: assets.length, output, baseUrl }, null, 2)}\n`);
}

async function deriveApprovedCommand() {
  const assetId = requiredFlag("asset");
  const asset = await getAssetLibraryAsset(assetId);
  if (!asset) throw new Error(`Unknown asset ${assetId}.`);
  const derived = await deriveApprovedAssetLibraryAsset(assetId);
  process.stdout.write(
    `${JSON.stringify(
      {
        id: derived.id,
        status: derived.status,
        publicUrl: derived.publicUrl,
        approvedStoragePaths: derived.approvedStoragePaths
      },
      null,
      2
    )}\n`
  );
}

async function backfillTaxonomyCommand() {
  const manifest = await readAssetLibraryManifest(requiredFlag("manifest"));
  const status = optionalFlag("status") as AssetLibraryStatus | undefined;
  const result = await backfillAssetLibraryTaxonomy({
    manifest,
    status,
    dryRun: hasFlag("dry-run"),
    limit: optionalNumberFlag("limit")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function retagCloseupHeroesCommand() {
  if (!hasFlag("dry-run") && !hasFlag("confirm")) {
    throw new Error("Retagging approved close-up heroes requires --dry-run or --confirm.");
  }
  const result = await retagApprovedAssetLibraryCloseupHeroes({
    vertical: (optionalFlag("vertical") as Vertical | undefined) ?? "auto_services",
    dryRun: hasFlag("dry-run"),
    limit: optionalNumberFlag("limit"),
    minimumEnvironmentHeroes: optionalNumberFlag("minimum-environment-heroes")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function readManifestLoose(path: string) {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function renderReviewSheet(batchId: string, assets: Awaited<ReturnType<typeof listAssetLibraryAssets>>, baseUrl: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Asset Library Review ${escapeHtml(batchId)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f4ef; color: #181a1d; }
    main { padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 24px; }
    article { background: #fffefa; border: 1px solid #dedbd1; border-radius: 8px; padding: 12px; }
    img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; background: #ddd7cb; border-radius: 6px; }
    code { overflow-wrap: anywhere; }
    small, p { color: #62666b; }
  </style>
</head>
<body>
  <main>
    <h1>Asset Library Review</h1>
    <p>Batch <code>${escapeHtml(batchId)}</code> · ${assets.length} asset(s)</p>
    <section class="grid">
      ${assets
        .map(
          (asset) => `<article>
            <img src="${escapeHtml(baseUrl)}/api/admin/asset-library/${encodeURIComponent(asset.id)}/preview" alt="${escapeHtml(asset.promptMetadata.title)}" />
            <h2>${escapeHtml(asset.promptMetadata.title)}</h2>
            <p><code>${escapeHtml(asset.id)}</code></p>
            <small>${escapeHtml(asset.status)} · ${escapeHtml(asset.category)} · ${escapeHtml(asset.tags.join(", "))}</small>
          </article>`
        )
        .join("\n")}
    </section>
  </main>
</body>
</html>`;
}

function requiredFlag(name: string) {
  const value = optionalFlag(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function optionalFlag(name: string) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  return args[index + 1];
}

function numberFlag(name: string, fallback: number) {
  const value = optionalNumberFlag(name);
  return value ?? fallback;
}

function optionalNumberFlag(name: string) {
  const value = optionalFlag(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

function optionalNonNegativeNumberFlag(name: string) {
  const value = optionalFlag(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer.`);
  return parsed;
}

function promptSelectionFromFlags() {
  const offset = optionalNonNegativeNumberFlag("offset");
  const promptIds = optionalFlag("prompt-ids")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (offset !== undefined && promptIds?.length) throw new Error("--offset and --prompt-ids cannot be combined.");
  return {
    limit: optionalNumberFlag("limit"),
    offset,
    promptIds
  };
}

function hasFlag(name: string) {
  return args.includes(`--${name}`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function usage() {
  process.stdout.write(`Asset library CLI

Commands:
  validate --manifest asset-library/manifests/auto-services-wave-1-v1.json
  estimate --manifest asset-library/manifests/auto-services-wave-1-v1.json --candidates 4 --limit 12 [--offset 12 | --prompt-ids id_a,id_b]
  generate --manifest asset-library/manifests/auto-services-wave-1-v1.json --candidates 4 --limit 12 --confirm-cost [--offset 12 | --prompt-ids id_a,id_b]
  review-sheet --batch <batchId> [--output .data/asset-library/review-sheets/<batchId>.html]
  derive-approved --asset <assetId>
  backfill-taxonomy --manifest asset-library/manifests/tire-auto-v2.json --status approved [--dry-run]
  retag-closeup-heroes --vertical auto_services --dry-run [--minimum-environment-heroes 12]
  retag-closeup-heroes --vertical auto_services --confirm --minimum-environment-heroes 12
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

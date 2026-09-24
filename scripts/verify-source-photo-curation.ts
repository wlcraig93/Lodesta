import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { sha256 } from "../packages/business-data";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { canonicalAuthoringProfile, managerReferenceContext, siteAgentRunGuardrailsForKind } from "../packages/site-agent";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import {
  siteAgentAssetCurationSchema,
  siteAgentRunSchema,
  sourceSnapshotPageSchema,
  sourceSnapshotResourceSchema,
  sourceSnapshotSchema,
  type AssetRevision,
  type AssetRevisionRef,
  type SiteAgentAssetCuration,
  type SitePublicBuildInput
} from "../packages/site-contracts";
import {
  curateSourcePhotos,
  curationInputHash,
  dedupeCurationCandidates,
  selectCuratedPhotos,
  sourcePhotoCurationProducer,
  type PhotoCurationCandidate,
  type PhotoCurationLabel,
  type PhotoLabeler
} from "../packages/site-platform/source-photo-curation";
import { SiteAuthoringWorkflow } from "../packages/site-platform/workflow";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

// Deterministic, distinct pixels: dHash separates them; a resized copy of the
// same seed stays a near-duplicate.
async function noisePhoto(seed: number, width: number, height: number, format: "jpeg" | "png" = "jpeg") {
  const base = 48;
  const raw = Buffer.alloc(base * base * 3);
  let state = seed * 2_654_435_761 >>> 0;
  for (let index = 0; index < raw.length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) >>> 0;
    raw[index] = state >>> 24;
  }
  const image = sharp(raw, { raw: { width: base, height: base, channels: 3 } }).resize(width, height, { kernel: "nearest", fit: "fill" });
  return format === "png" ? image.png().toBuffer() : image.jpeg({ quality: 90 }).toBuffer();
}

const usage = (costUsd: number) => ({
  inputTokens: 1_000, cachedInputTokens: 0, reasoningTokens: 10, outputTokens: 200,
  costUsd, costSource: "catalog_estimate" as const, upstreamInferenceCostUsd: 0, durationMs: 5
});

function fakeLabeler(labels: Record<string, Partial<PhotoCurationLabel>>, calls: string[][] = []): PhotoLabeler {
  return {
    modelId: "gpt-6-luna",
    async label({ images }) {
      calls.push(images.map((image) => image.id));
      assert(images.every((image) => image.dataUrl.startsWith("data:image/jpeg;base64,")), "Label previews must be small JPEG data URLs.");
      return {
        labels: images.map((image) => ({
          id: image.id,
          subject: "finished_work",
          quality: "good",
          heroCapable: false,
          peoplePresent: false,
          overlay: "none",
          stockLike: false,
          alt: `Visible subject for ${image.id}.`,
          ...labels[image.id]
        })),
        usage: usage(0.001)
      };
    }
  };
}

async function candidate(id: string, options: Partial<PhotoCurationCandidate> & { seed: number }): Promise<PhotoCurationCandidate> {
  const width = options.width ?? 1_600;
  const height = options.height ?? 1_000;
  const bytes = options.bytes ?? await noisePhoto(options.seed, width, height);
  return {
    resourceId: id,
    sourceId: "source_fixture",
    sourcePageId: "page_fixture",
    sourcePageUrl: "https://pristine.example/",
    imageUrl: options.imageUrl ?? `https://pristine.example/media/${id}.jpg`,
    rawContentHash: sha256(bytes),
    pageRole: options.pageRole ?? "home",
    relevanceScore: options.relevanceScore ?? 100,
    width,
    height,
    bytes
  };
}

// 1. Dedupe: a resized copy of the same pixels collapses to the larger copy.
{
  const large = await candidate("resource_large", { seed: 1, width: 2_000, height: 1_300 });
  const small = await candidate("resource_small_copy", { seed: 1, width: 800, height: 520 });
  const other = await candidate("resource_other", { seed: 2 });
  const deduped = await dedupeCurationCandidates([small, other, large]);
  assert.deepEqual(deduped.unique.map((item) => item.resourceId), ["resource_other", "resource_large"],
    "Dedupe must keep the larger copy and preserve ranking order.");
  assert.deepEqual(deduped.duplicates, [{ resourceId: "resource_small_copy", duplicateOf: "resource_large" }]);
}

// 2. Selection: hero-capable first, diverse subjects, unusable labels dropped.
{
  const candidates = await Promise.all([
    candidate("work_1", { seed: 11 }), candidate("work_2", { seed: 12 }), candidate("work_3", { seed: 13 }),
    candidate("work_4", { seed: 14 }), candidate("work_5", { seed: 15 }),
    candidate("vehicle_1", { seed: 21, pageRole: "service" }), candidate("vehicle_2", { seed: 22, pageRole: "service" }),
    candidate("crew_1", { seed: 31, pageRole: "about", width: 900, height: 1_200 }),
    candidate("premises_1", { seed: 41, pageRole: "other" }),
    candidate("flyer", { seed: 51 }), candidate("blurry", { seed: 52 }), candidate("stocky", { seed: 53 }),
    candidate("watermarked", { seed: 54 }),
    candidate("stock_url", { seed: 55, imageUrl: "https://pristine.example/wp-content/uploads/shutterstock_1234.jpg" }),
    candidate("tiny", { seed: 56, width: 300, height: 200 })
  ]);
  const labels = new Map<string, PhotoCurationLabel>();
  const label = (id: string, value: Partial<PhotoCurationLabel>) => labels.set(id, {
    subject: "finished_work", quality: "good", heroCapable: false, peoplePresent: false, overlay: "none", stockLike: false,
    alt: `Alt ${id}`, ...value
  });
  for (const id of ["work_1", "work_2", "work_3", "work_4", "work_5"]) label(id, { quality: "excellent", heroCapable: true });
  label("vehicle_1", { subject: "vehicle", heroCapable: true });
  label("vehicle_2", { subject: "vehicle" });
  label("crew_1", { subject: "crew_people", peoplePresent: true, heroCapable: true });
  label("premises_1", { subject: "premises", quality: "fair" });
  label("flyer", { overlay: "dominant", quality: "excellent" });
  label("blurry", { quality: "poor" });
  label("stocky", { stockLike: true, quality: "excellent" });
  label("watermarked", { overlay: "dominant", quality: "excellent" });
  label("stock_url", { quality: "excellent" });
  label("tiny", { quality: "excellent" });
  const selected = selectCuratedPhotos({ candidates, labels, fallbackAlt: "Fallback", limit: 8 });
  const ids = selected.map((photo) => photo.candidate.resourceId);
  const everything = selectCuratedPhotos({ candidates, labels, fallbackAlt: "Fallback", limit: 40 }).map((photo) => photo.candidate.resourceId);
  assert(everything.includes("stocky"),
    "A polished first-party photo that merely looks stock-like is kept on its quality, not excluded for its look.");
  {
    const twin = new Map(labels);
    twin.set("stocky", { ...labels.get("stocky")!, stockLike: false });
    const withLook = selectCuratedPhotos({ candidates, labels, fallbackAlt: "Fallback", limit: 40 }).map((photo) => photo.candidate.resourceId);
    const withoutLook = selectCuratedPhotos({ candidates, labels: twin, fallbackAlt: "Fallback", limit: 40 }).map((photo) => photo.candidate.resourceId);
    assert.deepEqual(withLook, withoutLook, "A stock-like look changed a first-party photo's rank.");
  }
  for (const excluded of ["flyer", "blurry", "watermarked", "stock_url", "tiny"]) {
    assert(!everything.includes(excluded), `Curation admitted ${excluded}.`);
  }
  for (const excluded of ["flyer", "blurry", "watermarked", "stock_url", "tiny"]) {
    assert(!ids.includes(excluded), `Curation admitted ${excluded}.`);
  }
  assert.equal(selected.length, 8);
  assert.deepEqual(ids.slice(0, 2), ["work_1", "vehicle_1"],
    "Hero-capable photos must lead, alternating subjects.");
  assert(selected.slice(0, 2).every((photo) => photo.heroCapable));
  assert.equal(selected.find((photo) => photo.candidate.resourceId === "crew_1")?.heroCapable, false,
    "A portrait photo is never hero-capable, whatever the label says.");
  assert.deepEqual(new Set(selected.slice(0, 6).map((photo) => photo.subject)), new Set(["finished_work", "vehicle", "crew_people", "premises"]),
    "After the hero leads, one round-robin cycle must cover every usable subject.");
  assert.equal(selected.find((photo) => photo.candidate.resourceId === "vehicle_2")?.alt, "Alt vehicle_2");
}

// 3. Fallback, provenance and reuse through the whole curation step.
{
  const candidates = await Promise.all([
    candidate("photo_a", { seed: 61, width: 2_400, height: 1_600 }),
    candidate("photo_b", { seed: 62, width: 800, height: 1_000 }),
    candidate("photo_c", { seed: 63 }),
    candidate("photo_a_copy", { seed: 61, width: 1_200, height: 800 }),
    candidate("unsplash", { seed: 64, imageUrl: "https://images.unsplash.com/photo-1.jpg" }),
    candidate("line_art", {
      seed: 65,
      bytes: await sharp({ create: { width: 1_600, height: 1_000, channels: 3, background: "#000000" } })
        .composite([{ input: Buffer.from('<svg width="1600" height="1000"><path d="M200 700 Q800 200 1400 700" stroke="#888" stroke-width="6" fill="none"/></svg>'), left: 0, top: 0 }])
        .png().toBuffer()
    })
  ]);
  const failing: PhotoLabeler = {
    modelId: "gpt-6-luna",
    async label() {
      throw Object.assign(new Error("photo_labeling_incomplete"), { usage: usage(0.0005) });
    }
  };
  const fixedNow = () => new Date("2026-09-23T12:00:00.000Z");
  const fallback = await curateSourcePhotos({
    candidates, labeler: failing, publicBuildInputId: "input_fixture", businessName: "Pristine Detailing", now: fixedNow
  });
  assert.equal(fallback.curation.labeler, "ranking_fallback");
  assert.equal(fallback.curation.fallbackReason, "photo_labeling_incomplete");
  assert.equal(fallback.curation.usage.costUsd, 0.0005, "A failed vision call's spend must still be metered.");
  assert.deepEqual(fallback.selected.map((photo) => photo.candidate.resourceId), ["photo_a", "photo_c", "photo_b"],
    "Fallback selection must follow ranking (hero-sized first), dedupe copies and drop stock hosts.");
  assert(fallback.selected.every((photo) => photo.alt === "Photo from the Pristine Detailing website" && photo.subject === "unlabeled"));
  siteAgentAssetCurationSchema.parse(fallback.curation);

  const unavailable = await curateSourcePhotos({ candidates, publicBuildInputId: "input_fixture", businessName: "Pristine Detailing" });
  assert.equal(unavailable.curation.fallbackReason, "labeler_unavailable");

  const calls: string[][] = [];
  const labeled = await curateSourcePhotos({
    candidates,
    labeler: fakeLabeler({ photo_b: { subject: "crew_people", peoplePresent: true } }, calls),
    publicBuildInputId: "input_fixture",
    businessName: "Pristine Detailing",
    now: fixedNow
  });
  const curation: SiteAgentAssetCuration = siteAgentAssetCurationSchema.parse(labeled.curation);
  assert.equal(curation.producer, sourcePhotoCurationProducer);
  assert.equal(curation.modelId, "gpt-6-luna");
  assert.equal(curation.labeler, "vision");
  assert.equal(curation.generatedAt, "2026-09-23T12:00:00.000Z");
  assert.equal(curation.publicBuildInputId, "input_fixture");
  assert.equal(curation.candidateCount, 6);
  assert.deepEqual(curation.flatArtwork, ["line_art"], "Flat line art must be excluded from its pixels before labeling.");
  assert.deepEqual(curation.duplicates, [{ resourceId: "photo_a_copy", duplicateOf: "photo_a" }]);
  const deduped = await dedupeCurationCandidates(candidates);
  assert.equal(curation.inputHash, curationInputHash(deduped.unique, "gpt-6-luna"));
  assert.equal(curation.inputHash, fallback.curation.inputHash, "The input hash must depend on the inputs only.");
  assert.deepEqual(calls.flat().sort(), ["photo_a", "photo_b", "photo_c", "unsplash"].sort(),
    "Only deduplicated candidates are sent for labeling.");
  assert.equal(curation.usage.costUsd, 0.001);
  assert.deepEqual(curation.selected.map((photo) => photo.resourceId).sort(), ["photo_a", "photo_b", "photo_c"],
    "A stock-host URL is never curated even when the model labels it usable.");

  const replayCalls: string[][] = [];
  const replay = await curateSourcePhotos({
    candidates,
    labeler: fakeLabeler({}, replayCalls),
    publicBuildInputId: "input_fixture",
    businessName: "Pristine Detailing",
    retained: curation
  });
  assert.equal(replay.reused, true);
  assert.equal(replayCalls.length, 0, "A matching retained curation must not pay for a second vision pass.");
  assert.deepEqual(replay.curation, curation);
  assert.deepEqual(replay.selected.map((photo) => photo.candidate.resourceId), labeled.selected.map((photo) => photo.candidate.resourceId));
}

// 4. Workflow: only first-party, non-stock photos reach the labeler; curated
// photos become media through the same adoption path and checks.
const directory = await mkdtemp(join(tmpdir(), "lodesta-photo-curation-"));
try {
  const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
  const store = new LocalArtifactBlobStore(join(directory, "blobs"));
  const now = new Date().toISOString();
  const baseInput = buildSyntheticSiteInput();
  const snapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1, id: "source_curation_fixture", businessId: baseInput.businessId, sourceType: "website",
    sourceUrl: "https://pristine.example/", contentHash: sha256("curation-fixture"), capturedAt: now,
    payload: {
      schemaVersion: 1, kind: "website-mirror", sourceUrl: "https://pristine.example/", coverage: "complete",
      completionReason: "queue_exhausted", manifestHash: sha256("curation-manifest"),
      counts: {
        documentsDiscovered: 2, documentsEligible: 2, documentsFetched: 2, documentsExcluded: 0, documentsFailed: 0,
        documentsUnfinished: 0, resourcesDiscovered: 6, resourcesFetched: 6, resourcesExcluded: 0, resourcesFailed: 0,
        resourcesUnfinished: 0, browserRendered: 0, uniqueBlobs: 6, rawBytes: 1, storedBytes: 1
      },
      stages: {
        discoveryMs: 0, documentFetchMs: 0, dependencyFetchMs: 0, browserFallbackMs: 0, blobPersistenceMs: 0,
        pageIndexMs: 0, factExtractionMs: 0, finalizationMs: 0
      },
      startedAt: now, completedAt: now, elapsedMs: 0
    }
  });
  const page = (id: string, path: string) => sourceSnapshotPageSchema.parse({
    schemaVersion: 1, id, sourceSnapshotId: snapshot.id, resourceId: `resource_${id}`,
    requestedUrl: `https://pristine.example${path}`, finalUrl: `https://pristine.example${path}`, path, outcome: "fetched",
    indexability: "indexable", headings: [], wordCount: 3, internalLinks: [], externalLinks: [], linkProminence: 1,
    extractedText: `Page ${path}`, textContentHash: sha256(`Page ${path}`), producer: "fixture", inputHash: sha256("fixture"), createdAt: now
  });
  const homepage = page("page_home", "/");
  const gallery = page("page_gallery", "/gallery");
  const photos = [
    { id: "resource_home_hero", url: "https://pristine.example/media/home-hero.jpg", page: homepage, seed: 71, contentType: "image/jpeg" },
    { id: "resource_gallery_1", url: "https://pristine.example/media/gallery-1.jpg", page: gallery, seed: 72, contentType: "image/jpeg" },
    { id: "resource_gallery_2", url: "https://img1.wsimg.com/isteam/ip/abc/gallery-2.jpg", page: gallery, seed: 73, contentType: "image/jpeg" },
    { id: "resource_mislabeled", url: "https://pristine.example/media/mislabeled.png", page: gallery, seed: 74, contentType: "image/png" },
    { id: "resource_third_party", url: "https://cdn.vendor-widgets.example/review-badge-photo.jpg", page: homepage, seed: 75, contentType: "image/jpeg" },
    { id: "resource_stock", url: "https://pristine.example/wp-content/uploads/istockphoto-1234.jpg", page: gallery, seed: 76, contentType: "image/jpeg" }
  ];
  const resources = [];
  for (const photo of photos) {
    // The mislabeled resource declares PNG but stores JPEG bytes.
    const bytes = await noisePhoto(photo.seed, 1_800, 1_200);
    await store.putImmutable({ key: `fixture/${photo.id}`, bytes, contentType: photo.contentType, contentHash: sha256(bytes) });
    resources.push(sourceSnapshotResourceSchema.parse({
      schemaVersion: 1, id: photo.id, sourceSnapshotId: snapshot.id, captureKind: "http_response", role: "image",
      requestedUrl: photo.url, finalUrl: photo.url, outcome: "fetched", status: 200, contentType: photo.contentType,
      storedEncoding: "identity", rawContentHash: sha256(bytes), blobContentHash: sha256(bytes),
      storageKey: `fixture/${photo.id}`, rawBytes: bytes.length, storedBytes: bytes.length,
      headers: {}, redirectChain: [], initiatorUrls: [photo.page.requestedUrl], capturedAt: now, metadata: {}
    }));
  }
  for (const document of [homepage, gallery]) {
    resources.push(sourceSnapshotResourceSchema.parse({
      schemaVersion: 1, id: document.resourceId, sourceSnapshotId: snapshot.id, captureKind: "http_response", role: "document",
      requestedUrl: document.requestedUrl, finalUrl: document.requestedUrl, outcome: "fetched", status: 200, contentType: "text/html",
      storedEncoding: "identity", rawContentHash: sha256(document.extractedText), blobContentHash: sha256(document.extractedText),
      storageKey: `fixture/${document.id}`, rawBytes: 10, storedBytes: 10,
      headers: {}, redirectChain: [], initiatorUrls: [], capturedAt: now, metadata: {}
    }));
  }
  await repository.saveSourceSnapshot(snapshot);
  await repository.saveSourceSnapshotResources(resources);
  await repository.saveSourceSnapshotPages([homepage, gallery]);
  const run = siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run", id: "run_photo_curation", sessionId: "session_photo_curation", siteId: baseInput.siteId,
    publicBuildInputId: baseInput.id, request: { kind: "initial_build", sourceUrl: "https://pristine.example/" },
    origin: "owner_request", requestedBy: "owner_fixture", kind: "initial_build", status: "running", stage: "authoring",
    executionNumber: 1, apiProvider: "openai", modelId: "gpt-6-sol", skillVersions: {},
    guardrails: siteAgentRunGuardrailsForKind("initial_build", now),
    usage: { inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, costUsd: 0.25, costSource: "catalog_estimate", upstreamInferenceCostUsd: 0, durationMs: 0 },
    startedAt: now
  });
  await repository.saveAgentRun(run);
  const calls: string[][] = [];
  const workflow = new SiteAuthoringWorkflow(repository, store, undefined, undefined, undefined, undefined,
    () => fakeLabeler({ resource_home_hero: { heroCapable: true, quality: "excellent", alt: "Polished black sedan in a driveway." } }, calls));
  const pool = await Reflect.get(workflow, "selectSourcePhotoPool").call(workflow, [snapshot], [homepage, gallery], 60) as Array<{ candidate: { resource: { id: string } } }>;
  assert(pool.some((item) => item.candidate.resource.id === "resource_third_party"),
    "Fixture must put the third-party image in the author's inventory pool.");
  const curated = await Reflect.get(workflow, "curateInitialPhotos").call(workflow, {
    run, pool, businessName: "Pristine Detailing", publicBuildInputId: baseInput.id
  }) as { run: typeof run; selected: SiteAgentAssetCuration["selected"] };
  assert.deepEqual(calls.flat().sort(), ["resource_gallery_1", "resource_gallery_2", "resource_home_hero", "resource_mislabeled"],
    "Third-party and stock-path images must never be sent for curation.");
  assert.equal(curated.selected[0]?.resourceId, "resource_home_hero");
  assert.equal(curated.selected[0]?.heroCapable, true);
  const persisted = await repository.getAgentRun(run.id);
  assert(persisted?.assetCuration, "The curation intermediate must be retained on the run.");
  assert.equal(persisted.assetCuration.producer, sourcePhotoCurationProducer);
  assert.equal(persisted.assetCuration.labeler, "vision");
  assert.match(persisted.assetCuration.inputHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(persisted.usage.costUsd, 0.25 + 0.001, "Curation spend must be added to the run's metered cost.");
  const events = await repository.listAgentRunEvents(run.id);
  assert(events.some((event) => event.name === "responses.create.photo_curation" && event.status === "succeeded"
    && event.modelId === "gpt-6-luna" && event.costUsd === 0.001));

  const buildInput = { ...baseInput, businessId: baseInput.businessId } as SitePublicBuildInput;
  const adopted: Array<{ ref: AssetRevisionRef; revision?: AssetRevision }> = [];
  const failures: string[] = [];
  for (const photo of curated.selected) {
    try {
      adopted.push(await Reflect.get(workflow, "materializeSourcePhoto").call(workflow, {
        snapshot, sourceId: photo.sourceId, resourceId: photo.resourceId, sourcePageId: photo.sourcePageId,
        kind: "photo", alt: photo.alt, buildInput
      }));
    } catch (error) {
      failures.push(`${photo.resourceId}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.deepEqual(failures, ["resource_mislabeled:source_photo_mime_mismatch"],
    "Curated photos must pass the same MIME/decoding checks as adopt_source_asset.");
  assert.equal(adopted.length, 3);
  for (const { ref, revision } of adopted) {
    assert(revision, "A new curated photo must produce a provisional revision.");
    assert.equal(revision.origin, "source_website");
    assert.equal(revision.provenance.origin, "source_website");
    assert(revision.provenance.origin === "source_website" && revision.provenance.preparation?.recipe === "source-photo-web",
      "Curated photos must be prepared with the source-photo web recipe.");
    assert.equal(ref.kind, "photo");
    assert.equal(ref.mimeType, "image/webp");
    assert(ref.storageKey.startsWith(`site-assets/${baseInput.businessId}/source/`), "Curated media must be a business-scoped copy.");
    assert(await store.get(ref.storageKey), "The prepared derivative must be stored before it is offered.");
  }
  assert.equal(adopted[0]!.ref.alt, "Polished black sedan in a driveway.");

  // A curated photo already active in the business library is reused, not re-adopted.
  const withActive = { ...buildInput, business: { ...buildInput.business, assets: [...buildInput.business.assets, adopted[0]!.ref] } };
  const reused = await Reflect.get(workflow, "materializeSourcePhoto").call(workflow, {
    snapshot, sourceId: curated.selected[0]!.sourceId, resourceId: curated.selected[0]!.resourceId,
    sourcePageId: curated.selected[0]!.sourcePageId, kind: "photo", alt: "Different alt", buildInput: withActive
  }) as { ref: AssetRevisionRef; revision?: AssetRevision };
  assert.equal(reused.revision, undefined);
  assert.deepEqual(reused.ref, adopted[0]!.ref);

  // The curated gallery reaches the author as labeled asset evidence.
  const evidence = await Reflect.get(workflow, "createOperatorAssetEvidence").call(workflow,
    { ...withActive, business: { ...withActive.business, assets: [...buildInput.business.assets, ...adopted.map((entry) => entry.ref)] } },
    40,
    {
      provisionalRevisions: adopted.map((entry) => entry.revision!),
      curated: new Map(adopted.map((entry, index) => [entry.ref.assetId, curated.selected.filter((photo) => photo.resourceId !== "resource_mislabeled")[index]!]))
    }) as Array<{ assetId: string; alt: string; curation?: { heroCapable: boolean }; sheet?: number; cell?: number }>;
  const curatedEvidence = evidence.filter((reference) => reference.curation);
  assert.equal(curatedEvidence.length, 3, "Every curated photo must appear on the author's asset sheets.");
  assert.equal(curatedEvidence[0]!.alt, "Polished black sedan in a driveway.");
  assert.equal(curatedEvidence[0]!.curation!.heroCapable, true);
  assert(curatedEvidence.every((reference) => reference.sheet === 1 && typeof reference.cell === "number"));
} finally {
  await rm(directory, { recursive: true, force: true });
}

// 5. The author receives every curated sheet, the labels and the remainder notice.
{
  const reference = (index: number, sheet: number) => ({
    assetId: `asset_curated_${index}`, revisionId: `asset_revision_curated_${index}`, kind: "photo" as const,
    origin: "source_website" as const, alt: `Visible subject ${index}.`,
    curation: { subject: "vehicle", quality: "excellent", heroCapable: index === 1 },
    sheet, cell: index, mimeType: "image/webp" as const,
    contentHash: sha256(`curated-sheet-${sheet}`), dataUrl: `data:image/webp;base64,c2hlZXQt${sheet}`
  });
  const context = managerReferenceContext({
    ...canonicalAuthoringProfile("initial_build"),
    assetEvidenceReferences: [reference(1, 1), reference(2, 1), reference(13, 2)],
    sourceEvidenceReferences: [{
      resourceId: "resource_remaining", sourceId: "source_fixture", sourcePageId: "page_fixture",
      sourcePageUrl: "https://pristine.example/", sheet: 1, cell: 1, mimeType: "image/webp",
      contentHash: sha256("remaining-sheet"), dataUrl: "data:image/webp;base64,cmVtYWluaW5n"
    }]
  });
  const images = context.filter((block) => block.type === "input_image").map((block) => (block as { image_url: string }).image_url);
  assert.deepEqual(images, ["data:image/webp;base64,cmVtYWluaW5n", "data:image/webp;base64,c2hlZXQt1", "data:image/webp;base64,c2hlZXQt2"],
    "Every distinct curated asset sheet must reach the author once.");
  const texts = context.filter((block) => block.type === "input_text").map((block) => JSON.parse((block as { text: string }).text));
  const sourceText = texts.find((value) => value.kind === "retained-first-party-visual-evidence");
  const assetText = texts.find((value) => value.kind === "canonical-retained-asset-visual-evidence");
  assert.match(sourceText.instruction, /not in the curated gallery/);
  assert.match(assetText.instruction, /curated gallery/);
  assert.deepEqual(assetText.references[0].curation, { subject: "vehicle", quality: "excellent", heroCapable: true });
  assert.equal(assetText.references[2].sheet, 2);
  assert.equal(assetText.sheets.length, 2);
}

console.log(JSON.stringify({
  ok: true,
  dedupe: "pass",
  selectionDiversity: "pass",
  fallback: "pass",
  provenanceAndReuse: "pass",
  firstPartyOnly: "pass",
  sharedAdoptionChecks: "pass",
  curatedEvidence: "pass",
  authorContext: "pass"
}));

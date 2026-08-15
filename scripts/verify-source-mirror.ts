import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWebsiteSourceMirror,
  crawlWebsiteForGeneration,
  decodeRetainedSourceResource,
  websiteMirrorManifestHash
} from "../packages/business-data";
import { LocalSitePlatformRepository } from "../packages/platform-data";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import { replaySourcePage, replaySourceResource } from "../packages/site-platform/source-replay";
import {
  sourceSnapshotPageSchema,
  sourceSnapshotResourceSchema,
  sourceSnapshotSchema
} from "../packages/site-contracts";

const temporaryRoot = await mkdtemp(join(tmpdir(), "lodesta-source-mirror-"));
try {
  const origin = "https://mirror.example";
  let stylesheetAttempts = 0;
  const crawl = await crawlWebsiteForGeneration({
    url: `${origin}/`,
    validateUrl: async (value) => value,
    sleep: async () => undefined,
    random: () => 0,
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return response("User-agent: *\nAllow: /", "text/plain");
      if (path === "/sitemap.xml") return response(`<?xml version="1.0"?><urlset><url><loc>${origin}/</loc></url></urlset>`, "application/xml");
      if (path === "/") return response(`<!doctype html><html><head><title>Mirror Pest Control</title><link rel="stylesheet" href="/styles.css"></head><body><h1>Careful pest protection</h1><img src="/hero.png" alt="Technician"><img src="https://uncaptured.example/tracker.gif" alt=""><a href="https://uncaptured.example/">External</a><script src="/app.js"></script></body></html>`, "text/html");
      if (path === "/styles.css") {
        stylesheetAttempts += 1;
        if (stylesheetAttempts === 1) return response("temporarily unavailable", "text/plain", 503);
        return response("@font-face{src:url('/font.woff2')} body{background-image:url('/hero.png')}", "text/css");
      }
      if (path === "/hero.png") return new Response(Buffer.from([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
      if (path === "/font.woff2") return new Response(Buffer.from("font"), { status: 200, headers: { "content-type": "font/woff2" } });
      if (path === "/app.js") return response("fetch('/should-never-run')", "text/javascript");
      return response("missing", "text/plain", 404);
    }
  });
  const capturedAt = "2026-08-01T00:00:00.000Z";
  const manifestHash = websiteMirrorManifestHash({ ingestion: crawl.ingestion, captures: crawl.captures });
  assert.equal(manifestHash, websiteMirrorManifestHash({
    ingestion: crawl.ingestion,
    captures: crawl.captures.map((capture) => ({ ...capture, headers: { ...capture.headers, date: "Sat, 02 Aug 2026 00:00:00 GMT", etag: '"changed-transport-validator"' } }))
  }), "Volatile transport headers changed the source-content identity.");
  const mirror = buildWebsiteSourceMirror({
    sourceSnapshotId: "source_snapshot_mirror_test",
    sourceUrl: `${origin}/`,
    ingestion: crawl.ingestion,
    captures: crawl.captures,
    documents: crawl.documents,
    capturedAt,
    timings: crawl.timings
  });
  const repeatedMirror = buildWebsiteSourceMirror({
    sourceSnapshotId: "source_snapshot_mirror_test",
    sourceUrl: `${origin}/`,
    ingestion: crawl.ingestion,
    captures: crawl.captures,
    documents: crawl.documents,
    capturedAt: "2026-08-02T00:00:00.000Z",
    timings: crawl.timings
  });
  assert.deepEqual(
    mirror.resources.filter((entry) => entry.bytes).map((entry) => [entry.resource.storageKey, entry.resource.blobContentHash, entry.bytes?.toString("base64")]),
    repeatedMirror.resources.filter((entry) => entry.bytes).map((entry) => [entry.resource.storageKey, entry.resource.blobContentHash, entry.bytes?.toString("base64")]),
    "Content-addressed source compression was not deterministic."
  );
  assert.equal(mirror.pages.length, 1);
  assert(mirror.resources.some(({ resource }) => resource.role === "stylesheet"));
  assert(mirror.resources.some(({ resource }) => resource.role === "image"));
  assert(mirror.resources.some(({ resource }) => resource.role === "font"));
  const snapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "source_snapshot_mirror_test",
    businessId: "business_mirror_test",
    sourceType: "website",
    sourceUrl: `${origin}/`,
    contentHash: mirror.payload.manifestHash,
    capturedAt,
    payload: mirror.payload
  });
  const repository = new LocalSitePlatformRepository(join(temporaryRoot, "repository.json"));
  const blobStore = new LocalArtifactBlobStore(join(temporaryRoot, "blobs"));
  for (const retained of mirror.resources) {
    if (!retained.bytes || !retained.resource.storageKey || !retained.resource.blobContentHash) continue;
    await blobStore.putImmutable({
      key: retained.resource.storageKey,
      bytes: retained.bytes,
      contentType: retained.resource.storedEncoding === "gzip" ? "application/gzip" : retained.resource.contentType ?? "application/octet-stream",
      contentHash: retained.resource.blobContentHash as `sha256:${string}`
    });
  }
  await repository.saveWebsiteSourceSnapshot({
    snapshot,
    resources: mirror.resources.map(({ resource }) => resource),
    pages: mirror.pages
  });
  const page = mirror.pages[0]!;
  const documentResource = await repository.getSourceSnapshotResource(page.resourceId);
  assert(documentResource?.storageKey);
  const documentBlob = await blobStore.get(documentResource.storageKey);
  assert(documentBlob);
  assert.match(decodeRetainedSourceResource(documentResource, documentBlob.bytes).toString("utf8"), /Careful pest protection/);
  const matches = await repository.searchSourceSnapshotPages({ query: "pest protection", sourceIds: [snapshot.id], maxResults: 10 });
  assert.equal(matches[0]?.pageId, page.id);
  const replayRoot = "http://localhost:3000/api/admin/source-snapshots";
  const replay = await replaySourcePage({ sourceSnapshotId: snapshot.id, path: "/", replayRoot, repository, blobStore });
  assert(replay);
  assert.match(replay.body.toString("utf8"), /source_snapshot_mirror_test\/resources\/source_resource_/);
  assert.doesNotMatch(replay.body.toString("utf8"), /should-never-run/);
  assert.doesNotMatch(replay.body.toString("utf8"), /https:\/\/uncaptured\.example/);
  const stylesheet = mirror.resources.find(({ resource }) => resource.role === "stylesheet")?.resource;
  assert(stylesheet);
  assert.equal(stylesheet.metadata.retryCount, 1);
  assert.equal(stylesheet.metadata.retryWaitMs, 1_000);
  assert.equal(stylesheet.metadata.throttleEvents, 1);
  const replayedStylesheet = await replaySourceResource({ sourceSnapshotId: snapshot.id, resourceId: stylesheet.id, replayRoot, repository, blobStore });
  assert(replayedStylesheet);
  assert.match(replayedStylesheet.body.toString("utf8"), /source_snapshot_mirror_test\/resources\/source_resource_/);

  const sharedSnapshot = sourceSnapshotSchema.parse({
    ...snapshot,
    id: "source_snapshot_mirror_shared_test",
    businessId: "business_mirror_shared_test"
  });
  await repository.saveWebsiteSourceSnapshotReference({
    snapshot: sharedSnapshot,
    retainedSourceSnapshotId: snapshot.id
  });
  const [sharedResources, sharedPages, sharedMatches] = await Promise.all([
    repository.listSourceSnapshotResources(sharedSnapshot.id),
    repository.listSourceSnapshotPages(sharedSnapshot.id),
    repository.searchSourceSnapshotPages({ query: "pest protection", sourceIds: [sharedSnapshot.id], maxResults: 10 })
  ]);
  assert.equal(sharedResources.length, mirror.resources.length);
  assert.equal(sharedPages.length, mirror.pages.length);
  assert(sharedResources.every((resource) => resource.sourceSnapshotId === sharedSnapshot.id));
  assert(sharedPages.every((sourcePage) => sourcePage.sourceSnapshotId === sharedSnapshot.id));
  assert.equal(sharedMatches[0]?.sourceId, sharedSnapshot.id);
  assert.equal(await repository.resolveRetainedSourceSnapshotId(sharedSnapshot.id), snapshot.id);
  assert.equal((await repository.getSourceSnapshotResource(sharedResources[0]!.id, sharedSnapshot.id))?.sourceSnapshotId, sharedSnapshot.id);
  const sharedReplay = await replaySourcePage({ sourceSnapshotId: sharedSnapshot.id, path: "/", replayRoot, repository, blobStore });
  assert(sharedReplay);
  assert.match(sharedReplay.body.toString("utf8"), /source_snapshot_mirror_shared_test\/resources\/source_resource_/);
  const retainedState = JSON.parse(await readFile(join(temporaryRoot, "repository.json"), "utf8")) as {
    sourceSnapshotResources: Record<string, unknown>;
    sourceSnapshotPages: Record<string, unknown>;
    sourceMirrorReferences: Record<string, string>;
  };
  assert.equal(Object.keys(retainedState.sourceSnapshotResources).length, mirror.resources.length, "A shared source authority duplicated retained resource rows.");
  assert.equal(Object.keys(retainedState.sourceSnapshotPages).length, mirror.pages.length, "A shared source authority duplicated retained page rows.");
  assert.equal(retainedState.sourceMirrorReferences[sharedSnapshot.id], snapshot.id);
  await assert.rejects(
    repository.saveSourceSnapshotPages([{ ...mirror.pages[0]!, sourceSnapshotId: sharedSnapshot.id }]),
    /source_snapshot_reference_cannot_own_mirror_rows/
  );

  const deduplicatedSnapshot = sourceSnapshotSchema.parse({
    ...snapshot,
    id: "source_snapshot_mirror_deduplicated_test",
    businessId: "business_mirror_deduplicated_test"
  });
  await repository.saveWebsiteSourceSnapshot({
    snapshot: deduplicatedSnapshot,
    resources: mirror.resources.map(({ resource }) => sourceSnapshotResourceSchema.parse({
      ...resource,
      id: `${resource.id}_duplicate`,
      sourceSnapshotId: deduplicatedSnapshot.id
    })),
    pages: mirror.pages.map((sourcePage) => sourceSnapshotPageSchema.parse({
      ...sourcePage,
      id: `${sourcePage.id}_duplicate`,
      sourceSnapshotId: deduplicatedSnapshot.id,
      resourceId: `${sourcePage.resourceId}_duplicate`,
      renderedResourceId: sourcePage.renderedResourceId ? `${sourcePage.renderedResourceId}_duplicate` : undefined,
      exactDuplicateOf: sourcePage.exactDuplicateOf ? `${sourcePage.exactDuplicateOf}_duplicate` : undefined
    }))
  });
  assert.equal(await repository.resolveRetainedSourceSnapshotId(deduplicatedSnapshot.id), snapshot.id, "Exact crawl results did not reuse the canonical retained mirror.");
  const deduplicatedState = JSON.parse(await readFile(join(temporaryRoot, "repository.json"), "utf8")) as {
    sourceSnapshotResources: Record<string, unknown>;
    sourceSnapshotPages: Record<string, unknown>;
  };
  assert.equal(Object.keys(deduplicatedState.sourceSnapshotResources).length, mirror.resources.length);
  assert.equal(Object.keys(deduplicatedState.sourceSnapshotPages).length, mirror.pages.length);

  const scaleSnapshotId = "source_snapshot_surge_scale";
  const resourceTemplate = mirror.resources[0]!.resource;
  const pageTemplate = mirror.pages[0]!;
  const scaleResources = Array.from({ length: 2_448 }, (_, index) => sourceSnapshotResourceSchema.parse({
    ...resourceTemplate,
    id: `source_resource_scale_${String(index).padStart(4, "0")}`,
    sourceSnapshotId: scaleSnapshotId,
    requestedUrl: `${origin}/scale/resource-${index}`,
    finalUrl: `${origin}/scale/resource-${index}`
  }));
  const scalePages = Array.from({ length: 190 }, (_, index) => sourceSnapshotPageSchema.parse({
    ...pageTemplate,
    id: `source_page_scale_${String(index).padStart(3, "0")}`,
    sourceSnapshotId: scaleSnapshotId,
    resourceId: scaleResources[index]!.id,
    renderedResourceId: undefined,
    requestedUrl: `${origin}/scale/page-${index}/`,
    finalUrl: `${origin}/scale/page-${index}/`,
    path: `/scale/page-${index}/`,
    canonical: `${origin}/scale/page-${index}/`,
    exactDuplicateOf: undefined
  }));
  const scaleSnapshot = sourceSnapshotSchema.parse({
    ...snapshot,
    id: scaleSnapshotId,
    contentHash: `sha256:${"e".repeat(64)}`,
    payload: {
      ...snapshot.payload,
      manifestHash: `sha256:${"e".repeat(64)}`,
      counts: {
        ...(snapshot.payload as { counts: Record<string, number> }).counts,
        documentsDiscovered: scalePages.length,
        documentsEligible: scalePages.length,
        documentsFetched: scalePages.length,
        resourcesDiscovered: scaleResources.length,
        resourcesFetched: scaleResources.length
      }
    }
  });
  await repository.saveWebsiteSourceSnapshot({ snapshot: scaleSnapshot, resources: scaleResources, pages: scalePages });
  await repository.saveWebsiteSourceSnapshot({ snapshot: scaleSnapshot, resources: scaleResources, pages: scalePages });
  assert.equal((await repository.listSourceSnapshotResources(scaleSnapshot.id)).length, 2_448);
  assert.equal((await repository.listSourceSnapshotPages(scaleSnapshot.id)).length, 190);
  assert.equal((await repository.getSourceSnapshot(scaleSnapshot.id))?.id, scaleSnapshot.id);

  process.stdout.write(JSON.stringify({ ok: true, pages: mirror.pages.length, resources: mirror.resources.length, scalePages: scalePages.length, scaleResources: scaleResources.length, replay: "pass", search: "pass" }) + "\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function response(body: string, contentType: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

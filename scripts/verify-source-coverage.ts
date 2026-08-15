import assert from "node:assert/strict";
import { deriveCandidateSourceCoverage, validateCandidateSourceDispositions } from "../packages/site-platform/source-coverage";
import { siteBuildArtifactSchema, sourceSnapshotPageSchema, sourceSnapshotSchema } from "../packages/site-contracts";

const createdAt = "2026-07-31T00:00:00.000Z";
const sourceUrl = "https://source.example/";
const pages = [
  page("home", "/"),
  page("service", "/service"),
  page("old", "/old-service"),
  page("duplicate", "/duplicate", { canonical: `${sourceUrl}service` }),
  page("retired", "/retired"),
  page("missing", "/unaccounted"),
  page("mixed", "/Old-Service.HTML")
];
const snapshot = sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: "source_snapshot_coverage",
  businessId: "business_coverage",
  sourceType: "website",
  sourceUrl,
  contentHash: hash("a"),
  capturedAt: createdAt,
  payload: {
    schemaVersion: 1,
    kind: "website-mirror",
    sourceUrl,
    coverage: "complete",
    completionReason: "queue_exhausted",
    manifestHash: hash("f"),
    counts: { documentsDiscovered: 7, documentsEligible: 7, documentsFetched: 7, documentsExcluded: 0, documentsFailed: 0, documentsUnfinished: 0, resourcesDiscovered: 0, resourcesFetched: 0, resourcesExcluded: 0, resourcesFailed: 0, resourcesUnfinished: 0, browserRendered: 0, uniqueBlobs: 7, rawBytes: 700, storedBytes: 350 },
    stages: { discoveryMs: 1, documentFetchMs: 1, dependencyFetchMs: 1, browserFallbackMs: 0, blobPersistenceMs: 1, pageIndexMs: 1, factExtractionMs: 1, finalizationMs: 1 },
    startedAt: createdAt,
    completedAt: createdAt,
    elapsedMs: 1
  }
});
const artifact = siteBuildArtifactSchema.parse({
  schemaVersion: 1,
  id: "artifact_coverage",
  siteId: "site_coverage",
  workspaceRevisionId: "workspace_coverage",
  publicBuildInputId: "input_coverage",
  ownerOperationalRevision: 1,
  ownerIntentRevision: 1,
  createdAt,
  artifactHash: hash("b"),
  storagePrefix: "artifacts/coverage",
  files: [{ path: "index.html", contentType: "text/html", contentHash: hash("c"), bytes: 10, storageKey: "artifacts/coverage/index.html" }],
  routes: [
    { path: "/", htmlFile: "index.html", title: "Home", description: "Home" },
    { path: "/service", htmlFile: "index.html", title: "Service", description: "Service" },
    { path: "/new-route", htmlFile: "index.html", title: "New", description: "New" }
  ],
  factBindings: [],
  capabilityBindings: [],
  runtimeSeriesId: "runtime_series",
  runtimePatchAtFinalization: "runtime_patch",
  toolchainVersion: "toolchain",
  sandboxImageDigest: hash("d"),
  qa: { hardGate: "passed", checkedAt: createdAt, routesChecked: 3, linksChecked: 2, findings: [], screenshotKeys: [] }
});

const result = deriveCandidateSourceCoverage({
  siteId: artifact.siteId,
  versionId: "version_coverage",
  artifact,
  snapshots: [snapshot],
  pages,
  redirects: [
    { sourcePath: "/old-service", destinationPath: "/service", reason: "Consolidated into the current service page." },
    { sourcePath: "/Old-Service.HTML", destinationPath: "/service", reason: "Preserved a legacy mixed-case URL." }
  ],
  retiredSourcePaths: [{ sourcePath: "/retired", reason: "Obsolete promotion." }],
  generatedAt: createdAt
});
assert(result.report);
assert.deepEqual(result.report.counts, {
  sourcePages: 7,
  preserved: 2,
  redirected: 2,
  canonicalDuplicates: 1,
  retired: 1,
  unaccounted: 1,
  newRoutes: 1
});
assert.deepEqual(result.report.newRoutes, ["/new-route"]);
assert.equal(result.redirects.length, 2);
assert.equal(result.report.entries.find((entry) => entry.sourcePath === "/Old-Service.HTML")?.disposition, "redirected");
assert.equal(result.report.entries.find((entry) => entry.sourcePath === "/duplicate")?.disposition, "canonical_duplicate");
assert.equal(result.report.entries.find((entry) => entry.sourcePath === "/unaccounted")?.disposition, "unaccounted");

assert.throws(() => deriveCandidateSourceCoverage({
  siteId: artifact.siteId,
  versionId: "version_chain",
  artifact,
  snapshots: [snapshot],
  pages,
  redirects: [
    { sourcePath: "/old-service", destinationPath: "/retired" },
    { sourcePath: "/retired", destinationPath: "/service" }
  ],
  retiredSourcePaths: []
}), /destination_missing|chain_or_cycle/);
assert.throws(() => deriveCandidateSourceCoverage({
  siteId: artifact.siteId,
  versionId: "version_collision",
  artifact,
  snapshots: [snapshot],
  pages,
  redirects: [{ sourcePath: "/service", destinationPath: "/" }],
  retiredSourcePaths: []
}), /source_is_live_route/);
assert.throws(() => deriveCandidateSourceCoverage({
  siteId: artifact.siteId,
  versionId: "version_missing",
  artifact,
  snapshots: [snapshot],
  pages,
  redirects: [{ sourcePath: "/old-service", destinationPath: "/missing-destination" }],
  retiredSourcePaths: []
}), /destination_missing/);
assert.throws(() => deriveCandidateSourceCoverage({
  siteId: artifact.siteId,
  versionId: "version_query_source",
  artifact,
  snapshots: [snapshot],
  pages,
  redirects: [{ sourcePath: "/?p=8024", destinationPath: "/service" }],
  retiredSourcePaths: []
}), /plain internal paths/);
assert.throws(() => deriveCandidateSourceCoverage({
  siteId: artifact.siteId,
  versionId: "version_retired_live_route",
  artifact,
  snapshots: [snapshot],
  pages,
  redirects: [],
  retiredSourcePaths: [{ sourcePath: "/service", reason: "Invalid fixture." }]
}), /retirement_source_is_live_route/);
assert.doesNotThrow(() => validateCandidateSourceDispositions({
  redirects: [],
  retiredSourcePaths: [{
    sourcePath: "/ph1Pest%20Control%20Raleigh%20NC%20|%20Eco-Friendly%20&",
    reason: "Malformed crawl path retained as migration evidence."
  }]
}));

console.log(JSON.stringify({ ok: true, counts: result.report.counts, redirectValidation: "pass" }));

function page(id: string, path: string, extra: Record<string, unknown> = {}) {
  return sourceSnapshotPageSchema.parse({
    schemaVersion: 1,
    id: `source_page_${id}`,
    sourceSnapshotId: "source_snapshot_coverage",
    resourceId: `source_resource_${id}`,
    requestedUrl: `${sourceUrl}${path === "/" ? "" : path.slice(1)}`,
    finalUrl: `${sourceUrl}${path === "/" ? "" : path.slice(1)}`,
    path,
    status: 200,
    outcome: "fetched",
    contentType: "text/html",
    indexability: "indexable",
    title: id,
    headings: [id],
    wordCount: 100,
    internalLinks: [],
    externalLinks: [],
    linkProminence: 1,
    extractedText: `${id} retained source content`,
    textContentHash: hash("e"),
    producer: "test",
    inputHash: hash("e"),
    createdAt,
    ...extra
  });
}

function hash(character: string) {
  return `sha256:${character.repeat(64)}`;
}

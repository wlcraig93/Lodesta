import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  authoringContextCharacters,
  createSourceWorkspace,
  createSiteAuthoringContext,
  managerBuildContext,
  taskSkillFor,
  websiteManagerAuthoringSystemPrompt
} from "../packages/site-agent";
import { sourceSnapshotPageSchema, sourceSnapshotSchema } from "../packages/site-contracts";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const buildInput = buildSyntheticSiteInput();
const largeBody = `KindPest protects homes with careful local pest control. ${"service detail ".repeat(80_000)}`;
const snapshots = [
  sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "source_kindpest_home",
    businessId: buildInput.businessId,
    sourceType: "website",
    sourceUrl: "https://kindpest.example/",
    contentHash: `sha256:${"a".repeat(64)}`,
    capturedAt: "2026-07-30T12:00:00.000Z",
    payload: { status: "available", title: "KindPest", body: largeBody }
  }),
  sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "source_kindpest_missing",
    businessId: buildInput.businessId,
    sourceType: "website",
    sourceUrl: "https://kindpest.example/missing",
    contentHash: `sha256:${"b".repeat(64)}`,
    capturedAt: "2026-07-30T12:00:00.000Z",
    payload: { status: "retrieval_failed", error: "timeout" }
  })
];
const context = createSiteAuthoringContext({ buildInput, snapshots });
assert.equal(context.provisionalSources.length, 2);
assert(context.provisionalSources[0]!.meaningfulExcerpt.length <= 2_400);
assert.equal(context.provisionalSources[1]!.availability, "unavailable");
assert.equal(context.provisionalSources[0]!.untrusted, true);
assert(authoringContextCharacters(context) < 25_000);
assert(!JSON.stringify(context).includes("service detail ".repeat(1_000)));

const scalePages = Array.from({ length: 260 }, (_, index) => {
  const id = `source_page_${String(index).padStart(3, "0")}`;
  const path = index === 0
    ? "/"
    : index === 230
      ? "/author/editor/"
      : index === 231
        ? "/category/pest-tips/"
    : index === 232
          ? "/blog/page/2/"
          : index === 233
            ? "/privacy-policy/"
            : index === 234
              ? "/terms-of-service/"
              : index === 235
                ? "/test/"
                : index === 236
                  ? "/llms-txt/"
          : `/services/service-${String(index).padStart(3, "0")}`;
  const url = `https://kindpest.example${path}`;
  const wordCount = index < 20 ? 50 : index < 100 ? 250 : 700;
  const rawContentHash = `sha256:${(index < 240 ? index : index - 240).toString(16).padStart(64, "0")}`;
  return sourceSnapshotPageSchema.parse({
    schemaVersion: 1,
    id,
    sourceSnapshotId: "source_kindpest_scale",
    resourceId: `source_resource_${String(index).padStart(3, "0")}`,
    requestedUrl: url,
    finalUrl: url,
    path,
    status: 200,
    outcome: "fetched" as const,
    contentType: "text/html",
    canonical: url,
    indexability: index < 250 ? "indexable" as const : "noindex" as const,
    sitemap: { url: "https://kindpest.example/sitemap.xml" },
    title: index === 0 ? "KindPest" : `Service ${index}`,
    headings: [index === 0 ? "KindPest" : `Service ${index}`],
    wordCount,
    internalLinks: ["https://kindpest.example/"],
    externalLinks: [],
    rawContentHash,
    exactDuplicateOf: index >= 240 ? `source_page_${String(index - 240).padStart(3, "0")}` : undefined,
    templateSignature: `sha256:${"c".repeat(64)}`,
    linkProminence: index === 0 ? 260 : 1,
    extractedText: index === 0
      ? "KindPest protects homes throughout the Triangle."
      : index === 1
        ? "This retained service page contains a complete customer answer."
        : "",
    textContentHash: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
    producer: "test",
    inputHash: rawContentHash,
    createdAt: "2026-07-30T12:00:00.000Z"
  });
});
const scaleSnapshot = sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: "source_kindpest_scale",
  businessId: buildInput.businessId,
  sourceType: "website",
  sourceUrl: "https://kindpest.example/",
  contentHash: `sha256:${"d".repeat(64)}`,
  capturedAt: "2026-07-30T12:00:00.000Z",
  payload: {
    schemaVersion: 1,
    kind: "website-mirror",
    sourceUrl: "https://kindpest.example/",
    coverage: "complete",
    completionReason: "queue_exhausted",
    counts: {
      documentsDiscovered: 260,
      documentsEligible: 260,
      documentsFetched: 260,
      documentsExcluded: 0,
      documentsFailed: 0,
      documentsUnfinished: 0,
      resourcesDiscovered: 0,
      resourcesFetched: 0,
      resourcesExcluded: 0,
      resourcesFailed: 0,
      resourcesUnfinished: 0,
      browserRendered: 0,
      uniqueBlobs: 240,
      rawBytes: 2_600_000,
      storedBytes: 650_000
    },
    manifestHash: `sha256:${"3".repeat(64)}`,
    stages: { discoveryMs: 1, documentFetchMs: 1, dependencyFetchMs: 1, browserFallbackMs: 0, blobPersistenceMs: 1, pageIndexMs: 1, factExtractionMs: 1, finalizationMs: 1 },
    startedAt: "2026-07-30T12:00:00.000Z",
    completedAt: "2026-07-30T12:01:00.000Z",
    elapsedMs: 60_000
  }
});
const scaleContext = createSiteAuthoringContext({ buildInput, snapshots: [scaleSnapshot], pages: scalePages });
const sourceWorkspace = createSourceWorkspace({
  snapshots: [scaleSnapshot],
  pages: scalePages
});
const scalePromptContext = managerBuildContext({
  authoringContext: scaleContext,
  instruction: "Build the complete website.",
  kind: "initial_build",
  sourceWorkspace: sourceWorkspace.summary
});
assert.equal(scaleContext.provisionalSources[0]?.websiteInventory?.pages.length, 260);
assert.equal(scaleContext.provisionalSources[0]?.websiteInventory?.pathTree.length, 260);
assert.equal(sourceWorkspace.summary.pageCount, 260);
assert.equal(sourceWorkspace.summary.contentPageCount, 2);
assert.equal(sourceWorkspace.summary.readOnly, true);
assert(sourceWorkspace.summary.manifestPaths.every((path) => path.startsWith(`source-site/${scaleSnapshot.id}/manifest-`)));
assert(sourceWorkspace.files.some((file) => file.path.endsWith(`${scalePages[0]!.id}.md`) && file.content.includes("KindPest protects homes")));
assert.deepEqual(scalePromptContext.workspace.sourceWorkspace, sourceWorkspace.summary);
assert.match(scalePromptContext.task.sourceInventorySummary, /complete crawl; 260 manifest pages; 260 eligible; 260 fetched; 250 unique fetched indexable paths/);
assert.match(scalePromptContext.task.sourceInventorySummary, /240 distinct fetched indexable content bodies after 10 duplicate bodies/);
assert.match(scalePromptContext.task.sourceInventorySummary, /Content-estate signal: 233 likely customer-content paths after separating 3 obvious mechanical archive paths, 2 technical or site-builder paths, and 2 source-sensitive legal paths/);
assert.match(scalePromptContext.task.sourceInventorySummary, /Legal paths are different: preserve their exact paths and substantive provisions without summarizing/);
assert.match(scalePromptContext.task.sourceInventorySummary, /133 of those content paths have at least 500 words; 0 have at least 1000 words; together they contain 114100 words and 233 distinct content bodies/);
assert.match(scalePromptContext.task.sourceInventorySummary, /existing authorized first-party content assets are not hypothetical generated keyword pages/);
assert.match(scalePromptContext.task.sourceInventorySummary, /20 exact-duplicate references; largest route prefixes: \/services\/ \(252\), \/ \(1\), \/author\/ \(1\), \/blog\/ \(1\), \/category\/ \(1\), \/llms-txt\/ \(1\), \/privacy-policy\/ \(1\), \/terms-of-service\/ \(1\)/);
assert.match(scalePromptContext.task.sourceInventorySummary, /neutral corpus indicators rather than an automatic route target or quality verdict/);
assert.match(scalePromptContext.task.sourceInventorySummary, /every retained source path still requires a deliberate preserved, redirected, canonical-duplicate, or intentionally retired disposition/);
assert.match(websiteManagerAuthoringSystemPrompt, /no missing routes and no additional routes/);
assert.match(websiteManagerAuthoringSystemPrompt, /evidence for that route, not permission to recreate the source URL/);
assert.match(websiteManagerAuthoringSystemPrompt, /TSX and CSS readable, structurally formatted, and organized rather than minified/);
const initialBuildSkill = taskSkillFor("initial_build").knowledge.join("\n");
for (const contract of [
  /do not add, remove, merge, or redirect routes/,
  /authored TSX and CSS readable, structurally formatted/,
  /customer purpose shape each page's composition, supporting copy and closing action/,
  /decorative numbers and diagrams are not proof/,
  /Preserve geographic qualifiers/,
  /primary action without an oversized headline crowding it out/,
  /Give a form its purpose and essential safety context first, not a backlog of secondary reference details/,
  /exact excerpts with their exact attribution/,
  /one clear role rather than repeating adjacent versions of the same phone number/,
  /distribute useful distinct images across relevant routes without an image quota/,
  /LeadField label and control class props/,
  /full-column controls/,
  /opened phone navigation and the complete form/
]) assert.match(initialBuildSkill, contract);

const [contracts, workflow, sourcePreparation, repository, architecture, browserGate] = await Promise.all([
  readFile("packages/site-agent/contracts.ts", "utf8"),
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("packages/site-platform/source-preparation.ts", "utf8"),
  readFile("packages/platform-data/repository.ts", "utf8"),
  readFile("packages/site-agent/architecture.ts", "utf8"),
  readFile("packages/site-verification/browser-gate.ts", "utf8")
]);
for (const tool of [
  "search_sources",
  "read_source_page",
  "list_source_pages",
  "list_source_resources",
  "adopt_source_asset",
  "search_public_web",
  "retry_source",
  "inspect_assets",
  "retrieve_public_source"
]) {
  assert(contracts.includes(`"${tool}"`), `${tool} is missing`);
}
assert(workflow.includes("executeAuthoringSourceTool"));
assert(workflow.includes("fetchPublicText"));
assert(workflow.includes("repository.applyPreparedProvisionalContext"));
assert.match(workflow, /source_preparation_failed[\s\S]{0,800}applyPreparedProvisionalContext|applyPreparedProvisionalContext[\s\S]{0,800}source_preparation_failed/,
  "Retained-source persistence failures must remain owner-retryable source preparation failures.");
assert(workflow.includes("ownerCanRetrySiteAgentRun(failed)"));
assert(sourcePreparation.includes("ingestWebsite"));
assert(sourcePreparation.includes("materializeCanonicalSourceLogo"));
assert(sourcePreparation.includes("assets: [canonicalSourceLogo.ref]"));
assert.match(workflow, /assetRevisions: ingested\.canonicalSourceLogo \? \[ingested\.canonicalSourceLogo\.revision\] : \[\]/,
  "Initial source preparation does not retain its canonical logo atomically.");
assert.match(workflow, /filter\(\(candidate\) => candidate\.likelyKind !== "logo"\)/,
  "Raw source-logo alternatives are still exposed to authors.");
assert(repository.includes("asset_documents: input.assetRevisions"));
assert(repository.includes("state_document: businessStateSchema.parse(input.businessState)"));
assert(sourcePreparation.includes("websiteSourcePreparationDeadlineMs = 20 * 60_000"));
assert(workflow.includes("run = await this.prepareInitialSource(run, sourceSignal)"));
assert(workflow.includes("if (usableWebsiteMirror) return run"));
assert(workflow.indexOf("run = await this.prepareInitialSource(run, sourceSignal)") < workflow.indexOf("deadlineAt = Date.parse(run.guardrails.deadlineAt)"));
assert(workflow.includes("siteAgentRunGuardrailsForKind(\"initial_build\", authoringStartedAt)"));
assert(workflow.includes("parseApprovedArchitectureModule"));
assert.match(workflow, /run\.kind !== \"initial_build\"[\s\S]{0,1200}createArchitectureReleasePlan\(retainedArchitecture/,
  "Edit runs with full-site browser coverage do not recover their retained approved route ledger.");
assert.match(workflow, /exactParentRevision\.sourceHash === outcome\.revision\.sourceHash[\s\S]{0,1800}candidateVersionId: retainedVersion\.id/,
  "An exact no-op edit does not reuse its existing verified workspace and candidate.");
assert(workflow.includes("unchanged_candidate_artifact_unavailable"),
  "No-op finalization can retain screenshot provenance from an unavailable artifact.");
assert(!workflow.includes("checkpointForVerification"));
assert(repository.includes('rpc("begin_incremental_website_source_snapshot"'));
assert(repository.includes('rpc("complete_incremental_website_source_snapshot"'));
assert(repository.includes('.not("ready_at", "is", null)'));
assert(!repository.includes('rpc("finalize_staged_website_source_snapshot"'));
assert(architecture.includes('if (coverage === "all-routes") return routes.map((route) => route.path)'));
assert(browserGate.includes('viewport.name !== "tablet"'));

process.stdout.write("Compact complete source inventory, separate source preparation, bounded browser verification, retained-page workspace, and source tools verified.\n");

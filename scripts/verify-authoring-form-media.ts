import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import { SiteAuthoringWorkflow, operatorHomepageContextPages } from "../packages/site-platform/workflow";
import { createSiteAuthoringContext, siteAgentRunGuardrailsForKind, type WebsiteManagerAgent } from "../packages/site-agent";
import { businessStateSchema, siteAgentRunSchema, siteAgentSessionSchema, sourceSnapshotSchema, sourceSnapshotPageSchema, sourceSnapshotResourceSchema, type SitePublicBuildInput } from "../packages/site-contracts";
import { resolveApprovedSourceDocuments } from "../packages/business-data/owner-documents";
import { sha256, stableJson } from "../packages/business-data";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

// Exercise the actual workflow closure and local transactional repository. No
// model/network calls, no replacement implementation of form/media behavior.
const directory = await mkdtemp(join(tmpdir(), "lodesta-form-media-"));
try {
  const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
  const store = new LocalArtifactBlobStore(join(directory, "blobs"));
  const baseInput = buildSyntheticSiteInput();
  const now = new Date().toISOString();
  const owner = "58c3a17e-6ad5-4e2c-9eb3-90e71527a054";
  const oldDocument = "Privacy Policy\nThe former site used preference storage.";
  const approvedDocument = "Privacy Policy\nThe new site does not use persistent analytics browser storage.";
  const documentPage = sourceSnapshotPageSchema.parse({ schemaVersion: 1, id: "page_owner_privacy", sourceSnapshotId: "source_original_document",
    resourceId: "resource_owner_privacy", requestedUrl: "https://northstar.example/privacy", path: "/privacy", outcome: "fetched",
    indexability: "indexable", headings: [], wordCount: 10, internalLinks: [], externalLinks: [], linkProminence: 1,
    extractedText: oldDocument, textContentHash: sha256(oldDocument), producer: "fixture", inputHash: sha256("fixture"), createdAt: now });
  const originalSnapshot = sourceSnapshotSchema.parse({ schemaVersion: 1, id: documentPage.sourceSnapshotId, businessId: baseInput.businessId,
    sourceType: "website", sourceUrl: "https://northstar.example/", contentHash: sha256("fixture"), capturedAt: now, payload: { kind: "website-mirror", fixture: true } });
  const approvalPayload = { requestId: "change_privacy", requestedBy: owner, approvedBy: owner, siteId: baseInput.siteId, ownerOperationalRevision: 2,
    change: { kind: "replace_source_document", sourceSnapshotId: originalSnapshot.id, sourcePageId: documentPage.id, path: documentPage.path,
      sourceTextHash: documentPage.textContentHash, expectedDocumentHash: documentPage.textContentHash, replacementText: approvedDocument } };
  const approvalSnapshot = sourceSnapshotSchema.parse({ schemaVersion: 1, id: "source_owner_document", businessId: baseInput.businessId,
    sourceType: "owner_input", contentHash: sha256(stableJson(approvalPayload)), capturedAt: now, payload: approvalPayload });
  const snapshots = [originalSnapshot, approvalSnapshot];
  const inputBody = { ...baseInput, ownerOperationalRevision: 2, sourceSnapshotIds: [originalSnapshot.id, approvalSnapshot.id],
    publicFacts: baseInput.publicFacts.map(fact => ({ ...fact, source: { ...fact.source, sourceSnapshotId: originalSnapshot.id } })) };
  const { inputHash: _oldHash, ...inputWithoutHash } = inputBody;
  const input = { ...inputWithoutHash, inputHash: sha256(stableJson(inputWithoutHash)) };
  const homepageText = "Northstar home services";
  const homepage = { ...documentPage, id: "page_owner_home", path: "/", requestedUrl: "https://northstar.example/",
    extractedText: homepageText, textContentHash: sha256(homepageText), wordCount: 3 };
  const sourcePages = [homepage, documentPage];
  const sourceInventoryPages = operatorHomepageContextPages(sourcePages, "representative-customer-index");
  assert.deepEqual(sourceInventoryPages.map(page => page.id), [homepage.id], "Fixture must omit the legal target from the prompt inventory.");
  assert.throws(() => createSiteAuthoringContext({ buildInput: input, snapshots, pages: sourceInventoryPages }), /owner_document_target_invalid/,
    "Reproduce the hosted failure: a compact inventory is not complete document authority.");
  const authoringContext = createSiteAuthoringContext({ buildInput: input, snapshots, pages: sourcePages, sourceInventoryPages });
  const stateBody = {
    schemaVersion: 1, businessId: input.businessId, siteId: input.siteId,
    revision: 1, ownerOperationalRevision: input.ownerOperationalRevision, updatedAt: now,
    identity: { name: input.business.name, status: input.business.identityStatus, description: input.business.description, categories: [] },
    contacts: input.business.contacts, locations: input.business.locations, serviceAreas: input.business.serviceAreas,
    offerings: input.business.offerings, proof: input.business.proof, assets: input.business.assets,
    links: input.business.links, facts: input.publicFacts
  };
  await repository.createSite({ id: input.siteId, ownerUserId: owner, businessId: input.businessId,
    sourceUrl: "https://northstar.example/",
    slug: "form-media-test", status: "draft", reportingTimezone: "UTC", currentPublicBuildInputId: input.id, createdAt: now, updatedAt: now });
  await repository.saveBusinessState(businessStateSchema.parse({ ...stateBody, stateHash: sha256(stableJson(stateBody)) }));
  await repository.saveSiteIntent(input.intent);
  for (const form of input.forms) await repository.saveFormDefinition(form);
  await repository.savePublicBuildInput(input);
  for (const snapshot of snapshots) await repository.saveSourceSnapshot(snapshot);
  await repository.saveSourceSnapshotResources([sourceSnapshotResourceSchema.parse({
    schemaVersion: 1, id: documentPage.resourceId, sourceSnapshotId: originalSnapshot.id,
    captureKind: "http_response", role: "document", requestedUrl: documentPage.requestedUrl,
    finalUrl: documentPage.requestedUrl, outcome: "fetched", status: 200, contentType: "text/html",
    storedEncoding: "identity", rawContentHash: sha256(oldDocument), blobContentHash: sha256(oldDocument),
    storageKey: "fixture/privacy", rawBytes: Buffer.byteLength(oldDocument), storedBytes: Buffer.byteLength(oldDocument),
    headers: {}, redirectChain: [], initiatorUrls: [], capturedAt: now, metadata: {}
  })]);
  await repository.saveSourceSnapshotPages(sourcePages);
  const canaryWorkflow = new SiteAuthoringWorkflow(repository, store);
  const canary = await canaryWorkflow.bootstrapFromRetainedSite({ templateSiteId: input.siteId,
    idempotencyKey: "approved-document-clone", modelRoute: { apiProvider: "openai", modelId: "gpt-5.6-luna" }, maxCostUsd: 1 });
  const canarySnapshots = (await Promise.all(canary.buildInput.sourceSnapshotIds.map(id => repository.getSourceSnapshot(id)))).map(snapshot => snapshot!);
  const canaryPages = (await Promise.all(canary.buildInput.sourceSnapshotIds.map(id => repository.listSourceSnapshotPages(id)))).flat();
  const canaryDocuments = resolveApprovedSourceDocuments({ buildInput: canary.buildInput, snapshots: canarySnapshots, pages: canaryPages });
  assert.equal(canaryDocuments[0]?.text, approvedDocument);
  assert.equal(canary.buildInput.ownerOperationalRevision, 2, "Approval chronology must not become a future revision in the clone.");
  assert.equal(canary.site.ownerUserId, owner);
  assert.equal(canary.run.status, "queued", "The retained canary must never execute inline.");
  assert.equal(canaryDocuments[0]?.sourcePageId, documentPage.id, "Keep the immutable shared page identity.");
  assert.notEqual(canaryDocuments[0]?.sourceSnapshotId, originalSnapshot.id, "Bind approval to the cloned source authority.");
  const canaryContext = createSiteAuthoringContext({ buildInput: canary.buildInput, snapshots: canarySnapshots, pages: canaryPages });
  assert.equal(canaryContext.ownerAuthority.approvedDocuments?.[0]?.contentHash, sha256(approvedDocument));
  assert.deepEqual(await repository.getSourceSnapshot(approvalSnapshot.id), approvalSnapshot, "Never rewrite original approval authority.");
  assert.deepEqual(await repository.getPublicBuildInput(input.id), input, "Never rewrite original retained input.");
  assert.equal((await canaryWorkflow.bootstrapFromRetainedSite({ templateSiteId: input.siteId,
    idempotencyKey: "approved-document-clone", modelRoute: { apiProvider: "openai", modelId: "gpt-5.6-luna" }, maxCostUsd: 1 })).run.id, canary.run.id);
  const session = siteAgentSessionSchema.parse({ schemaVersion: "site-agent-session", id: "session_form_media",
    siteId: input.siteId, principal: { kind: "owner", id: owner }, status: "active", publicBuildInputId: input.id,
    sandboxProvider: "cloudflare", sandboxId: "sandbox_form_media", leaseTokenHash: sha256("test-lease"),
    leaseExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), rotateAt: new Date(Date.now() + 7_200_000).toISOString(),
    createdAt: now, updatedAt: now });
  await repository.saveAgentSession(session);
  const run = siteAgentRunSchema.parse({ schemaVersion: "site-agent-run", id: "run_form_media", sessionId: session.id,
    siteId: input.siteId, publicBuildInputId: input.id, request: { kind: "owner_instruction", messageIds: ["message_form_media"] },
    origin: "owner_request", requestedBy: owner, kind: "edit", status: "running", stage: "authoring", executionNumber: 1,
    apiProvider: "openai", modelId: "gpt-5.6-sol", skillVersions: {}, guardrails: siteAgentRunGuardrailsForKind("edit", now),
    usage: { inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 0 }, startedAt: now });
  await repository.saveAgentRun(run);
  const mediaBytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#285649" } }).webp().toBuffer();
  const rebased: SitePublicBuildInput[] = [];
  const sandbox = {
    rebase: async (_id: string, _revision: string, next: SitePublicBuildInput) => {
      rebased.push(next); return { revision: `rebase_${rebased.length}` };
    },
    apply: async () => ({ revision: `build_${rebased.length}`, buildDurationMs: 1, previewPath: "/preview" })
  };
  const complete = new Error("fixture_complete");
  const manager = { run: async ({ runtime }: Parameters<WebsiteManagerAgent["run"]>[0]) => {
    const documentPath = authoringContext.ownerAuthority.approvedDocuments![0]!.contentFile;
    const readDocument = async () => {
      const result = await runtime.execute({ callId: "read_document", name: "read_files",
        arguments: { files: [{ path: documentPath, startLine: 1, endLine: 100 }] } });
      assert.equal(typeof result.modelOutput, "string");
      return JSON.parse(result.modelOutput as string);
    };
    const before = await readDocument();
    assert.equal(before.files[0].lines.map((line: { content: string }) => line.content).join("\n"), approvedDocument);
    await runtime.execute({ callId: "unrelated_edit", name: "write_file", arguments: { path: "src/styles.css", content: "body{color:#222}" } });
    assert.equal((await readDocument()).files[0].contentHash, sha256(approvedDocument), "Ordinary edits must preserve read-only document authority.");
    await assert.rejects(() => runtime.execute({ callId: "forged_authority", name: "write_file", arguments: { path: documentPath, content: "forged" } }));
    const image = await runtime.execute({ callId: "media", name: "create_image", arguments: {
      action: "generate", purpose: "background", prompt: "Synthetic test texture", sourceAssetIds: [], size: "1024x1024", alt: "Test texture"
    } });
    assert.equal(image.diagnosticOutput.ok, true);
    assert.equal((await runtime.execute({ callId: "build1", name: "build_preview", arguments: {} })).diagnosticOutput.ok, true);
    assert.equal(rebased.length, 1);
    assert.equal(rebased[0]!.business.assets.length, 1);
    const configuration = { ...input.forms[0]!, expectedRevision: 1, submitLabel: "Ask about a repair" };
    const first = await runtime.execute({ callId: "form1", name: "configure_lead_form", arguments: configuration });
    assert.equal(first.diagnosticOutput.ok, true);
    const retainedRun = (await repository.getAgentRun(run.id))!;
    const retained = (await repository.getPublicBuildInput(retainedRun.publicBuildInputId))!;
    assert.equal(retained.forms[0]!.revision, 2);
    assert.equal(retained.business.assets.length, 0, "Uncommitted media must not enter the form transaction.");
    assert.equal(retained.ownerOperationalRevision, input.ownerOperationalRevision);
    assert.equal((await runtime.execute({ callId: "build2", name: "build_preview", arguments: {} })).diagnosticOutput.ok, true);
    assert.equal(rebased.length, 2, "A form change must rebase even when media references are unchanged.");
    assert.notEqual(rebased[1]!.id, rebased[0]!.id);
    assert.equal(rebased[1]!.forms[0]!.revision, 2);
    assert.deepEqual(rebased[1]!.business.assets, rebased[0]!.business.assets);
    const second = await runtime.execute({ callId: "form2", name: "configure_lead_form", arguments: { ...configuration, expectedRevision: 2, submitLabel: "Send repair request" } });
    assert.equal(second.diagnosticOutput.ok, true, "A second form change must use the newly retained authority.");
    assert.equal(second.diagnosticOutput.revision, 3);
    await assert.rejects(() => runtime.execute({ callId: "stale", name: "configure_lead_form", arguments: configuration }), /lead_form_revision_conflict:3/);
    assert.equal((await repository.getPublicBuildInput(input.id))!.forms[0]!.revision, 1, "Original immutable input changed.");
    throw complete;
  } };
  const workflow = new SiteAuthoringWorkflow(repository, store, sandbox as never, manager as never, undefined,
    (async () => ({ bytes: mediaBytes, mimeType: "image/webp", width: 16, height: 16, sourceAssetRevisionIds: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 1 }
    })) as never);
  await assert.rejects(() => Reflect.get(workflow, "runAuthoring").call(workflow, {
    run, session, buildInput: input, authoringContext,
    snapshots, sourcePages, sandboxRevision: "initial", kind: "edit", instruction: "Add a texture and change the form button label.",
    currentFiles: [{ path: "src/site.tsx", content: 'export const siteDefinition = { routes: [{path:"/",element:<main><h1>Home</h1></main>}] };' }, { path: "src/styles.css", content: "body{color:#111}" }]
  }), (error: unknown) => error === complete);
  console.log("Owner-approved documents reach the normal runtime read tools and survive unrelated edits. Form changes preserve retained authority and provisional media across consecutive builds.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

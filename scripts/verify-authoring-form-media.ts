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
import { canonicalSourceLogoAssetId } from "../packages/site-platform/source-logo-materialization";

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
  const logoBytes = await sharp({ create: { width: 160, height: 100, channels: 4, background: "transparent" } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect x="40" y="20" width="80" height="60" fill="#183957"/></svg>') }]).png().toBuffer();
  const logoResource = sourceSnapshotResourceSchema.parse({
    schemaVersion: 1, id: "resource_opaque_crest", sourceSnapshotId: originalSnapshot.id,
    captureKind: "http_response", role: "image", requestedUrl: "https://cdn.example/opaque123",
    finalUrl: "https://cdn.example/opaque123", outcome: "fetched", status: 200, contentType: "image/png",
    storedEncoding: "identity", rawContentHash: sha256(logoBytes), blobContentHash: sha256(logoBytes),
    storageKey: "fixture/opaque123", rawBytes: logoBytes.length, storedBytes: logoBytes.length,
    headers: {}, redirectChain: [], initiatorUrls: [homepage.requestedUrl], capturedAt: now, metadata: {}
  });
  await store.putImmutable({ key: logoResource.storageKey!, bytes: logoBytes, contentType: "image/png", contentHash: sha256(logoBytes) });
  await repository.saveSourceSnapshotResources([logoResource, { ...logoResource, id: "resource_other_crest", rawContentHash: sha256("different") }]);
  const mirroredWebsiteSource = canarySnapshots.find((snapshot) => snapshot.sourceType === "website")!;
  const inspectedPhoto = sourceSnapshotResourceSchema.parse({
    schemaVersion: 1, id: "resource_mirrored_service_photo", sourceSnapshotId: originalSnapshot.id,
    captureKind: "http_response", role: "image", requestedUrl: "https://northstar.example/assets/service-photo.webp",
    finalUrl: "https://northstar.example/assets/service-photo.webp", outcome: "fetched", status: 200, contentType: "image/webp",
    storedEncoding: "identity", rawContentHash: sha256(mediaBytes), blobContentHash: sha256(mediaBytes),
    storageKey: "fixture/service-photo", rawBytes: mediaBytes.length, storedBytes: mediaBytes.length,
    headers: {}, redirectChain: [], initiatorUrls: [homepage.requestedUrl], capturedAt: now, metadata: {}
  });
  const secondarySnapshot = sourceSnapshotSchema.parse({
    ...originalSnapshot, id: "source_secondary_catalog", businessId: canary.buildInput.businessId,
    sourceUrl: "https://second.example/", contentHash: sha256("secondary-catalog")
  });
  const secondaryPhoto = sourceSnapshotResourceSchema.parse({
    ...inspectedPhoto, id: "resource_secondary_catalog_photo", sourceSnapshotId: secondarySnapshot.id,
    requestedUrl: "https://second.example/assets/service-photo.webp", finalUrl: "https://second.example/assets/service-photo.webp",
    storageKey: "fixture/secondary-service-photo", initiatorUrls: [secondarySnapshot.sourceUrl!]
  });
  const secondaryPage = sourceSnapshotPageSchema.parse({
    ...homepage, id: "page_secondary_catalog", sourceSnapshotId: secondarySnapshot.id, resourceId: secondaryPhoto.id,
    requestedUrl: secondarySnapshot.sourceUrl!, finalUrl: secondarySnapshot.sourceUrl!, extractedText: "Secondary source home",
    textContentHash: sha256("Secondary source home")
  });
  const outsideSnapshot = sourceSnapshotSchema.parse({
    ...originalSnapshot, id: "source_outside_catalog", businessId: canary.buildInput.businessId,
    sourceUrl: "https://outside.example/", contentHash: sha256("outside-catalog")
  });
  const outsidePhoto = sourceSnapshotResourceSchema.parse({
    ...inspectedPhoto, id: "resource_outside_catalog_photo", sourceSnapshotId: outsideSnapshot.id,
    requestedUrl: "https://outside.example/assets/service-photo.webp", finalUrl: "https://outside.example/assets/service-photo.webp",
    storageKey: "fixture/outside-service-photo", initiatorUrls: [outsideSnapshot.sourceUrl!]
  });
  const outsidePage = sourceSnapshotPageSchema.parse({
    ...secondaryPage, id: "page_outside_catalog", sourceSnapshotId: outsideSnapshot.id, resourceId: outsidePhoto.id,
    requestedUrl: outsideSnapshot.sourceUrl!, finalUrl: outsideSnapshot.sourceUrl!, extractedText: "Outside source home",
    textContentHash: sha256("Outside source home")
  });
  await repository.saveSourceSnapshotResources([inspectedPhoto]);
  await repository.saveSourceSnapshot(secondarySnapshot);
  await repository.saveSourceSnapshotResources([secondaryPhoto]);
  await repository.saveSourceSnapshotPages([secondaryPage]);
  await repository.saveSourceSnapshot(outsideSnapshot);
  await repository.saveSourceSnapshotResources([outsidePhoto]);
  await repository.saveSourceSnapshotPages([outsidePage]);
  for (const asset of [inspectedPhoto, secondaryPhoto, outsidePhoto]) {
    await store.putImmutable({ key: asset.storageKey!, bytes: mediaBytes, contentType: "image/webp", contentHash: sha256(mediaBytes) });
  }
  const inspectionSession = siteAgentSessionSchema.parse({ ...session, id: "session_asset_inspection",
    siteId: canary.site.id, publicBuildInputId: canary.buildInput.id, sandboxId: "sandbox_asset_inspection" });
  const inspectionRun = siteAgentRunSchema.parse({ ...run, id: "run_asset_inspection", sessionId: inspectionSession.id,
    siteId: canary.site.id, publicBuildInputId: canary.buildInput.id, request: { kind: "owner_instruction", messageIds: ["message_asset_inspection"] } });
  await repository.saveAgentSession(inspectionSession);
  await repository.saveAgentRun(inspectionRun);
  const inspectionComplete = new Error("asset_inspection_fixture_complete");
  const inspectionManager = { run: async ({ runtime }: Parameters<WebsiteManagerAgent["run"]>[0]) => {
    const inspected = await runtime.execute({ callId: "inspect_catalog_assets", name: "inspect_assets", arguments: {
      assetIds: [inspectedPhoto.id, secondaryPhoto.id, outsidePhoto.id]
    } });
    const sourceAssets = inspected.diagnosticOutput.sourceAssets as Array<{
      resourceId: string; sourceId: string; sourcePageId: string;
    }>;
    assert.deepEqual(sourceAssets.map((asset) => asset.resourceId).sort(), [inspectedPhoto.id, secondaryPhoto.id].sort(),
      "Inspect must include every active-catalog image and not leak a retained image outside it.");
    const mirrored = sourceAssets.find((asset) => asset.resourceId === inspectedPhoto.id)!;
    const secondary = sourceAssets.find((asset) => asset.resourceId === secondaryPhoto.id)!;
    assert.equal(mirrored.sourceId, mirroredWebsiteSource.id, "A mirrored resource must advertise the active logical source ID.");
    assert.equal(secondary.sourceId, secondarySnapshot.id, "The matching second catalog source must be retained in the result.");
    assert.equal(sourceAssets.some((asset) => asset.resourceId === outsidePhoto.id), false);
    for (const asset of [mirrored, secondary]) {
      const adopted = await runtime.execute({ callId: `adopt_${asset.resourceId}`, name: "adopt_source_asset", arguments: {
        sourceId: asset.sourceId, resourceId: asset.resourceId, sourcePageId: asset.sourcePageId,
        kind: "photo", alt: "Fixture service photo"
      } });
      assert.equal(adopted.diagnosticOutput.ok, true, "The exact inspect tuple must be accepted by adoption.");
    }
    throw inspectionComplete;
  } };
  const inspectionWorkflow = new SiteAuthoringWorkflow(repository, store, undefined, inspectionManager as never);
  await assert.rejects(() => Reflect.get(inspectionWorkflow, "runAuthoring").call(inspectionWorkflow, {
    run: inspectionRun, session: inspectionSession, buildInput: canary.buildInput,
    authoringContext: createSiteAuthoringContext({ buildInput: canary.buildInput,
      snapshots: [...canarySnapshots, secondarySnapshot], pages: [...canaryPages, secondaryPage] }),
    snapshots: [...canarySnapshots, secondarySnapshot], sourcePages: [...canaryPages, secondaryPage],
    sandboxRevision: "initial", kind: "edit", instruction: "Inspect the approved source photos.",
    currentFiles: [{ path: "src/site.tsx", content: 'export const siteDefinition = { routes: [{path:"/",element:<main><h1>Home</h1></main>}] };' }]
  }), (error: unknown) => error === inspectionComplete);
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
    const logoArgs = { sourceId: originalSnapshot.id, resourceId: logoResource.id,
      sourcePageId: homepage.id, kind: "logo", alt: "Official source mark" };
    const unassociated = await runtime.execute({ callId: "bad_logo_page", name: "adopt_source_asset",
      arguments: { ...logoArgs, sourcePageId: documentPage.id } });
    assert.equal(unassociated.diagnosticOutput.error, "source_logo_provenance_invalid");
    const logo = await runtime.execute({ callId: "source_logo", name: "adopt_source_asset", arguments: logoArgs });
    assert.equal(logo.diagnosticOutput.ok, true);
    const logoRef = logo.diagnosticOutput.asset as SitePublicBuildInput["business"]["assets"][number];
    assert.equal(logoRef.kind, "logo");
    assert.equal(logoRef.assetId, canonicalSourceLogoAssetId(input.businessId));
    assert(logoRef.width! < 160, "Opaque source mark must receive canonical presentation preparation.");
    const replay = await runtime.execute({ callId: "source_logo_again", name: "adopt_source_asset", arguments: logoArgs });
    assert.deepEqual(replay.diagnosticOutput.asset, logoRef, "Repeated adoption must reuse the same canonical revision.");
    const replacement = await runtime.execute({ callId: "replace_logo", name: "adopt_source_asset",
      arguments: { ...logoArgs, resourceId: "resource_other_crest" } });
    assert.equal(replacement.diagnosticOutput.error, "canonical_logo_already_available");
    assert.deepEqual((await store.get(logoResource.storageKey!))!.bytes, logoBytes, "Retained source bytes must stay unchanged.");
    const image = await runtime.execute({ callId: "media", name: "create_image", arguments: {
      action: "generate", purpose: "background", prompt: "Synthetic test texture", sourceAssetIds: [], size: "1024x1024", alt: "Test texture"
    } });
    assert.equal(image.diagnosticOutput.ok, true);
    assert.equal((await runtime.execute({ callId: "build1", name: "build_preview", arguments: {} })).diagnosticOutput.ok, true);
    assert.equal(rebased.length, 1);
    assert.equal(rebased[0]!.business.assets.length, 2);
    assert.equal(rebased[0]!.business.assets.filter(asset => asset.kind === "logo").length, 1);
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
  // Exercise the same closure with an owner-uploaded identity, not just a
  // source-derived logo. An explicit source selection cannot replace either.
  const ownerLogo = { ...rebased[0]!.business.assets.find(asset => asset.kind === "logo")!,
    assetId: "asset_owner_logo", revisionId: "asset_revision_owner_logo", origin: "owner_upload" as const };
  const currentState = (await repository.getBusinessState(input.businessId))!;
  const { stateHash: _stateHash, ...ownerStateBody } = { ...currentState, revision: currentState.revision + 1, assets: [ownerLogo] };
  await repository.saveBusinessState(businessStateSchema.parse({ ...ownerStateBody, stateHash: sha256(stableJson(ownerStateBody)) }));
  const { inputHash: _inputHash, ...ownerInputBody } = { ...input, business: { ...input.business, assets: [ownerLogo] }, assetRevisionIds: [ownerLogo.revisionId] };
  const ownerInput = { ...ownerInputBody, inputHash: sha256(stableJson(ownerInputBody)) };
  const ownerComplete = new Error("owner_logo_fixture_complete");
  const ownerManager = { run: async ({ runtime }: Parameters<WebsiteManagerAgent["run"]>[0]) => {
    const denied = await runtime.execute({ callId: "replace_owner_logo", name: "adopt_source_asset",
      arguments: { sourceId: originalSnapshot.id, resourceId: logoResource.id, sourcePageId: homepage.id, kind: "logo", alt: "Source logo" } });
    assert.equal(denied.diagnosticOutput.error, "canonical_logo_already_available");
    assert.deepEqual((await repository.getBusinessState(input.businessId))!.assets, [ownerLogo]);
    throw ownerComplete;
  } };
  const ownerWorkflow = new SiteAuthoringWorkflow(repository, store, sandbox as never, ownerManager as never);
  await assert.rejects(() => Reflect.get(ownerWorkflow, "runAuthoring").call(ownerWorkflow, {
    run, session, buildInput: ownerInput,
    authoringContext: createSiteAuthoringContext({ buildInput: ownerInput, snapshots, pages: sourcePages, sourceInventoryPages }),
    snapshots, sourcePages, sandboxRevision: "initial", kind: "edit", instruction: "Inspect the source logo.",
    currentFiles: [{ path: "src/site.tsx", content: 'export const siteDefinition = { routes: [{path:"/",element:<main><h1>Home</h1></main>}] };' }]
  }), (error: unknown) => error === ownerComplete);
  console.log("Owner-approved documents reach the normal runtime read tools and survive unrelated edits. Form changes preserve retained authority and provisional media across consecutive builds.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import { SiteAuthoringWorkflow, mediaProvenanceClosure, operatorHomepageContextPages, withRetainedAssetRevisionIds } from "../packages/site-platform/workflow";
import { createSiteAuthoringContext, imageCreationModel, siteAgentRunGuardrailsForKind, type WebsiteManagerAgent } from "../packages/site-agent";
import { assetRevisionSchema, businessStateSchema, siteAgentRunSchema, siteAgentSessionSchema, siteBuildArtifactSchema, sitePublicBuildInputSchema, siteVersionSchema, siteWorkspaceRevisionSchema, sourceSnapshotSchema, sourceSnapshotPageSchema, sourceSnapshotResourceSchema, type AssetRevision, type AssetRevisionRef, type SitePublicBuildInput } from "../packages/site-contracts";
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
  let imageCreatorCalls = 0;
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
    await assert.rejects(() => runtime.execute({ callId: "edit_logo", name: "create_image", arguments: {
      action: "edit", purpose: "section", prompt: "Rework this mark.", sourceAssetIds: [logoRef.assetId], size: "1024x1024", alt: "Edited mark"
    } }), /official_logo_image_edit_unsupported/);
    assert.equal(imageCreatorCalls, 0, "Editing a managed official logo reached the image API handler.");
    const image = await runtime.execute({ callId: "media", name: "create_image", arguments: {
      action: "generate", purpose: "background", prompt: "Synthetic test texture", sourceAssetIds: [], size: "1024x1024", alt: "Test texture"
    } });
    assert.equal(image.diagnosticOutput.ok, true);
    assert.equal(imageCreatorCalls, 1);
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
    (async () => {
      imageCreatorCalls += 1;
      return { bytes: mediaBytes, mimeType: "image/webp", width: 16, height: 16, sourceAssetRevisionIds: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 1 }
      };
    }) as never);
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
  await verifyGeneratedMediaProvenanceFinalization();
  console.log("Owner-approved documents reach the normal runtime read tools and survive unrelated edits. Form changes preserve retained authority and provisional media across consecutive builds.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function verifyGeneratedMediaProvenanceFinalization() {
  const provenanceDirectory = await mkdtemp(join(tmpdir(), "lodesta-media-provenance-"));
  try {
    const repository = new LocalSitePlatformRepository(join(provenanceDirectory, "repository.json"));
    const input = buildSyntheticSiteInput();
    const now = "2026-09-10T12:00:00.000Z";
    const owner = "58c3a17e-6ad5-4e2c-9eb3-90e71527a054";
    const initialStateBody = {
      schemaVersion: 1 as const, businessId: input.businessId, siteId: input.siteId,
      revision: 1, ownerOperationalRevision: input.ownerOperationalRevision, updatedAt: now,
      identity: { name: input.business.name, status: input.business.identityStatus, description: input.business.description, categories: [] },
      contacts: input.business.contacts, locations: input.business.locations, serviceAreas: input.business.serviceAreas,
      offerings: input.business.offerings, proof: input.business.proof, assets: input.business.assets,
      links: input.business.links, facts: input.publicFacts
    };
    await repository.createSite({ id: input.siteId, ownerUserId: owner, businessId: input.businessId,
      sourceUrl: "https://northstar.example/", slug: "media-provenance-test", status: "draft", reportingTimezone: "UTC",
      currentPublicBuildInputId: input.id, createdAt: now, updatedAt: now });
    await repository.saveBusinessState(businessStateSchema.parse({ ...initialStateBody, stateHash: sha256(stableJson(initialStateBody)) }));
    await repository.saveSiteIntent(input.intent);
    for (const form of input.forms) await repository.saveFormDefinition(form);
    await repository.savePublicBuildInput(input);

    const ancestor = fixtureAdoptedSourceRevision("asset_revision_provenance_ancestor");
    const edited = fixtureGeneratedRevision("asset_revision_provenance_edited", [ancestor.id]);
    const sibling = fixtureGeneratedRevision("asset_revision_provenance_sibling", [ancestor.id]);
    const renderedRefs = [edited, sibling].map(fixtureGeneratedRef);
    const closure = await mediaProvenanceClosure({
      roots: renderedRefs,
      provisionalRevisions: [ancestor, edited, sibling],
      getRetainedRevision: async () => undefined
    });
    assert.deepEqual(closure.map((revision) => revision.id), [ancestor.id, edited.id, sibling.id],
      "A rendered edit and sibling edit must retain their shared provisional source revision.");
    await assert.rejects(() => mediaProvenanceClosure({
      roots: [fixtureGeneratedRef(edited)], provisionalRevisions: [edited], getRetainedRevision: async () => undefined
    }), /generated_media_provenance_missing:asset_revision_provenance_ancestor/);
    const retainedSource = fixtureAdoptedSourceRevision("asset_revision_provenance_retained_source");
    const editFromRetainedSource = fixtureGeneratedRevision("asset_revision_provenance_retained_edit", [retainedSource.id]);
    let retainedSourceLookedUp = false;
    const retainedSourceClosure = await mediaProvenanceClosure({
      roots: [fixtureGeneratedRef(editFromRetainedSource)], provisionalRevisions: [editFromRetainedSource],
      getRetainedRevision: async (revisionId) => {
        retainedSourceLookedUp ||= revisionId === retainedSource.id;
        return revisionId === retainedSource.id ? retainedSource : undefined;
      }
    });
    assert.equal(retainedSourceLookedUp, true, "An edit from a retained source must prove that source revision exists.");
    assert.deepEqual(retainedSourceClosure.map((revision) => revision.id), [editFromRetainedSource.id]);
    const cycleA = fixtureGeneratedRevision("asset_revision_provenance_cycle_a", ["asset_revision_provenance_cycle_b"]);
    const cycleB = fixtureGeneratedRevision("asset_revision_provenance_cycle_b", [cycleA.id]);
    await assert.rejects(() => mediaProvenanceClosure({
      roots: [fixtureGeneratedRef(cycleA)], provisionalRevisions: [cycleA, cycleB], getRetainedRevision: async () => undefined
    }), /generated_media_provenance_cycle:asset_revision_provenance_cycle_a/);

    const { inputHash: _baseInputHash, ...adoptionInputBody } = {
      ...input,
      id: "input_media_provenance",
      createdAt: now,
      business: { ...input.business, assets: renderedRefs },
      assetRevisionIds: renderedRefs.map((asset) => asset.revisionId)
    };
    const adoptionInput = withRetainedAssetRevisionIds({
      ...adoptionInputBody,
      inputHash: sha256(stableJson(adoptionInputBody))
    }, [ancestor.id]);
    assert.deepEqual(adoptionInput.assetRevisionIds, [ancestor.id, edited.id, sibling.id]);
    const { inputHash: adoptionInputHash, ...adoptionInputWithoutHash } = adoptionInput;
    assert.equal(adoptionInputHash, sha256(stableJson(adoptionInputWithoutHash)),
      "The augmented immutable asset manifest must retain a canonical candidate input hash.");
    assert.deepEqual(adoptionInput.business.assets.map((asset) => asset.revisionId), [edited.id, sibling.id],
      "Provenance-only ancestors must remain outside the visible business media library.");

    const adoptionStateBody = {
      ...initialStateBody, revision: 2, updatedAt: now, assets: renderedRefs
    };
    const adoptionState = businessStateSchema.parse({ ...adoptionStateBody, stateHash: sha256(stableJson(adoptionStateBody)) });
    const session = siteAgentSessionSchema.parse({ schemaVersion: "site-agent-session", id: "session_media_provenance",
      siteId: input.siteId, principal: { kind: "owner", id: owner }, status: "active", publicBuildInputId: input.id,
      sandboxProvider: "cloudflare", sandboxId: "sandbox_media_provenance", leaseTokenHash: sha256("media-provenance-lease"),
      leaseExpiresAt: "2026-09-10T13:00:00.000Z", rotateAt: "2026-09-10T14:00:00.000Z", createdAt: now, updatedAt: now });
    const runningRun = siteAgentRunSchema.parse({ schemaVersion: "site-agent-run", id: "run_media_provenance", sessionId: session.id,
      siteId: input.siteId, publicBuildInputId: input.id, request: { kind: "owner_instruction", messageIds: ["message_media_provenance"] },
      origin: "owner_request", requestedBy: owner, kind: "edit", status: "running", stage: "authoring", executionNumber: 1,
      apiProvider: "openai", modelId: "gpt-5.6-sol", skillVersions: {}, guardrails: siteAgentRunGuardrailsForKind("edit", now),
      usage: { inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 0 },
      startedAt: now });
    await repository.saveAgentSession(session);
    await repository.saveAgentRun(runningRun);
    const source = "export const siteDefinition = { routes: [{ path: '/', element: <main><h1>Northstar</h1></main> }] };";
    const workspace = {
      schemaVersion: 1 as const, id: "workspace_media_provenance", siteId: input.siteId, publicBuildInputId: adoptionInput.id,
      ownerOperationalRevision: input.ownerOperationalRevision, ownerIntentRevision: input.ownerIntentRevision, revisionNumber: 1,
      sourceHash: sha256(source), sourceArchiveKey: "workspace-backups/media-provenance.tar.gz",
      files: [{ path: "src/site.tsx", contentHash: sha256(source), bytes: Buffer.byteLength(source) }],
      createdAt: now, createdBy: { kind: "agent" as const, id: runningRun.id }
    };
    const artifact = {
      schemaVersion: 1 as const, id: "artifact_media_provenance", siteId: input.siteId, workspaceRevisionId: workspace.id,
      publicBuildInputId: adoptionInput.id, ownerOperationalRevision: input.ownerOperationalRevision, ownerIntentRevision: input.ownerIntentRevision,
      createdAt: now, artifactHash: sha256("media-provenance-artifact"), storagePrefix: "site-artifacts/media-provenance",
      files: [{ path: "index.html", contentType: "text/html", contentHash: sha256("<main>Northstar</main>"), bytes: 22, storageKey: "site-artifacts/media-provenance/index.html" }],
      routes: [{ path: "/", htmlFile: "index.html", title: "Northstar", description: "Fixture candidate" }],
      factBindings: [], capabilityBindings: [], runtimeSeriesId: input.capabilityConfiguration.trustedRuntimeSeries,
      runtimePatchAtFinalization: "runtime_patch_media_provenance", toolchainVersion: "fixture", sandboxImageDigest: sha256("fixture-sandbox"),
      qa: { hardGate: "passed" as const, checkedAt: now, routesChecked: 1, linksChecked: 0, findings: [], screenshotKeys: [] }
    };
    const requestedVersion = {
      schemaVersion: 1 as const, id: "version_media_provenance", siteId: input.siteId, number: 1, status: "candidate" as const,
      artifactId: artifact.id, artifactHash: artifact.artifactHash, workspaceRevisionId: workspace.id, publicBuildInputId: adoptionInput.id,
      ownerOperationalRevision: input.ownerOperationalRevision, ownerIntentRevision: input.ownerIntentRevision,
      formDefinitionIds: adoptionInput.forms.map((form) => form.id), sourceSnapshotIds: adoptionInput.sourceSnapshotIds,
      assetRevisionIds: adoptionInput.assetRevisionIds, createdAt: now, createdBy: { kind: "agent" as const, id: runningRun.id }
    };
    const completedRun = siteAgentRunSchema.parse({ ...runningRun, status: "succeeded", stage: "candidate_ready", completedAt: now });
    const completedSession = siteAgentSessionSchema.parse({ ...session, status: "closed", publicBuildInputId: adoptionInput.id, updatedAt: now });
    const finalized = await repository.finalizeVerifiedAuthoring({
      finalizationKey: sha256("media-provenance-finalization"), revision: workspace, artifact, version: requestedVersion,
      run: completedRun, session: completedSession,
      mediaAdoption: { expectedBusinessRevision: 1, assetRevisions: closure, businessState: adoptionState, publicBuildInput: adoptionInput }
    });
    assert.deepEqual(finalized.version.assetRevisionIds, [ancestor.id, edited.id, sibling.id]);
    assert.deepEqual((await repository.getPublicBuildInput(adoptionInput.id))!.assetRevisionIds, [ancestor.id, edited.id, sibling.id]);
    assert.deepEqual((await repository.getBusinessState(input.businessId))!.assets.map((asset) => asset.revisionId), [edited.id, sibling.id]);
    assert(await repository.getAssetRevision(ancestor.id), "Finalization did not persist the provenance-only ancestor revision.");

    const researchSnapshot = sourceSnapshotSchema.parse({ schemaVersion: 1, id: "source_research_after_unused_media", businessId: input.businessId,
      sourceType: "website", sourceUrl: "https://northstar.example/research", contentHash: sha256("source-only-finalization"), capturedAt: now,
      payload: { kind: "website-mirror", fixture: "source-only-finalization" } });
    for (const sourceId of adoptionInput.sourceSnapshotIds) {
      if (await repository.getSourceSnapshot(sourceId)) continue;
      await repository.saveSourceSnapshot(sourceSnapshotSchema.parse({ schemaVersion: 1, id: sourceId, businessId: input.businessId,
        sourceType: "website", sourceUrl: `https://northstar.example/${sourceId}`, contentHash: sha256(sourceId), capturedAt: now,
        payload: { kind: "website-mirror", fixture: "retained-source-binding" } }));
    }
    await repository.saveSourceSnapshot(researchSnapshot);
    const { inputHash: _adoptionHash, id: _adoptionId, createdAt: _adoptionCreatedAt, sourceSnapshotIds: _adoptionSources, ...sourceInputBody } = adoptionInput;
    const preparedWithoutHash = {
      ...sourceInputBody, id: "input_source_only_finalization", createdAt: now,
      sourceSnapshotIds: [..._adoptionSources, researchSnapshot.id].sort()
    };
    const sourceInput = sitePublicBuildInputSchema.parse({ ...preparedWithoutHash, inputHash: sha256(stableJson(preparedWithoutHash)) });
    const sourceSession = siteAgentSessionSchema.parse({ ...session, id: "session_source_only_finalization", publicBuildInputId: adoptionInput.id });
    const sourceRun = siteAgentRunSchema.parse({ ...runningRun, id: "run_source_only_finalization", sessionId: sourceSession.id, publicBuildInputId: adoptionInput.id });
    await repository.saveAgentSession(sourceSession);
    await repository.saveAgentRun(sourceRun);
    const sourceWorkspace = siteWorkspaceRevisionSchema.parse({ ...workspace, id: "workspace_source_only_finalization", parentRevisionId: workspace.id, publicBuildInputId: sourceInput.id,
      sourceHash: sha256("source-only-finalization-workspace"), sourceArchiveKey: "workspace-backups/source-only-finalization.tar.gz", createdBy: { kind: "agent", id: sourceRun.id } });
    const sourceArtifact = siteBuildArtifactSchema.parse({ ...artifact, id: "artifact_source_only_finalization", workspaceRevisionId: sourceWorkspace.id,
      publicBuildInputId: sourceInput.id, artifactHash: sha256("source-only-finalization-artifact"), storagePrefix: "site-artifacts/source-only-finalization" });
    const sourceVersion = siteVersionSchema.parse({ ...requestedVersion, id: "version_source_only_finalization", artifactId: sourceArtifact.id,
      artifactHash: sourceArtifact.artifactHash, workspaceRevisionId: sourceWorkspace.id, publicBuildInputId: sourceInput.id,
      sourceSnapshotIds: sourceInput.sourceSnapshotIds, assetRevisionIds: sourceInput.assetRevisionIds, formDefinitionIds: sourceInput.forms.map((form) => form.id), createdBy: { kind: "agent", id: sourceRun.id } });
    const sourceFinalization = {
      finalizationKey: sha256("source-only-finalization"), revision: sourceWorkspace, artifact: sourceArtifact, version: sourceVersion,
      run: siteAgentRunSchema.parse({ ...sourceRun, publicBuildInputId: sourceInput.id, status: "succeeded", stage: "candidate_ready", completedAt: now }),
      session: siteAgentSessionSchema.parse({ ...sourceSession, publicBuildInputId: sourceInput.id, status: "closed", updatedAt: now }),
      sourceInputBinding: { expectedPublicBuildInputId: adoptionInput.id, publicBuildInput: sourceInput }
    };
    const sourceFinalized = await repository.finalizeVerifiedAuthoring(sourceFinalization);
    const sourceReplay = await repository.finalizeVerifiedAuthoring(sourceFinalization);
    assert.equal(sourceReplay.version.id, sourceFinalized.version.id, "Source-only finalization replay created a second version.");
    assert.equal(sourceReplay.run.id, sourceFinalized.run.id, "Source-only finalization replay changed the retained run.");
    assert.deepEqual(sourceFinalized.version.sourceSnapshotIds, sourceInput.sourceSnapshotIds, "Atomic finalization lost retained research source authority.");
    assert.equal((await repository.getSite(input.siteId))!.currentPublicBuildInputId, sourceInput.id);
    assert.equal((await repository.getBusinessState(input.businessId))!.revision, adoptionState.revision, "Source-only binding must not advance business revision.");
    assert.equal(await repository.getAssetRevision("asset_revision_discarded"), undefined, "Discarded media must not be adopted.");
    const nextResearch = sourceSnapshotSchema.parse({ ...researchSnapshot, id: "source_research_negative_binding", sourceUrl: "https://northstar.example/research-next", contentHash: sha256("source-only-negative") });
    await repository.saveSourceSnapshot(nextResearch);
    const rejectPreparedSourceBinding = async (label: string, mutate: (candidate: SitePublicBuildInput) => SitePublicBuildInput) => {
      const candidateBody = { ...sourceInput, id: `input_source_only_${label}`, sourceSnapshotIds: [...sourceInput.sourceSnapshotIds, nextResearch.id].sort() };
      const { inputHash: _candidateHash, ...candidateWithoutHash } = candidateBody;
      const candidate = mutate(sitePublicBuildInputSchema.parse({ ...candidateWithoutHash, inputHash: sha256(stableJson(candidateWithoutHash)) }));
      const rejectedSession = siteAgentSessionSchema.parse({ ...sourceSession, id: `session_source_only_${label}`, publicBuildInputId: candidate.id });
      const retainedRun = siteAgentRunSchema.parse({ ...sourceRun, id: `run_source_only_${label}`, sessionId: rejectedSession.id, publicBuildInputId: sourceInput.id });
      await repository.saveAgentSession(rejectedSession);
      await repository.saveAgentRun(retainedRun);
      const rejectedWorkspace = siteWorkspaceRevisionSchema.parse({ ...sourceWorkspace, id: `workspace_source_only_${label}`, parentRevisionId: sourceWorkspace.id,
        publicBuildInputId: candidate.id, sourceHash: sha256(`source-only-${label}`), sourceArchiveKey: `workspace-backups/source-only-${label}.tar.gz`, createdBy: { kind: "agent", id: retainedRun.id } });
      const rejectedArtifact = siteBuildArtifactSchema.parse({ ...sourceArtifact, id: `artifact_source_only_${label}`, workspaceRevisionId: rejectedWorkspace.id,
        publicBuildInputId: candidate.id, artifactHash: sha256(`source-only-artifact-${label}`), storagePrefix: `site-artifacts/source-only-${label}` });
      const rejectedVersion = siteVersionSchema.parse({ ...sourceVersion, id: `version_source_only_${label}`, artifactId: rejectedArtifact.id,
        artifactHash: rejectedArtifact.artifactHash, workspaceRevisionId: rejectedWorkspace.id, publicBuildInputId: candidate.id,
        sourceSnapshotIds: candidate.sourceSnapshotIds, assetRevisionIds: candidate.assetRevisionIds, formDefinitionIds: candidate.forms.map((form) => form.id), createdBy: { kind: "agent", id: retainedRun.id } });
      const inputsBefore = (await repository.listPublicBuildInputs()).length;
      await assert.rejects(() => repository.finalizeVerifiedAuthoring({
        finalizationKey: sha256(`source-only-${label}`), revision: rejectedWorkspace, artifact: rejectedArtifact, version: rejectedVersion,
        run: siteAgentRunSchema.parse({ ...retainedRun, publicBuildInputId: candidate.id, status: "succeeded", stage: "candidate_ready", completedAt: now }),
        session: siteAgentSessionSchema.parse({ ...rejectedSession, status: "closed", updatedAt: now }),
        sourceInputBinding: { expectedPublicBuildInputId: sourceInput.id, publicBuildInput: candidate }
      }), /stale_prepared_source_input/);
      assert.equal((await repository.listPublicBuildInputs()).length, inputsBefore, `${label} rejection persisted a prepared input.`);
      assert.equal((await repository.getSite(input.siteId))!.currentPublicBuildInputId, sourceInput.id, `${label} rejection changed the site input.`);
    };
    await rejectPreparedSourceBinding("owner_revision", (candidate) => {
      const { inputHash: _hash, ...body } = candidate;
      return sitePublicBuildInputSchema.parse({ ...body, ownerOperationalRevision: candidate.ownerOperationalRevision + 1, inputHash: sha256(stableJson({ ...body, ownerOperationalRevision: candidate.ownerOperationalRevision + 1 })) });
    });
    await rejectPreparedSourceBinding("intent_revision", (candidate) => {
      const { inputHash: _hash, ...body } = candidate;
      return sitePublicBuildInputSchema.parse({ ...body, ownerIntentRevision: candidate.ownerIntentRevision + 1, inputHash: sha256(stableJson({ ...body, ownerIntentRevision: candidate.ownerIntentRevision + 1 })) });
    });
    await rejectPreparedSourceBinding("changed_content", (candidate) => {
      const { inputHash: _hash, ...body } = candidate;
      const changed = { ...body, business: { ...candidate.business, name: "Changed fixture name" } };
      return sitePublicBuildInputSchema.parse({ ...changed, inputHash: sha256(stableJson(changed)) });
    });
    await rejectPreparedSourceBinding("invalid_hash", (candidate) => ({ ...candidate, inputHash: sha256("invalid-prepared-source-hash") }));
    await rejectPreparedSourceBinding("missing_source", (candidate) => {
      const { inputHash: _hash, ...body } = candidate;
      const missing = { ...body, sourceSnapshotIds: [...sourceInput.sourceSnapshotIds, "source_missing_finalization"].sort() };
      return sitePublicBuildInputSchema.parse({ ...missing, inputHash: sha256(stableJson(missing)) });
    });
    await rejectPreparedSourceBinding("reordered_sources", (candidate) => {
      const { inputHash: _hash, ...body } = candidate;
      const reordered = { ...body, sourceSnapshotIds: [...sourceInput.sourceSnapshotIds].reverse() };
      return sitePublicBuildInputSchema.parse({ ...reordered, inputHash: sha256(stableJson(reordered)) });
    });
    const currentState = (await repository.getBusinessState(input.businessId))!;
    const { stateHash: _priorStateHash, ...nextStateBody } = currentState;
    const advancedState = businessStateSchema.parse({ ...nextStateBody, revision: currentState.revision + 1,
      ownerOperationalRevision: currentState.ownerOperationalRevision + 1, updatedAt: now,
      stateHash: sha256(stableJson({ ...nextStateBody, revision: currentState.revision + 1, ownerOperationalRevision: currentState.ownerOperationalRevision + 1, updatedAt: now })) });
    await repository.saveBusinessState(advancedState);
    await rejectPreparedSourceBinding("current_owner_changed", (candidate) => candidate);
    const staleSession = siteAgentSessionSchema.parse({ ...sourceSession, id: "session_source_only_stale", publicBuildInputId: sourceInput.id });
    const staleRun = siteAgentRunSchema.parse({ ...sourceRun, id: "run_source_only_stale", sessionId: staleSession.id, publicBuildInputId: sourceInput.id });
    await repository.saveAgentSession(staleSession);
    await repository.saveAgentRun(staleRun);
    await assert.rejects(() => repository.finalizeVerifiedAuthoring({
      finalizationKey: sha256("source-only-finalization-stale"), revision: { ...sourceWorkspace, id: "workspace_source_only_stale", parentRevisionId: sourceWorkspace.id, sourceHash: sha256("stale") },
      artifact: { ...sourceArtifact, id: "artifact_source_only_stale", workspaceRevisionId: "workspace_source_only_stale", artifactHash: sha256("stale-artifact") },
      version: { ...sourceVersion, id: "version_source_only_stale", artifactId: "artifact_source_only_stale", workspaceRevisionId: "workspace_source_only_stale" },
      run: siteAgentRunSchema.parse({ ...staleRun, publicBuildInputId: sourceInput.id, status: "succeeded", stage: "candidate_ready", completedAt: now }),
      session: siteAgentSessionSchema.parse({ ...staleSession, publicBuildInputId: sourceInput.id, status: "closed", updatedAt: now }),
      sourceInputBinding: { expectedPublicBuildInputId: adoptionInput.id, publicBuildInput: sourceInput }
    }), /stale_prepared_source_input|stale_parent_revision/);
  } finally {
    await rm(provenanceDirectory, { recursive: true, force: true });
  }
}

function fixtureGeneratedRevision(id: string, sourceAssetRevisionIds: string[]): AssetRevision {
  return assetRevisionSchema.parse({
    schemaVersion: 1, id, assetId: id.replace("asset_revision_", "asset_"), businessId: "business_synthetic_verification",
    contentHash: sha256(id), storageKey: `site-assets/business_synthetic_verification/${id}`, mimeType: "image/webp",
    bytes: 16, width: 16, height: 16, origin: "platform_generated",
    provenance: { origin: "platform_generated", provider: "openai", model: imageCreationModel.id,
      action: sourceAssetRevisionIds.length ? "edit" : "generate", purpose: "background",
      prompt: "Fixture generated supporting image.", sourceAssetRevisionIds },
    createdAt: "2026-09-10T00:00:00.000Z"
  });
}

function fixtureAdoptedSourceRevision(id: string): AssetRevision {
  return assetRevisionSchema.parse({
    schemaVersion: 1, id, assetId: id.replace("asset_revision_", "asset_"), businessId: "business_synthetic_verification",
    contentHash: sha256(id), storageKey: `site-assets/business_synthetic_verification/${id}`, mimeType: "image/webp",
    bytes: 16, width: 16, height: 16, origin: "source_website",
    provenance: { origin: "source_website", sourceUrl: "https://northstar.example/source.webp",
      sourcePageUrl: "https://northstar.example/gallery", sourceSnapshotId: "source_owner", sourceResourceId: "resource_fixture_source" },
    createdAt: "2026-09-10T00:00:00.000Z"
  });
}

function fixtureGeneratedRef(revision: AssetRevision): AssetRevisionRef {
  return {
    assetId: revision.assetId, revisionId: revision.id, kind: "photo", contentHash: revision.contentHash,
    storageKey: revision.storageKey, mimeType: revision.mimeType, alt: "Fixture generated image", width: revision.width,
    height: revision.height, origin: revision.origin, sourceFactIds: [], activeForFutureBuilds: true
  };
}

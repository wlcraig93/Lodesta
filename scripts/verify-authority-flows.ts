import assert from "node:assert/strict";
import "./verify-owner-document-route";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicBuildInput, sha256, stableJson } from "../packages/business-data";
import { ControlPlaneService } from "../packages/control-plane";
import { LocalSitePlatformRepository } from "../packages/platform-data";
import {
  assetRevisionSchema,
  businessStateSchema,
  platformSiteRecordSchema,
  siteAgentMessageSchema,
  siteAgentRunSchema,
  siteAgentSessionSchema,
  siteVersionSchema,
  sourceSnapshotSchema,
  sourceSnapshotPageSchema,
  sourceSnapshotResourceSchema
} from "../packages/site-contracts";
import { deriveSiteCandidateIntegrity } from "../packages/site-platform/candidate-integrity";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { resolveApprovedSourceDocuments } from "../packages/business-data/owner-documents";

const directory = await mkdtemp(join(tmpdir(), "lodesta-authority-"));
try {
  const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
  const synthetic = buildSyntheticSiteInput();
  const ownerId = "00000000-0000-4000-8000-000000000001";
  const capturedAt = "2026-07-23T12:00:00.000Z";
  const websiteSnapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "source_website",
    businessId: synthetic.businessId,
    sourceType: "website",
    sourceUrl: "https://northstar.example/",
    contentHash: `sha256:${"1".repeat(64)}`,
    capturedAt,
    payload: { fixture: "website source authority" }
  });
  const retainedOwnerSnapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "source_owner",
    businessId: synthetic.businessId,
    sourceType: "owner_input",
    contentHash: `sha256:${"6".repeat(64)}`,
    capturedAt,
    payload: { fixture: true }
  });
  const nameFact = synthetic.publicFacts.find((fact) => fact.kind === "business_name")!;
  const assetRevision = assetRevisionSchema.parse({
    schemaVersion: 1,
    id: "asset_revision_reference",
    assetId: "asset_source_photo",
    businessId: synthetic.businessId,
    contentHash: `sha256:${"2".repeat(64)}`,
    storageKey: "site-assets/test/reference.webp",
    publicUrl: "https://assets.example/reference.webp",
    mimeType: "image/webp",
    bytes: 100,
    origin: "source_website",
    provenance: {
      origin: "source_website",
      sourceSnapshotId: websiteSnapshot.id,
      sourceUrl: "https://northstar.example/photo.webp",
      sourcePageUrl: "https://northstar.example/"
    },
    createdAt: capturedAt
  });
  const stateWithoutHash = {
    schemaVersion: 1 as const,
    businessId: synthetic.businessId,
    siteId: synthetic.siteId,
    revision: 1,
    ownerOperationalRevision: 1,
    updatedAt: capturedAt,
    identity: {
      name: synthetic.business.name,
      status: "provisional" as const,
      categories: ["auto body"]
    },
    contacts: synthetic.business.contacts,
    locations: synthetic.business.locations,
    serviceAreas: synthetic.business.serviceAreas,
    offerings: synthetic.business.offerings,
    proof: synthetic.business.proof,
    assets: [{
      assetId: assetRevision.assetId,
      revisionId: assetRevision.id,
      kind: "photo" as const,
      contentHash: assetRevision.contentHash,
      storageKey: assetRevision.storageKey,
      publicUrl: assetRevision.publicUrl,
      mimeType: assetRevision.mimeType,
      alt: "Northstar workshop",
      origin: "source_website" as const,
      sourceFactIds: [synthetic.publicFacts.find((fact) => fact.kind === "offering")!.id],
      activeForFutureBuilds: true
    }],
    links: synthetic.business.links,
    facts: synthetic.publicFacts.filter((fact) => fact.id !== nameFact.id)
  };
  const state = businessStateSchema.parse({
    ...stateWithoutHash,
    stateHash: sha256(stableJson(stateWithoutHash))
  });
  assert.throws(
    () => createPublicBuildInput({
      id: "input_non_us_rejected",
      state: {
        ...state,
        locations: state.locations.map((location) => ({ ...location, country: "CA" }))
      },
      intent: synthetic.intent,
      forms: synthetic.forms,
      sourceSnapshotIds: [websiteSnapshot.id],
      runtimeSeriesId: "site-runtime-v4"
    }),
    /supports US locations only/,
    "A non-US location crossed the public build-input boundary."
  );
  const buildInput = createPublicBuildInput({
    id: "input_authority",
    state,
    intent: synthetic.intent,
    forms: synthetic.forms,
    sourceSnapshotIds: [websiteSnapshot.id],
    runtimeSeriesId: "site-runtime-v4"
  });
  assert.deepEqual(
    buildInput.publicFacts.filter((fact) => fact.kind === "offering").map((fact) => fact.id).sort(),
    buildInput.business.offerings.flatMap((offering) => offering.sourceFactIds).sort(),
    "Unnormalized offering observations crossed the public-authority boundary."
  );
  assert.throws(
    () => createPublicBuildInput({
      id: "input_mismatched_offering",
      state: {
        ...state,
        offerings: state.offerings.map((offering) => ({ ...offering, name: "Unrelated invented service" }))
      },
      intent: synthetic.intent,
      forms: synthetic.forms,
      sourceSnapshotIds: [websiteSnapshot.id],
      runtimeSeriesId: "site-runtime-v4"
    }),
    /eligible canonical offering fact with the same name/,
    "A published offering diverged from its canonical source fact."
  );
  const site = platformSiteRecordSchema.parse({
    id: synthetic.siteId,
    ownerUserId: ownerId,
    sourceUrl: websiteSnapshot.sourceUrl,
    normalizedSource: websiteSnapshot.sourceUrl,
    businessId: synthetic.businessId,
    slug: "northstar-collision-repair",
    status: "draft",
    currentPublicBuildInputId: buildInput.id,
    createdAt: capturedAt,
    updatedAt: capturedAt
  });
  await repository.bootstrapSite({
    site,
    state,
    intent: synthetic.intent,
    forms: synthetic.forms,
    sourceSnapshots: [websiteSnapshot, retainedOwnerSnapshot],
    assetRevisions: [assetRevision],
    publicBuildInput: buildInput
  });
  await repository.createSiteVersion(siteVersionSchema.parse({
    schemaVersion: 1,
    id: "version_pre_identity",
    siteId: site.id,
    number: 1,
    status: "candidate",
    artifactId: "artifact_missing_for_readiness_test",
    artifactHash: `sha256:${"3".repeat(64)}`,
    workspaceRevisionId: "workspace_revision_test",
    publicBuildInputId: buildInput.id,
    ownerOperationalRevision: buildInput.ownerOperationalRevision,
    ownerIntentRevision: buildInput.ownerIntentRevision,
    formDefinitionIds: buildInput.forms.map((form) => form.id),
    sourceSnapshotIds: buildInput.sourceSnapshotIds,
    assetRevisionIds: buildInput.assetRevisionIds,
    createdAt: capturedAt,
    createdBy: { kind: "agent", id: "run_initial" }
  }));
  await repository.saveSourceSnapshot(sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "source_provisional_refresh",
    businessId: synthetic.businessId,
    sourceType: "website",
    sourceUrl: "https://northstar.example/services",
    contentHash: `sha256:${"7".repeat(64)}`,
    capturedAt: "2026-07-23T12:30:00.000Z",
    payload: { discovery: "A newer provisional crawl suggestion." }
  }));
  assert.equal(
    (await repository.getSiteVersion("version_pre_identity"))?.status,
    "candidate",
    "A provisional crawl refresh incorrectly staled a reviewed candidate."
  );
  const metadataOnlyRepository = new Proxy(repository, {
    get(target, property, receiver) {
      if (property === "listSourceSnapshotResources") {
        return async () => { throw new Error("candidate_integrity_must_not_enumerate_source_blobs"); };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const incompleteCandidateIntegrity = await deriveSiteCandidateIntegrity({
    versionId: "version_pre_identity",
    repository: metadataOnlyRepository,
    operationsRepository: { listRedirects: async () => [] } as never
  });
  assert.equal(incompleteCandidateIntegrity.status, "failed_integrity");
  assert(
    incompleteCandidateIntegrity.issues.some((issue) => issue.code === "artifact_integrity"),
    "Candidate metadata integrity did not catch a missing retained artifact manifest."
  );

  const queuedKinds: string[] = [];
  let preparedRunCount = 0;
  const workflow = {
    async prepareSession(input: { siteId: string; principal: { kind: "owner"; id: string }; buildInput?: typeof buildInput }) {
      return siteAgentSessionSchema.parse({
        schemaVersion: "site-agent-session",
        id: "session_authority_test",
        siteId: input.siteId,
        principal: input.principal,
        status: "active",
        publicBuildInputId: input.buildInput?.id ?? buildInput.id,
        sandboxProvider: "cloudflare",
        leaseTokenHash: `sha256:${"4".repeat(64)}`,
        leaseExpiresAt: "2026-07-23T13:00:00.000Z",
        rotateAt: "2026-07-23T14:00:00.000Z",
        createdAt: capturedAt,
        updatedAt: capturedAt
      });
    },
    async prepareRunDocuments(input: {
      session: ReturnType<typeof siteAgentSessionSchema.parse>;
      buildInput: typeof buildInput;
      kind: "initial_build" | "edit" | "rebase";
      instruction: string;
      requestedBy: string;
      request: { kind: "authority_refresh"; changeRequestIds: string[] };
      origin: "control_plane";
    }) {
      queuedKinds.push(input.kind);
      preparedRunCount += 1;
      const runId = `run_authority_${preparedRunCount}`;
      const messageId = `message_authority_${preparedRunCount}`;
      return {
        run: siteAgentRunSchema.parse({
          schemaVersion: "site-agent-run",
          id: runId,
          sessionId: input.session.id,
          siteId: input.session.siteId,
          publicBuildInputId: input.buildInput.id,
          request: input.request,
          origin: input.origin,
          requestedBy: input.requestedBy,
          kind: input.kind,
          status: "queued",
          stage: "queued",
          apiProvider: "openai",
          modelId: "gpt-5.2",
          executionNumber: 0,
          skillVersions: { manager: "test" },
          guardrails: {
            deadlineAt: "2026-07-23T13:00:00.000Z",
            maxCostUsd: 10,
            maxConsecutiveIdenticalFailures: 3
          },
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            costSource: "unavailable",
            upstreamInferenceCostUsd: 0,
            durationMs: 0
          },
          startedAt: capturedAt
        }),
        message: siteAgentMessageSchema.parse({
          schemaVersion: "site-agent-message",
          id: messageId,
          sessionId: input.session.id,
          runId,
          role: "owner",
          content: input.instruction,
          createdAt: capturedAt
        })
      };
    }
  };
  const service = new ControlPlaneService(repository, workflow as never);

  const confirmed = await service.submit({
    siteId: site.id,
    payload: { kind: "confirm_identity", name: synthetic.business.name },
    requestedBy: ownerId
  });
  assert.equal(queuedKinds[0], "edit", "identity confirmation did not queue canonical authoring");
  const verifiedState = (await repository.getBusinessState(site.businessId))!;
  assert.equal(verifiedState.identity.status, "verified");
  assert(verifiedState.facts.some((fact) => fact.kind === "business_name" && fact.source.ownerConfirmed));
  assert.equal((await repository.getSiteVersion("version_pre_identity"))?.status, "stale");
  const integrity = await deriveSiteCandidateIntegrity({
    versionId: "version_pre_identity",
    repository,
    operationsRepository: { listRedirects: async () => [] } as never
  });
  assert.equal(integrity.status, "stale_owner_authority");
  assert(integrity.issues.some((issue) => issue.code === "owner_authority_changed"));
  assert.equal(verifiedState.ownerOperationalRevision, 2);

  const sourceState = (await repository.getBusinessState(site.businessId))!;
  assert.equal(sourceState.assets[0]?.origin, "source_website");
  assert.equal(sourceState.assets[0]?.revisionId, assetRevision.id);

  const corrected = await service.submit({
    siteId: site.id,
    payload: { kind: "confirm_identity", name: "Northstar Auto & Collision" },
    requestedBy: ownerId
  });
  assert("run" in corrected && corrected.run?.kind === "edit", "identity correction did not queue a normal authoring edit");
  const currentInput = await repository.getPublicBuildInput((await repository.getSite(site.id))!.currentPublicBuildInputId!);
  assert(currentInput);
  await repository.createSiteVersion(siteVersionSchema.parse({
    schemaVersion: 1,
    id: "version_before_policy_change",
    siteId: site.id,
    number: 2,
    status: "candidate",
    artifactId: "artifact_policy_fixture",
    artifactHash: `sha256:${"8".repeat(64)}`,
    workspaceRevisionId: "workspace_policy_fixture",
    publicBuildInputId: currentInput.id,
    ownerOperationalRevision: currentInput.ownerOperationalRevision,
    ownerIntentRevision: currentInput.ownerIntentRevision,
    formDefinitionIds: currentInput.forms.map((form) => form.id),
    sourceSnapshotIds: currentInput.sourceSnapshotIds,
    assetRevisionIds: currentInput.assetRevisionIds,
    createdAt: capturedAt,
    createdBy: { kind: "agent", id: "run_policy_fixture" }
  }));
  const intentBeforePolicy = (await repository.getSiteIntent(site.id))!;
  const policyChange = await service.submit({
    siteId: site.id,
    payload: {
      kind: "update_agent_access_policy",
      policy: {
        search: "disallow",
        aiInput: "disallow",
        aiTrain: "disallow",
        trainingPermission: { status: "not_granted" }
      }
    },
    requestedBy: ownerId
  });
  assert("policyOnly" in policyChange && policyChange.policyOnly);
  const intentAfterPolicy = (await repository.getSiteIntent(site.id))!;
  assert.equal(intentAfterPolicy.revision, intentBeforePolicy.revision + 1);
  assert.equal(intentAfterPolicy.ownerIntentRevision, intentBeforePolicy.ownerIntentRevision);
  assert.equal((await repository.getSiteVersion("version_before_policy_change"))?.status, "candidate");

  const originalText = "Privacy Policy\nWe respond to inquiries using the information customers submit. Our previous website used preference storage. Unrelated commercial provisions remain in force.";
  const replacementText = "Privacy Policy\nWe respond to inquiries using the information customers submit. This website uses no persistent analytics browser storage. Unrelated commercial provisions remain in force.";
  const documentPage = sourceSnapshotPageSchema.parse({
    schemaVersion: 1, id: "source_page_privacy_authority", sourceSnapshotId: websiteSnapshot.id,
    resourceId: "resource_privacy_authority", requestedUrl: "https://northstar.example/privacy", path: "/privacy",
    outcome: "fetched", indexability: "indexable", title: "Privacy Policy", headings: ["Privacy Policy"],
    wordCount: 25, internalLinks: [], externalLinks: [], linkProminence: 1, extractedText: originalText,
    textContentHash: sha256(originalText), producer: "authority-fixture", inputHash: websiteSnapshot.contentHash, createdAt: capturedAt
  });
  await repository.saveSourceSnapshotResources([sourceSnapshotResourceSchema.parse({
    schemaVersion: 1, id: documentPage.resourceId, sourceSnapshotId: websiteSnapshot.id,
    requestedUrl: documentPage.requestedUrl, role: "document", outcome: "fetched", status: 200,
    finalUrl: documentPage.requestedUrl, captureKind: "http_response", contentType: "text/plain", storedEncoding: "identity",
    rawContentHash: sha256(originalText), blobContentHash: sha256(originalText), storageKey: "fixture/privacy.txt",
    rawBytes: Buffer.byteLength(originalText), storedBytes: Buffer.byteLength(originalText), headers: {},
    redirectChain: [], initiatorUrls: [], metadata: {}, capturedAt
  })]);
  await repository.saveSourceSnapshotPages([documentPage]);
  const documentChange = { kind: "replace_source_document" as const, sourceSnapshotId: websiteSnapshot.id,
    sourcePageId: documentPage.id, path: documentPage.path, sourceTextHash: documentPage.textContentHash,
    expectedDocumentHash: documentPage.textContentHash, replacementText };
  await assert.rejects(service.submit({ siteId: site.id, requestedBy: "not-the-owner", payload: documentChange }), /owner_document_owner_required/);
  const stateBeforeDocument = (await repository.getBusinessState(site.businessId))!;
  const inputBeforeDocument = (await repository.getPublicBuildInput((await repository.getSite(site.id))!.currentPublicBuildInputId!))!;
  const queuedBeforeDocument = queuedKinds.length;
  const proposedDocument = await service.submit({ siteId: site.id, requestedBy: ownerId, payload: documentChange });
  assert.equal(proposedDocument.applied, false);
  assert.equal(queuedKinds.length, queuedBeforeDocument, "A proposal must not queue authoring before owner approval.");
  await assert.rejects(service.decide({ requestId: proposedDocument.request.id, decision: "approve", decidedBy: "authorized_operator" }), /owner_document_owner_required/);
  const approvedDocument = await service.decide({ requestId: proposedDocument.request.id, decision: "approve", decidedBy: ownerId });
  assert(approvedDocument.applied && "run" in approvedDocument && approvedDocument.run?.kind === "edit");
  assert.equal(queuedKinds.length, queuedBeforeDocument + 1);
  const documentState = (await repository.getBusinessState(site.businessId))!;
  assert.equal(documentState.ownerOperationalRevision, stateBeforeDocument.ownerOperationalRevision + 1);
  assert.deepEqual(documentState.facts, stateBeforeDocument.facts, "Approved document prose must not become business facts.");
  const documentInput = (await repository.getPublicBuildInput((await repository.getSite(site.id))!.currentPublicBuildInputId!))!;
  const documentSnapshots = (await Promise.all(documentInput.sourceSnapshotIds.map(id => repository.getSourceSnapshot(id)))).filter(item => Boolean(item)) as import("../packages/site-contracts").SourceSnapshot[];
  assert.equal(resolveApprovedSourceDocuments({ buildInput: documentInput, snapshots: documentSnapshots, pages: [documentPage] })[0]?.text, replacementText);
  assert.deepEqual(resolveApprovedSourceDocuments({ buildInput: inputBeforeDocument, snapshots: documentSnapshots, pages: [documentPage] }), [], "An old input must not gain new document authority.");
  assert.equal((await repository.listSourceSnapshotPages(websiteSnapshot.id, documentPage.id))[0]?.extractedText, originalText);
  assert.deepEqual(await repository.getPublicBuildInput(inputBeforeDocument.id), inputBeforeDocument, "Prior immutable public input changed.");
  const staleDocument = await service.submit({ siteId: site.id, requestedBy: ownerId, payload: documentChange });
  await assert.rejects(service.decide({ requestId: staleDocument.request.id, decision: "approve", decidedBy: ownerId }), /owner_document_target_stale/);
  assert.equal(queuedKinds.length, queuedBeforeDocument + 1);
  const updatedDocument = await service.submit({ siteId: site.id, requestedBy: ownerId,
    payload: { ...documentChange, expectedDocumentHash: sha256(replacementText), replacementText: replacementText + " Contact us with questions." } });
  await service.decide({ requestId: updatedDocument.request.id, decision: "approve", decidedBy: ownerId });
  const latestDocumentInput = (await repository.getPublicBuildInput((await repository.getSite(site.id))!.currentPublicBuildInputId!))!;
  const latestDocumentSnapshots = (await Promise.all(latestDocumentInput.sourceSnapshotIds.map(id => repository.getSourceSnapshot(id)))).filter(item => Boolean(item)) as import("../packages/site-contracts").SourceSnapshot[];
  assert.equal(resolveApprovedSourceDocuments({ buildInput: latestDocumentInput, snapshots: latestDocumentSnapshots.reverse(), pages: [documentPage] })[0]?.text, replacementText + " Contact us with questions.", "Source ID/array order must not decide approval precedence.");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    provisionalIdentity: "pass",
    confirmIdentityAuthoring: "pass",
    correctionEdit: "pass",
    ownerAuthorityStaleness: "pass",
    agentPolicyAuthorityIsolation: "pass",
    provisionalRefreshNonStaling: "pass",
    sourceMediaWithoutAttestation: "pass",
    ownerDocumentApprovalAndPreservation: "pass"
  })}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

import assert from "node:assert/strict";
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
  siteAgentSessionSchema,
  siteVersionSchema,
  sourceSnapshotSchema
} from "../packages/site-contracts";
import { deriveSitePublicationReadiness } from "../packages/site-platform";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

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
    payload: { ingestion: { coverage: "complete", modelBlocks: [] } }
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
  const buildInput = createPublicBuildInput({
    id: "input_authority",
    state,
    intent: synthetic.intent,
    forms: synthetic.forms,
    domainContext: synthetic.domainContext,
    sourceSnapshotIds: [websiteSnapshot.id]
  });
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
    formDefinitionIds: buildInput.forms.map((form) => form.id),
    sourceSnapshotIds: buildInput.sourceSnapshotIds,
    assetRevisionIds: buildInput.assetRevisionIds,
    createdAt: capturedAt,
    createdBy: { kind: "agent", id: "run_initial" }
  }));

  const queuedKinds: string[] = [];
  const workflow = {
    async getOrCreateSession(input: { siteId: string; principal: { kind: "owner"; id: string }; buildInput?: typeof buildInput }) {
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
    async enqueueRun(input: { kind: string }) {
      queuedKinds.push(input.kind);
      return { id: `run_${queuedKinds.length}`, kind: input.kind };
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
  const readiness = await deriveSitePublicationReadiness({
    versionId: "version_pre_identity",
    repository,
    operationsRepository: { listRedirects: async () => [] } as never
  });
  assert(readiness.blockers.some((blocker) => blocker.code === "stale_input"));

  const sourceState = (await repository.getBusinessState(site.businessId))!;
  assert.equal(sourceState.assets[0]?.origin, "source_website");
  assert.equal(sourceState.assets[0]?.revisionId, assetRevision.id);

  const corrected = await service.submit({
    siteId: site.id,
    payload: { kind: "confirm_identity", name: "Northstar Auto & Collision" },
    requestedBy: ownerId
  });
  assert("run" in corrected && corrected.run?.kind === "edit", "identity correction did not queue a normal authoring edit");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    provisionalIdentity: "pass",
    confirmIdentityAuthoring: "pass",
    correctionEdit: "pass",
    stalePublicationInvariant: "pass",
    sourceMediaWithoutAttestation: "pass"
  })}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

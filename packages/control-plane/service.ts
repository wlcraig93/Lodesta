import { randomUUID } from "node:crypto";
import { createPublicBuildInput, sha256, stableJson } from "@/packages/business-data";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import { agenticSiteWorkflow, type AgenticSiteWorkflowV1 } from "@/packages/site-platform";
import {
  operatorQueueItemSchema,
  businessStateV3Schema,
  assetRevisionV1Schema,
  controlPlaneChangeRequestV2Schema,
  siteAgentSessionV1Schema,
  siteIntentV3Schema,
  sourceSnapshotV1Schema,
  type BusinessStateV3,
  type AssetRevisionV1,
  type ControlPlaneChangePayloadV2,
  type ControlPlaneChangeRequestV2,
  type SiteIntentV3,
  type SourceSnapshotV1
} from "@/packages/site-contracts";

export class ControlPlaneServiceV2 {
  constructor(
    private readonly repository: SitePlatformRepository = sitePlatformRepository,
    private readonly workflow: AgenticSiteWorkflowV1 = agenticSiteWorkflow
  ) {}

  async submit(input: { siteId: string; payload: ControlPlaneChangePayloadV2; requestedBy: string }) {
    const [site, existingState, existingIntent] = await Promise.all([
      this.repository.getSite(input.siteId),
      this.stateForSite(input.siteId),
      this.repository.getSiteIntent(input.siteId)
    ]);
    if (!site || !existingState || !existingIntent) throw new Error("Canonical site authorities were not found.");
    const policy = policyFor(input.payload.kind);
    const now = new Date().toISOString();
    let request = controlPlaneChangeRequestV2Schema.parse({
      schemaVersion: "control-plane-change-request-v2", id: id("change"), siteId: site.id, businessId: site.businessId,
      targetAuthority: policy.targetAuthority, payload: input.payload, impact: policy.impact, status: "pending",
      expectedBusinessRevision: existingState.revision, expectedIntentRevision: existingIntent.revision,
      requestedBy: input.requestedBy, requestedAt: now
    });
    await this.repository.saveControlPlaneChangeRequest(request);
    if (policy.reviewRequired) return { request, applied: false as const };
    return this.applyRequest(request, input.requestedBy);
  }

  async decide(input: { requestId: string; decision: "approve" | "reject"; decidedBy: string }) {
    const current = await this.repository.getControlPlaneChangeRequest(input.requestId);
    if (!current) throw new Error("Control-plane change request not found.");
    if (current.status !== "pending") throw new Error("Control-plane change request is no longer pending.");
    const decidedAt = new Date().toISOString();
    if (input.decision === "reject") {
      const rejected = controlPlaneChangeRequestV2Schema.parse({ ...current, status: "rejected", decidedBy: input.decidedBy, decidedAt });
      await this.repository.saveControlPlaneChangeRequest(rejected);
      return { request: rejected, applied: false as const };
    }
    const approved = controlPlaneChangeRequestV2Schema.parse({ ...current, status: "approved", decidedBy: input.decidedBy, decidedAt });
    await this.repository.saveControlPlaneChangeRequest(approved);
    return this.applyRequest(approved, input.decidedBy);
  }

  private async applyRequest(request: ControlPlaneChangeRequestV2, actorId: string) {
    const [site, state, intent] = await Promise.all([
      this.repository.getSite(request.siteId), this.stateForSite(request.siteId), this.repository.getSiteIntent(request.siteId)
    ]);
    if (!site || !state || !intent) throw new Error("Canonical site authorities were not found.");
    if (request.expectedBusinessRevision !== state.revision || request.expectedIntentRevision !== intent.revision) {
      const superseded = controlPlaneChangeRequestV2Schema.parse({ ...request, status: "superseded", failureReason: "Authority revision changed before apply." });
      await this.repository.saveControlPlaneChangeRequest(superseded);
      throw new Error("stale_control_plane_change");
    }

    let authorityApplied = false;
    try {
      if (request.payload.kind === "request_site_edit") {
        const session = await this.workflow.getOrCreateSession({ siteId: site.id, ownerId: actorId });
        const { run } = await this.workflow.preflightAndEnqueueApply({
          session, instruction: request.payload.instruction,
          selection: request.payload.selection, requestedBy: actorId
        });
        const applied = controlPlaneChangeRequestV2Schema.parse({ ...request, status: "applied", decidedBy: request.decidedBy ?? actorId, decidedAt: request.decidedAt ?? new Date().toISOString() });
        await this.repository.saveControlPlaneChangeRequest(applied);
        return { request: applied, applied: true as const, run };
      }

      const ownerSnapshot = await this.ownerInputSnapshot(request);
      let nextState = state;
      let nextIntent = intent;
      if (request.targetAuthority === "business_state") {
        let attestedAsset: AssetRevisionV1 | undefined;
        if (request.payload.kind === "attest_asset_rights") {
          const currentAsset = await this.repository.getAssetRevision(request.payload.assetRevisionId);
          if (!currentAsset || currentAsset.businessId !== state.businessId) throw new Error("Asset revision was not found.");
          attestedAsset = assetRevisionV1Schema.parse({
            ...currentAsset,
            id: id("asset_revision"),
            rightsStatus: "customer_granted",
            attestation: { attestedBy: actorId, attestedAt: new Date().toISOString(), statement: request.payload.statement },
            createdAt: new Date().toISOString()
          });
          await this.repository.saveAssetRevision(attestedAsset);
        }
        if (request.payload.kind === "register_asset") {
          if (request.payload.revision.businessId !== state.businessId || request.payload.asset.assetId !== request.payload.revision.assetId || request.payload.asset.revisionId !== request.payload.revision.id) {
            throw new Error("Registered asset does not belong to this business or revision.");
          }
          await this.repository.saveAssetRevision(request.payload.revision);
        }
        nextState = mutateBusinessState(state, request.payload, ownerSnapshot, attestedAsset);
        await this.repository.saveSourceSnapshot(ownerSnapshot);
        await this.repository.saveBusinessState(nextState);
        authorityApplied = true;
      } else if (request.targetAuthority === "site_intent" && request.payload.kind === "update_site_intent") {
        nextIntent = mutateSiteIntent(intent, request.payload.patch);
        await this.repository.saveSiteIntent(nextIntent);
        authorityApplied = true;
      } else if (request.targetAuthority === "site_intent" && request.payload.kind === "update_agent_access_policy") {
        nextIntent = mutateSiteIntent(intent, { agentAccessPolicy: request.payload.policy });
        await this.repository.saveSiteIntent(nextIntent);
        authorityApplied = true;
      }

      const currentInput = site.currentPublicBuildInputId ? await this.repository.getPublicBuildInput(site.currentPublicBuildInputId) : undefined;
      if (!currentInput) throw new Error("Current public build input was not found.");
      const buildInput = createPublicBuildInput({
        id: id("input"), state: nextState, intent: nextIntent, forms: currentInput.forms,
        domainContext: currentInput.domainContext,
        sourceSnapshotIds: [...currentInput.sourceSnapshotIds, ...(request.targetAuthority === "business_state" ? [ownerSnapshot.id] : [])],
        runtimeSeriesId: currentInput.capabilityConfiguration.trustedRuntimeSeries
      });
      await this.repository.savePublicBuildInput(buildInput);
      await this.repository.setCurrentPublicBuildInput(site.id, buildInput.id);
      let session = await this.workflow.getOrCreateSession({ siteId: site.id, ownerId: actorId, buildInput });
      session = siteAgentSessionV1Schema.parse({ ...session, publicBuildInputId: buildInput.id, updatedAt: new Date().toISOString() });
      await this.repository.saveAgentSession(session);
      const kind = request.impact === "deterministic" ? "rebase" as const : "page_edit" as const;
      const run = await this.workflow.enqueueRun({
        session, kind, instruction: instructionFor(request.payload), requestedBy: actorId,
        origin: "control_plane", deferBehindActive: true,
        publishAfterSuccess: false
      });
      const applied = controlPlaneChangeRequestV2Schema.parse({ ...request, status: "applied", decidedBy: request.decidedBy ?? actorId, decidedAt: request.decidedAt ?? new Date().toISOString() });
      await this.repository.saveControlPlaneChangeRequest(applied);
      return {
        request: applied,
        applied: true as const,
        run,
        autoPublish: false,
        deferred: Boolean(run.deferredUntilRunId)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = controlPlaneChangeRequestV2Schema.parse({ ...request, status: "failed", failureReason: message.length <= 2000 ? message : `${message.slice(0, 1980)}... [truncated]` });
      await this.repository.saveControlPlaneChangeRequest(failed);
      if (authorityApplied) {
        const now = new Date().toISOString();
        await this.repository.saveOperatorQueueItem(operatorQueueItemSchema.parse({
          schemaVersion: "operator-queue-item-v2",
          id: id("operator"), siteId: request.siteId, reason: "authority_publish_failure", severity: "urgent", status: "open",
          findings: [{
            requestId: request.id,
            targetAuthority: request.targetAuthority,
            message: "Confirmed canonical state was retained, but its replacement site version was not queued. Reconcile before publishing another candidate.",
            failure: error instanceof Error ? error.message : String(error)
          }],
          createdAt: now,
          updatedAt: now
        }));
      }
      throw error;
    }
  }

  private async stateForSite(siteId: string) {
    const site = await this.repository.getSite(siteId);
    return site ? this.repository.getBusinessState(site.businessId) : undefined;
  }

  private async ownerInputSnapshot(request: ControlPlaneChangeRequestV2): Promise<SourceSnapshotV1> {
    const now = new Date().toISOString();
    const payload = { requestId: request.id, requestedBy: request.requestedBy, change: request.payload };
    return sourceSnapshotV1Schema.parse({
      schemaVersion: "source-snapshot-v1", id: id("source"), businessId: request.businessId,
      sourceType: "owner_input", contentHash: sha256(stableJson(payload)), capturedAt: now, payload
    });
  }
}

export const controlPlaneService = new ControlPlaneServiceV2();

function policyFor(kind: ControlPlaneChangePayloadV2["kind"]): {
  targetAuthority: ControlPlaneChangeRequestV2["targetAuthority"];
  impact: ControlPlaneChangeRequestV2["impact"];
  reviewRequired: boolean;
} {
  switch (kind) {
    case "confirm_facts":
    case "update_contact":
    case "update_hours":
    case "attest_asset_rights": return { targetAuthority: "business_state", impact: "deterministic", reviewRequired: false };
    case "set_offering":
    case "add_offering":
    case "register_asset":
    case "set_asset_active": return { targetAuthority: "business_state", impact: "structural", reviewRequired: false };
    case "set_proof":
    case "update_external_link": return { targetAuthority: "business_state", impact: "reviewable", reviewRequired: true };
    case "update_site_intent": return { targetAuthority: "site_intent", impact: "structural", reviewRequired: false };
    case "update_agent_access_policy": return { targetAuthority: "site_intent", impact: "deterministic", reviewRequired: false };
    case "request_site_edit": return { targetAuthority: "workspace", impact: "structural", reviewRequired: false };
  }
}

function mutateBusinessState(state: BusinessStateV3, payload: ControlPlaneChangePayloadV2, source: SourceSnapshotV1, attestedAsset?: AssetRevisionV1) {
  const now = new Date().toISOString();
  const next = structuredClone(state);
  if (payload.kind === "confirm_facts") {
    const selected = new Set(payload.factIds);
    const found = next.facts.filter((fact) => selected.has(fact.id));
    if (found.length !== selected.size) throw new Error("One or more facts were not found.");
    if (found.some((fact) => fact.kind === "proof")) throw new Error("Proof must be reviewed through the proof-specific control-plane change.");
    for (const fact of found) {
      fact.source = { factId: fact.id, sourceSnapshotId: source.id, observedAt: now, confidence: 1, ownerConfirmed: true };
      fact.publicEligible = true;
    }
  } else if (payload.kind === "update_contact") {
    if (!payload.phone && !payload.email) throw new Error("A phone or email value is required.");
    if (payload.phone) { next.contacts.phone = payload.phone; upsertFact(next, "phone", "Phone", payload.phone, source, now); }
    if (payload.email) { next.contacts.email = payload.email; upsertFact(next, "email", "Email", payload.email, source, now); }
  } else if (payload.kind === "update_hours") {
    const location = next.locations.find((item) => item.id === payload.locationId);
    if (!location) throw new Error("Location was not found.");
    location.hours = payload.hours;
    upsertFact(next, "hours", `${location.label} hours`, payload.hours, source, now);
  } else if (payload.kind === "add_offering") {
    const name = payload.name.replace(/\s+/g, " ").trim();
    if (next.offerings.some((offering) => normalizedText(offering.name) === normalizedText(name))) {
      throw new Error("This service already exists.");
    }
    const factId = id("fact");
    next.facts.push({
      id: factId, kind: "offering", label: "Owner-confirmed service", value: name,
      source: { factId, sourceSnapshotId: source.id, observedAt: now, confidence: 1, ownerConfirmed: true },
      publicEligible: true
    });
    next.offerings.push({
      id: id("offering"),
      customName: name,
      name,
      status: "confirmed",
      visibility: "public",
      pageMode: payload.pageMode,
      featured: false,
      sourceFactIds: [factId],
      confirmedAt: now
    });
  } else if (payload.kind === "set_offering") {
    const offering = next.offerings.find((item) => item.id === payload.offeringId);
    if (!offering) throw new Error("Offering was not found.");
    offering.status = payload.enabled ? "confirmed" : "inactive";
    offering.visibility = payload.enabled ? "public" : "hidden";
    offering.pageMode = payload.enabled ? payload.pageMode : "none";
    offering.confirmedAt = payload.enabled ? now : undefined;
  } else if (payload.kind === "set_proof") {
    const proof = next.proof.find((item) => item.id === payload.proofId);
    if (!proof) throw new Error("Proof item was not found.");
    const proofFacts = proof.sourceFactIds.map((factId) => next.facts.find((fact) => fact.id === factId));
    if (proofFacts.some((fact) => !fact || fact.kind !== "proof")) throw new Error("Proof item has invalid source-fact provenance.");
    proof.status = payload.enabled ? "confirmed" : "inactive";
    proof.confirmedAt = payload.enabled ? now : undefined;
    for (const fact of proofFacts) {
      if (!fact) continue;
      fact.publicEligible = payload.enabled;
      if (payload.enabled) fact.source.ownerConfirmed = true;
    }
  } else if (payload.kind === "set_asset_active") {
    const asset = next.assets.find((item) => item.assetId === payload.assetId);
    if (!asset) throw new Error("Asset was not found.");
    asset.activeForFutureBuilds = payload.active;
  } else if (payload.kind === "register_asset") {
    if (next.assets.some((asset) => asset.assetId === payload.asset.assetId || asset.revisionId === payload.asset.revisionId)) {
      throw new Error("Asset is already registered.");
    }
    next.assets.push(payload.asset);
  } else if (payload.kind === "attest_asset_rights") {
    if (!attestedAsset) throw new Error("Attested asset revision is required.");
    const asset = next.assets.find((item) => item.revisionId === payload.assetRevisionId);
    if (!asset) throw new Error("Asset reference was not found.");
    asset.revisionId = attestedAsset.id;
    asset.rightsStatus = "customer_granted";
    asset.activeForFutureBuilds = true;
  } else if (payload.kind === "update_external_link") {
    const link = next.links.find((item) => item.id === payload.linkId);
    if (!link) throw new Error("External link was not found.");
    link.url = payload.url;
    link.publicEligible = true;
    upsertFact(next, "link", link.label, payload.url, source, now);
  } else {
    throw new Error("Change payload does not target business state.");
  }
  next.revision = state.revision + 1;
  next.updatedAt = now;
  const { stateHash: _oldHash, ...withoutHash } = next;
  next.stateHash = sha256(stableJson(withoutHash));
  return businessStateV3Schema.parse(next);
}

function upsertFact(
  state: BusinessStateV3,
  kind: BusinessStateV3["facts"][number]["kind"],
  label: string,
  value: unknown,
  source: SourceSnapshotV1,
  now: string
) {
  const fact = state.facts.find((item) => item.kind === kind);
  const sourceRef = { factId: fact?.id ?? id("fact"), sourceSnapshotId: source.id, observedAt: now, confidence: 1, ownerConfirmed: true };
  if (fact) {
    fact.label = label; fact.value = value; fact.source = { ...sourceRef, factId: fact.id }; fact.publicEligible = true;
  } else {
    state.facts.push({ id: sourceRef.factId, kind, label, value, source: sourceRef, publicEligible: true });
  }
}

function mutateSiteIntent(intent: SiteIntentV3, patch: Partial<SiteIntentV3>) {
  const next = { ...intent, ...patch, revision: intent.revision + 1, updatedAt: new Date().toISOString() };
  const { intentHash: _oldHash, ...withoutHash } = next;
  next.intentHash = sha256(stableJson(withoutHash));
  return siteIntentV3Schema.parse(next);
}

function instructionFor(payload: ControlPlaneChangePayloadV2) {
  switch (payload.kind) {
    case "confirm_facts": return "Recompile the existing design against the owner-confirmed business facts.";
    case "update_contact": return "Recompile the existing design against the confirmed contact update.";
    case "update_hours": return "Recompile the existing design against the confirmed hours update.";
    case "add_offering": return `Add the owner-confirmed ${payload.name} service throughout the site and create the requested page architecture.`;
    case "set_offering": return `${payload.enabled ? "Add or update" : "Remove"} the selected service throughout the site and page architecture.`;
    case "set_proof": return `${payload.enabled ? "Add" : "Remove"} the selected verified proof item without inventing claims.`;
    case "set_asset_active": return `${payload.active ? "Incorporate" : "Remove"} the selected asset while preserving the site's visual quality.`;
    case "register_asset": return "Incorporate the newly uploaded owner-approved asset while preserving the site's visual quality.";
    case "attest_asset_rights": return "Recompile the existing design against the owner-attested asset revision.";
    case "update_external_link": return "Apply the approved external-link update.";
    case "update_site_intent": return "Update the website to reflect the approved site-intent change.";
    case "update_agent_access_policy": return "Re-finalize the existing verified artifact with the owner-recorded agent access policy.";
    case "request_site_edit": return payload.instruction;
  }
}

function id(prefix: string) { return `${prefix}_${randomUUID().replaceAll("-", "")}`; }

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

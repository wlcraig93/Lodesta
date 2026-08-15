import { randomUUID } from "node:crypto";
import { createPublicBuildInput, sha256, stableJson } from "@/packages/business-data";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow, type SiteAuthoringWorkflow } from "@/packages/site-platform/workflow";
import {
  businessStateSchema,
  controlPlaneChangeRequestSchema,
  siteAgentSessionSchema,
  siteIntentSchema,
  sourceSnapshotSchema,
  type BusinessState,
  type ControlPlaneChangePayload,
  type ControlPlaneChangeRequest,
  type SiteIntent,
  type SourceSnapshot
} from "@/packages/site-contracts";

export class ControlPlaneService {
  constructor(
    private readonly repository: SitePlatformRepository = sitePlatformRepository,
    private readonly workflow: SiteAuthoringWorkflow = siteAuthoringWorkflow
  ) {}

  async submit(input: { siteId: string; payload: ControlPlaneChangePayload; requestedBy: string }) {
    const [site, existingState, existingIntent] = await Promise.all([
      this.repository.getSite(input.siteId),
      this.stateForSite(input.siteId),
      this.repository.getSiteIntent(input.siteId)
    ]);
    if (!site || !existingState || !existingIntent) throw new Error("Canonical site authorities were not found.");
    const policy = policyFor(input.payload.kind);
    const now = new Date().toISOString();
    let request = controlPlaneChangeRequestSchema.parse({
      schemaVersion: "control-plane-change-request", id: id("change"), siteId: site.id, businessId: site.businessId,
      targetAuthority: policy.targetAuthority, payload: input.payload, impact: policy.impact, status: "pending",
      expectedBusinessRevision: existingState.revision, expectedIntentRevision: existingIntent.revision,
      requestedBy: input.requestedBy, requestedAt: now
    });
    if (policy.reviewRequired) {
      await this.repository.saveControlPlaneChangeRequest(request);
      return { request, applied: false as const };
    }
    return this.applyRequest(request, input.requestedBy);
  }

  async decide(input: { requestId: string; decision: "approve" | "reject"; decidedBy: string }) {
    const current = await this.repository.getControlPlaneChangeRequest(input.requestId);
    if (!current) throw new Error("Control-plane change request not found.");
    if (current.status !== "pending") throw new Error("Control-plane change request is no longer pending.");
    const decidedAt = new Date().toISOString();
    if (input.decision === "reject") {
      const rejected = controlPlaneChangeRequestSchema.parse({ ...current, status: "rejected", decidedBy: input.decidedBy, decidedAt });
      await this.repository.saveControlPlaneChangeRequest(rejected);
      return { request: rejected, applied: false as const };
    }
    const approved = controlPlaneChangeRequestSchema.parse({ ...current, status: "approved", decidedBy: input.decidedBy, decidedAt });
    return this.applyRequest(approved, input.decidedBy);
  }

  private async applyRequest(request: ControlPlaneChangeRequest, actorId: string) {
    const [site, state, intent] = await Promise.all([
      this.repository.getSite(request.siteId), this.stateForSite(request.siteId), this.repository.getSiteIntent(request.siteId)
    ]);
    if (!site || !state || !intent) throw new Error("Canonical site authorities were not found.");
    if (request.expectedBusinessRevision !== state.revision || request.expectedIntentRevision !== intent.revision) {
      const superseded = controlPlaneChangeRequestSchema.parse({ ...request, status: "superseded", failureReason: "Authority revision changed before apply." });
      await this.repository.saveControlPlaneChangeRequest(superseded);
      throw new Error("stale_control_plane_change");
    }

    try {
      const applied = controlPlaneChangeRequestSchema.parse({
        ...request,
        status: "applied",
        decidedBy: request.decidedBy ?? actorId,
        decidedAt: request.decidedAt ?? new Date().toISOString()
      });
      if (request.payload.kind === "request_site_edit") {
        const currentInput = site.currentPublicBuildInputId
          ? await this.repository.getPublicBuildInput(site.currentPublicBuildInputId)
          : undefined;
        if (!currentInput) throw new Error("Current public build input was not found.");
        const session = await this.workflow.prepareSession({
          siteId: site.id,
          principal: { kind: "owner", id: request.requestedBy },
          buildInput: currentInput
        });
        const prepared = await this.workflow.prepareRunDocuments({
          session,
          buildInput: currentInput,
          kind: site.currentWorkspaceRevisionId ? "edit" : "initial_build",
          instruction: request.payload.instruction,
          selection: request.payload.selection,
          requestedBy: request.requestedBy,
          request: { kind: "owner_instruction" },
          origin: "owner_request"
        });
        const committed = await this.repository.applyPreparedAuthorityChange({
          actorId,
          request: applied,
          session,
          run: prepared.run,
          message: prepared.message
        });
        return { request: committed.request, applied: true as const, run: committed.run! };
      }

      const ownerSnapshot = request.targetAuthority === "business_state"
        ? await this.ownerInputSnapshot(request)
        : undefined;
      let nextState = state;
      let nextIntent = intent;
      if (request.targetAuthority === "business_state") {
        if (request.payload.kind === "register_asset") {
          if (request.payload.revision.businessId !== state.businessId || request.payload.asset.assetId !== request.payload.revision.assetId || request.payload.asset.revisionId !== request.payload.revision.id) {
            throw new Error("Registered asset does not belong to this business or revision.");
          }
        }
        if (!ownerSnapshot) throw new Error("Owner source snapshot was not prepared.");
        nextState = mutateBusinessState(state, request.payload, ownerSnapshot);
      } else if (request.targetAuthority === "site_intent" && request.payload.kind === "update_site_intent") {
        nextIntent = mutateSiteIntent(intent, request.payload.patch, true);
      } else if (request.targetAuthority === "site_intent" && request.payload.kind === "update_agent_access_policy") {
        nextIntent = mutateSiteIntent(intent, { agentAccessPolicy: request.payload.policy }, false);
        const committed = await this.repository.applyPreparedAuthorityChange({
          actorId,
          request: applied,
          siteIntent: nextIntent
        });
        return { request: committed.request, applied: true as const, policyOnly: true as const };
      }

      const currentInput = site.currentPublicBuildInputId ? await this.repository.getPublicBuildInput(site.currentPublicBuildInputId) : undefined;
      if (!currentInput) throw new Error("Current public build input was not found.");
      const buildInput = createPublicBuildInput({
        id: id("input"), state: nextState, intent: nextIntent, forms: currentInput.forms,
        sourceSnapshotIds: [
          ...currentInput.sourceSnapshotIds,
          ...(ownerSnapshot ? [ownerSnapshot.id] : [])
        ],
        runtimeSeriesId: currentInput.capabilityConfiguration.trustedRuntimeSeries
      });
      let session = await this.workflow.prepareSession({
        siteId: site.id,
        principal: { kind: "owner", id: request.requestedBy },
        buildInput
      });
      session = siteAgentSessionSchema.parse({ ...session, publicBuildInputId: buildInput.id, updatedAt: new Date().toISOString() });
      const identityCorrected = request.payload.kind === "confirm_identity"
        && normalizedText(request.payload.name) !== normalizedText(state.identity.name);
      const kind = request.impact === "deterministic" && !identityCorrected ? "rebase" as const : "edit" as const;
      const prepared = await this.workflow.prepareRunDocuments({
        session,
        buildInput,
        kind,
        instruction: instructionFor(request.payload),
        requestedBy: request.requestedBy,
        request: { kind: "authority_refresh", changeRequestIds: [request.id] },
        origin: "control_plane", deferBehindActive: true
      });
      const committed = await this.repository.applyPreparedAuthorityChange({
        actorId,
        request: applied,
        sourceSnapshot: ownerSnapshot,
        assetRevision: request.payload.kind === "register_asset" ? request.payload.revision : undefined,
        businessState: nextState !== state ? nextState : undefined,
        siteIntent: nextIntent !== intent ? nextIntent : undefined,
        publicBuildInput: buildInput,
        session,
        run: prepared.run,
        message: prepared.message
      });
      return {
        request: committed.request,
        applied: true as const,
        run: committed.run!,
        autoPublish: false,
        deferred: Boolean(committed.run?.deferredUntilRunId)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = controlPlaneChangeRequestSchema.parse({ ...request, status: "failed", failureReason: message.length <= 2000 ? message : `${message.slice(0, 1980)}... [truncated]` });
      await this.repository.saveControlPlaneChangeRequest(failed);
      throw error;
    }
  }

  private async stateForSite(siteId: string) {
    const site = await this.repository.getSite(siteId);
    return site ? this.repository.getBusinessState(site.businessId) : undefined;
  }

  private async ownerInputSnapshot(request: ControlPlaneChangeRequest, details?: Record<string, unknown>): Promise<SourceSnapshot> {
    const now = new Date().toISOString();
    const payload = { requestId: request.id, requestedBy: request.requestedBy, change: request.payload, ...details };
    return sourceSnapshotSchema.parse({
      schemaVersion: 1, id: id("source"), businessId: request.businessId,
      sourceType: "owner_input", contentHash: sha256(stableJson(payload)), capturedAt: now, payload
    });
  }
}

export const controlPlaneService = new ControlPlaneService();

function policyFor(kind: ControlPlaneChangePayload["kind"]): {
  targetAuthority: ControlPlaneChangeRequest["targetAuthority"];
  impact: ControlPlaneChangeRequest["impact"];
  reviewRequired: boolean;
} {
  switch (kind) {
    case "confirm_facts":
    case "confirm_identity":
    case "update_contact":
    case "update_hours":
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

function mutateBusinessState(state: BusinessState, payload: ControlPlaneChangePayload, source: SourceSnapshot) {
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
  } else if (payload.kind === "confirm_identity") {
    const name = payload.name.replace(/\s+/g, " ").trim();
    next.identity.name = name;
    next.identity.status = "verified";
    upsertFact(next, "business_name", "Business name", name, source, now);
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
      name,
      description: payload.description,
      status: "confirmed",
      visibility: "public",
      sourceFactIds: [factId],
      confirmedAt: now
    });
  } else if (payload.kind === "set_offering") {
    const offering = next.offerings.find((item) => item.id === payload.offeringId);
    if (!offering) throw new Error("Offering was not found.");
    offering.status = payload.enabled ? "confirmed" : "inactive";
    offering.visibility = payload.enabled ? "public" : "hidden";
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
  next.ownerOperationalRevision = state.ownerOperationalRevision + 1;
  next.updatedAt = now;
  const { stateHash: _oldHash, ...withoutHash } = next;
  next.stateHash = sha256(stableJson(withoutHash));
  return businessStateSchema.parse(next);
}

function upsertFact(
  state: BusinessState,
  kind: BusinessState["facts"][number]["kind"],
  label: string,
  value: unknown,
  source: SourceSnapshot,
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

function mutateSiteIntent(intent: SiteIntent, patch: Partial<SiteIntent>, advanceOwnerAuthority: boolean) {
  const next = {
    ...intent,
    ...patch,
    revision: intent.revision + 1,
    ownerIntentRevision: intent.ownerIntentRevision + (advanceOwnerAuthority ? 1 : 0),
    updatedAt: new Date().toISOString()
  };
  const { intentHash: _oldHash, ...withoutHash } = next;
  next.intentHash = sha256(stableJson(withoutHash));
  return siteIntentSchema.parse(next);
}

function instructionFor(payload: ControlPlaneChangePayload) {
  switch (payload.kind) {
    case "confirm_facts": return "Recompile the existing design against the owner-confirmed business facts.";
    case "confirm_identity": return "Use BusinessName for every visible identity mention and update the website to the owner-confirmed business name.";
    case "update_contact": return "Recompile the existing design against the confirmed contact update.";
    case "update_hours": return "Recompile the existing design against the confirmed hours update.";
    case "add_offering": return `Reflect the owner-confirmed ${payload.name} service wherever it is useful. Decide whether any route change improves the site; service confirmation alone does not require a page.`;
    case "set_offering": return `${payload.enabled ? "Reflect" : "Remove"} the selected service wherever relevant. Preserve or change routes based on the site's information architecture, not the offering record alone.`;
    case "set_proof": return `${payload.enabled ? "Add" : "Remove"} the selected verified proof item without inventing claims.`;
    case "set_asset_active": return `${payload.active ? "Incorporate" : "Remove"} the selected asset while preserving the site's visual quality.`;
    case "register_asset": return "Incorporate the newly uploaded owner asset while preserving the site's visual quality.";
    case "update_external_link": return "Apply the approved external-link update.";
    case "update_site_intent": return "Update the website to reflect the approved site-intent change.";
    case "update_agent_access_policy": return "Apply the owner-recorded agent access policy.";
    case "request_site_edit": return payload.instruction;
  }
}

function id(prefix: string) { return `${prefix}_${randomUUID().replaceAll("-", "")}`; }

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

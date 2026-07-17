import { createHash } from "node:crypto";
import {
  applyBusinessStateChange,
  applyCopyOverrides,
  applySiteIntentChange,
  changeImpact,
  createControlPlaneChangeRequest,
  createGenerationInputSnapshot,
  resolveAssets,
  resolveBusinessSnapshot,
  requiredPublicEligibilityFactIds,
  staleCopyEvidence,
  validateControlPlaneChange
} from "./control-plane";
import type {
  ControlPlaneChangePayloadV1,
  ControlPlaneChangeRequestV1,
  FormDefinitionV1,
  GenerationInputSnapshotV1
} from "./control-plane-contracts";
import type { LodestaRepository } from "./repository";
import { verticalPackFor } from "./vertical-packs";
import { compileSite } from "./site-compiler";
import { generationQaFromObjectiveGate, runObjectiveGenerationGate } from "./generation-objective-gate";
import { siteRenderEnvelopeFromSnapshot } from "./site-render-envelope";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import type { SiteArtifactRecord, SiteVersionV3 } from "./models";

type ControlPlaneRepository = Pick<
  LodestaRepository,
  | "getCanonicalControlPlane"
  | "persistCanonicalGenerationInput"
  | "saveControlPlaneChangeRequest"
  | "listControlPlaneChangeRequests"
  | "getSiteBundle"
  | "saveSiteVersion"
  | "publishVersion"
  | "upsertSiteArtifact"
  | "enqueueJob"
>;

export type ControlPlaneChangeOutcome = {
  request: ControlPlaneChangeRequestV1;
  impact: ReturnType<typeof changeImpact>;
  applied: boolean;
  publish: "not_applicable" | "published" | "qa_failed" | "structural_candidate_queued";
  jobId?: string;
  detail?: string;
};

export async function submitControlPlaneChange(input: {
  repository: ControlPlaneRepository;
  siteId: string;
  payload: ControlPlaneChangePayloadV1;
  requestedBy: string;
  requireReview?: boolean;
}): Promise<ControlPlaneChangeOutcome> {
  const controlPlane = await input.repository.getCanonicalControlPlane(input.siteId);
  if (!controlPlane) throw new Error("Canonical control plane was not found for this site.");
  await assertValidPayload(input.payload, controlPlane.state);
  const request = createControlPlaneChangeRequest({
    businessId: controlPlane.state.business.id,
    siteId: input.siteId,
    payload: input.payload,
    requestedBy: input.requestedBy
  });
  await input.repository.saveControlPlaneChangeRequest(request);
  if (input.requireReview || input.payload.kind === "set_external_link") {
    return { request, impact: changeImpact(input.payload), applied: false, publish: "not_applicable" };
  }
  return applyApprovedChange(input.repository, request);
}

export async function decideControlPlaneChange(input: {
  repository: ControlPlaneRepository;
  siteId: string;
  requestId: string;
  decision: "approve" | "reject";
  decidedBy: string;
}) {
  const request = (await input.repository.listControlPlaneChangeRequests(input.siteId)).find((item) => item.id === input.requestId);
  if (!request) throw new Error("Control-plane change request was not found.");
  if (request.status !== "pending") throw new Error("Only pending control-plane changes can be decided.");
  const decidedAt = new Date().toISOString();
  if (input.decision === "reject") {
    const rejected = { ...request, status: "rejected" as const, decidedBy: input.decidedBy, decidedAt };
    await input.repository.saveControlPlaneChangeRequest(rejected);
    return { request: rejected, impact: changeImpact(request.payload), applied: false, publish: "not_applicable" as const };
  }
  const approved = { ...request, status: "approved" as const, decidedBy: input.decidedBy, decidedAt };
  await input.repository.saveControlPlaneChangeRequest(approved);
  return applyApprovedChange(input.repository, approved);
}

async function applyApprovedChange(repository: ControlPlaneRepository, request: ControlPlaneChangeRequestV1): Promise<ControlPlaneChangeOutcome> {
  const controlPlane = await repository.getCanonicalControlPlane(request.siteId);
  if (!controlPlane) throw new Error("Canonical control plane was not found while applying the change.");
  const now = new Date().toISOString();
  let state = controlPlane.state;
  let siteIntent = controlPlane.siteIntent;
  let formDefinition = controlPlane.latestSnapshot.formDefinition;
  try {
    if (request.targetAuthority === "business_state") {
      state = applyBusinessStateChange(state, request.payload, request.decidedBy ?? request.requestedBy, now);
    } else {
      siteIntent = applySiteIntentChange(siteIntent, request.payload, request.decidedBy ?? request.requestedBy, now);
      if (request.payload.kind === "set_form_definition") {
        formDefinition = formDefinitionForChange(request.siteId, request.payload, now);
        siteIntent.formDefinitionId = formDefinition.id;
      }
    }
    const eligibilityMode = request.payload.kind === "confirm_business_snapshot" && request.payload.publicEligibility
      ? "public" as const
      : controlPlane.latestSnapshot.eligibilityMode;
    const business = resolveBusinessSnapshot({
      state,
      siteId: request.siteId,
      eligibilityMode,
      resolvedAt: now
    });
    const snapshot = createGenerationInputSnapshot({
      business,
      siteIntent,
      assets: resolveAssets(state),
      evidenceManifest: controlPlane.latestSnapshot.evidenceManifest,
      formDefinition,
      brandExpression: controlPlane.latestSnapshot.brandExpression,
      brandAssessment: controlPlane.latestSnapshot.brandAssessment,
      businessUnderstanding: controlPlane.latestSnapshot.businessUnderstanding,
      sourceSnapshotIds: controlPlane.latestSnapshot.sourceSnapshotIds,
      verticalPack: controlPlane.latestSnapshot.verticalPack,
      eligibilityMode,
      createdAt: now
    });
    await repository.persistCanonicalGenerationInput({
      state,
      siteIntent,
      sourceSnapshots: controlPlane.sourceSnapshots,
      observations: controlPlane.observations,
      snapshot
    });
    const applied = {
      ...request,
      status: "applied" as const,
      decidedBy: request.decidedBy ?? request.requestedBy,
      decidedAt: request.decidedAt ?? now
    };
    await repository.saveControlPlaneChangeRequest(applied);
    const impact = changeImpact(request.payload);
    if (impact === "structural") return queueStructuralCandidate(repository, applied, snapshot.id);
    return deterministicRecompile(repository, applied, controlPlane.latestSnapshot, snapshot);
  } catch (error) {
    const failed = {
      ...request,
      status: "failed" as const,
      failureReason: error instanceof Error ? error.message : String(error),
      decidedBy: request.decidedBy ?? request.requestedBy,
      decidedAt: request.decidedAt ?? now
    };
    await repository.saveControlPlaneChangeRequest(failed);
    throw error;
  }
}

async function deterministicRecompile(
  repository: ControlPlaneRepository,
  request: ControlPlaneChangeRequestV1,
  previousSnapshot: GenerationInputSnapshotV1,
  snapshot: GenerationInputSnapshotV1
): Promise<ControlPlaneChangeOutcome> {
  const bundle = await repository.getSiteBundle(request.siteId);
  const storedPlan = bundle?.presenceAssessment.generationPlan;
  const storedCopy = bundle?.presenceAssessment.siteCopy;
  if (!bundle || !storedPlan || !storedCopy) {
    return queueStructuralCandidate(repository, request, snapshot.id, "Stored plan or copy is unavailable; deterministic recompile escalated to structural regeneration.");
  }
  const plan = {
    ...structuredClone(storedPlan),
    formId: snapshot.formDefinition.id,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "control-plane-plan-recompile",
      producerVersion: "generation-plan-control-plane-v1",
      inputs: { storedPlan, inputSnapshotId: snapshot.id, formDefinitionId: snapshot.formDefinition.id }
    })
  };
  const copy = {
    ...applyCopyOverrides(storedCopy, snapshot.siteIntent),
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "control-plane-copy-recompile",
      producerVersion: "site-copy-control-plane-v1",
      inputs: { storedCopy, inputSnapshotId: snapshot.id, copyOverrides: snapshot.siteIntent.copyOverrides }
    })
  };
  const staleEvidence = staleCopyEvidence({
    copy,
    evidence: snapshot.evidenceManifest,
    eligibleEvidenceIds: snapshot.business.proof.flatMap((item) => item.evidenceIds)
  });
  const contradicted = copyContradictions(previousSnapshot, snapshot, copy.slots.map((slot) => slot.value));
  if (staleEvidence.length || contradicted.length) {
    return queueStructuralCandidate(
      repository,
      request,
      snapshot.id,
      `Stored copy requires regeneration (${[...staleEvidence.map((item) => item.slotId), ...contradicted].join(", ")}).`
    );
  }
  const version = compileSite({ snapshot, plan, copy });
  const gate = await runObjectiveGenerationGate({
    snapshot,
    version,
    plan,
    copy,
    qaRunId: `qa_control_${request.id}`,
    captureScreenshots: true
  });
  const renderBundle = siteRenderEnvelopeFromSnapshot({ snapshot, version, plan, copy });
  version.generationQa = generationQaFromObjectiveGate(renderBundle, version, gate);
  const reviewArtifact = deterministicReviewArtifact(request, gate, snapshot.createdAt);
  const compiledArtifacts = deterministicCompileArtifacts(request.siteId, snapshot, plan, copy, gate.status);
  for (const artifact of [...compiledArtifacts, reviewArtifact]) await repository.upsertSiteArtifact(artifact);
  if (gate.status !== "pass") {
    return {
      request,
      impact: "deterministic",
      applied: true,
      publish: "qa_failed",
      detail: "Canonical state was retained, but the replacement version failed objective QA and was not published."
    };
  }
  const sourceVersion = bundle.siteModel.versions.find((candidate) => candidate.status === "draft") ?? bundle.siteModel.versions[0];
  version.artifactRefs = [
    ...(sourceVersion && sourceVersion.rendererVersion === "layout-v3"
      ? (sourceVersion as SiteVersionV3).artifactRefs.filter((reference) => !["generation_input_snapshot", "generation_plan", "site_copy", "generation_review"].includes(reference.artifactType))
      : []),
    ...[...compiledArtifacts, reviewArtifact].map((artifact) => ({
      artifactId: artifact.id,
      artifactType: artifact.artifactType,
      artifactVersion: artifact.artifactVersion,
      contentHash: artifact.contentHash
    }))
  ];
  const saved = await repository.saveSiteVersion({ siteId: request.siteId, version });
  if (!saved) throw new Error("Managed site disappeared while saving the deterministic replacement version.");
  if (snapshot.eligibilityMode !== "public") {
    return {
      request,
      impact: "deterministic",
      applied: true,
      publish: "not_applicable",
      detail: "The replacement version passed QA and remains a protected draft until the owner confirms all public facts."
    };
  }
  const published = await repository.publishVersion({ siteId: request.siteId, versionId: version.id });
  if (!published?.ok) throw new Error(published?.reason ?? "Deterministic replacement version could not be published.");
  return { request, impact: "deterministic", applied: true, publish: "published" };
}

function deterministicCompileArtifacts(
  siteId: string,
  snapshot: GenerationInputSnapshotV1,
  plan: import("./generation-contracts").GenerationPlan,
  copy: import("./generation-contracts").SiteCopy,
  gateStatus: "pass" | "fail"
) {
  const scope = gateStatus === "pass" ? "site_selected" as const : "qa_evidence" as const;
  return [
    deterministicSiteArtifact({
      siteId,
      scope,
      artifactType: "generation_input_snapshot",
      artifactVersion: snapshot.schemaVersion,
      payload: { snapshot },
      provenance: createRegenerableArtifactProvenanceV1({
        producerId: "control-plane-snapshot-reference",
        producerVersion: snapshot.schemaVersion,
        inputs: { inputSnapshotId: snapshot.id, inputHash: snapshot.inputHash }
      })
    }),
    deterministicSiteArtifact({
      siteId,
      scope,
      artifactType: "generation_plan",
      artifactVersion: plan.schemaVersion,
      payload: { plan },
      provenance: plan.provenance
    }),
    deterministicSiteArtifact({
      siteId,
      scope,
      artifactType: "site_copy",
      artifactVersion: copy.schemaVersion,
      payload: { copy },
      provenance: copy.provenance
    })
  ];
}

function deterministicSiteArtifact(input: {
  siteId: string;
  scope: SiteArtifactRecord["scope"];
  artifactType: SiteArtifactRecord["artifactType"];
  artifactVersion: string;
  provenance: SiteArtifactRecord["provenance"];
  payload: Record<string, unknown>;
}): SiteArtifactRecord {
  const contentHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  return {
    id: `artifact_${input.siteId}_${input.artifactType}_${contentHash.slice(0, 20)}`,
    siteId: input.siteId,
    scope: input.scope,
    artifactType: input.artifactType,
    artifactVersion: input.artifactVersion,
    provenance: input.provenance,
    contentHash,
    payload: input.payload,
    createdAt: new Date().toISOString()
  };
}

function deterministicReviewArtifact(
  request: ControlPlaneChangeRequestV1,
  gate: Awaited<ReturnType<typeof runObjectiveGenerationGate>>,
  inputSnapshotCreatedAt: string
): SiteArtifactRecord {
  const payload = { controlPlaneChangeRequestId: request.id, inputSnapshotCreatedAt, gate };
  const contentHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    id: `artifact_${request.siteId}_control_review_${contentHash.slice(0, 20)}`,
    siteId: request.siteId,
    scope: "qa_evidence",
    artifactType: "generation_review",
    artifactVersion: "control-plane-objective-review-v1",
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "control-plane-deterministic-recompile",
      producerVersion: "control-plane-objective-review-v1",
      inputs: { request, inputSnapshotCreatedAt }
    }),
    contentHash,
    payload,
    createdAt: new Date().toISOString()
  };
}

async function queueStructuralCandidate(
  repository: ControlPlaneRepository,
  request: ControlPlaneChangeRequestV1,
  inputSnapshotId: string,
  detail?: string
): Promise<ControlPlaneChangeOutcome> {
  const controlPlane = await repository.getCanonicalControlPlane(request.siteId);
  const sourceUrl = controlPlane?.sourceSnapshots.find((source) => source.sourceType === "website")?.sourceUrl;
  const job = await repository.enqueueJob("generate_site", {
    inputSnapshotId,
    intendedSiteId: request.siteId,
    url: sourceUrl,
    coalesceKey: `control_plane:${request.siteId}`,
    runAfter: new Date(Date.now() + 1_500).toISOString(),
    metadata: {
      entrypoint: "control-plane-change",
      changeRequestId: request.id,
      reason: detail ?? "structural control-plane change",
      rendererVersion: "layout-v3"
    }
  });
  return {
    request,
    impact: changeImpact(request.payload),
    applied: true,
    publish: "structural_candidate_queued",
    jobId: job.id,
    detail
  };
}

async function assertValidPayload(
  payload: ControlPlaneChangePayloadV1,
  state: import("./control-plane").CanonicalBusinessStateV1
) {
  const validation = await validateControlPlaneChange(payload);
  if (!validation.ok) throw new Error(validation.reason);
  if (payload.kind === "confirm_business_snapshot") {
    const confirmed = new Set(payload.factIds);
    const missing = requiredPublicEligibilityFactIds(state).filter((factId) => !confirmed.has(factId));
    if (missing.length) throw new Error(`Public eligibility requires confirmation of: ${missing.join(", ")}.`);
  }
  if (payload.kind === "set_offering" && payload.catalogId) {
    const definition = verticalPackFor(state.business.vertical).serviceCatalog.find((item) => item.id === payload.catalogId);
    if (!definition) throw new Error(`Unknown service catalog ID ${payload.catalogId}.`);
    if (definition.retired) throw new Error(`Service catalog ID ${payload.catalogId} is retired and cannot be newly selected.`);
  }
  if (payload.kind === "register_asset" && (payload.asset.businessId !== state.business.id || payload.revision.businessId !== state.business.id)) {
    throw new Error("Asset registration targets a different business.");
  }
  if (payload.kind === "set_form_definition") {
    if (!payload.fields.some((field) => field.type === "email" || field.type === "phone")) {
      throw new Error("Keep at least one email or phone field so leads remain contactable.");
    }
    if (payload.fields.some((field) => /\b(password|passcode|ssn|social security|credit card|card number|bank account|routing|token|secret)\b/i.test(field.label))) {
      throw new Error("Forms cannot collect sensitive credentials, government IDs, cards, bank details, tokens, or secrets.");
    }
  }
}

function formDefinitionForChange(
  siteId: string,
  payload: Extract<ControlPlaneChangePayloadV1, { kind: "set_form_definition" }>,
  createdAt: string
): FormDefinitionV1 {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  return {
    schemaVersion: "form-definition-v1",
    id: `formdef_${siteId}_${hash}_${Date.parse(createdAt)}`,
    siteId,
    name: payload.name,
    fields: structuredClone(payload.fields),
    submitLabel: payload.submitLabel,
    createdAt
  };
}

function copyContradictions(
  previous: GenerationInputSnapshotV1,
  next: GenerationInputSnapshotV1,
  copyValues: string[]
) {
  const changedOldValues = [
    previous.business.phone !== next.business.phone ? previous.business.phone : undefined,
    previous.business.email !== next.business.email ? previous.business.email : undefined,
    ...changedRecordValues(previous.business.hours, next.business.hours)
  ].filter((value): value is string => Boolean(value && value.trim().length >= 4));
  return copyValues.flatMap((copy, index) =>
    changedOldValues.some((value) => copy.toLocaleLowerCase("en-US").includes(value.toLocaleLowerCase("en-US")))
      ? [`copy_slot_${index + 1}`]
      : []
  );
}

function changedRecordValues(previous: Record<string, string> | undefined, next: Record<string, string> | undefined) {
  const values: string[] = [];
  for (const [key, value] of Object.entries(previous ?? {})) {
    if (next?.[key] !== value) values.push(value);
  }
  return values;
}

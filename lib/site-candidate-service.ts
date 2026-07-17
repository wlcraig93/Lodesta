import { createHash } from "node:crypto";
import {
  startRequiredSiteCandidateTelemetry,
  type AgentTelemetryRepository
} from "./agent-telemetry";
import { createSiteBundleFromInput, type IntakeInput } from "./intake";
import { prepareIntakeInput } from "./intake-pipeline";
import { castScrapedPhotos, scrapeAndStoreBusinessMedia } from "./scraped-media";
import { analyzeBusinessAssetsV1 } from "./asset-analysis-v1";
import { extractImagePalette } from "./image-palette";
import { runCanonicalGenerationPipeline, type CanonicalGenerationResult } from "./generation-pipeline";
import { createFixtureSiteCopy } from "./site-copy";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import { generationJudgeSchemaVersion, type GenerationJudgeResult } from "./generation-judge";
import { generationQaFromObjectiveGate } from "./generation-objective-gate";
import { persistPrimaryQaScreenshot } from "./candidate-screenshot";
import { normalizePublicFetchUrlInput } from "./url-safety";
import { verticalPackFor } from "./vertical-packs";
import { generationSnapshotFromIntakeBundle } from "./intake-generation-snapshot";
import { siteRenderEnvelopeFromSnapshot } from "./site-render-envelope";
import type { GenerationInputSnapshotV1 } from "./control-plane-contracts";
import {
  generationFailure,
  generationFailureDetail,
  serializeGenerationFailure,
  type GenerationFailureDetail
} from "./generation-failure";
import type {
  AgentRunSource,
  GenerationQaBlocker,
  SiteArtifactRecord,
  SiteAsset,
  SiteBundle,
  SiteCandidatePurpose,
  SiteCandidateRecord,
  Vertical
} from "./models";
import type { CreateSiteInput, LodestaRepository } from "./repository";

export type SiteCandidateRepository = AgentTelemetryRepository &
  Pick<
    LodestaRepository,
    | "createSiteCandidate"
    | "persistCanonicalGenerationInput"
    | "upsertSiteArtifact"
    | "listExperimentLearnings"
  >;

export type GenerateSitePreviewOptions = {
  create?: boolean;
  expiresAt?: string;
  origin?: string;
};

export type ModelFallbackPolicy = "fail" | "allow";

type GenerateSiteBaseOptions = {
  repository: SiteCandidateRepository;
  source: AgentRunSource;
  actorType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  candidatePurpose?: SiteCandidatePurpose;
  preview?: GenerateSitePreviewOptions;
  /** Deterministic fallback exists only for tests and fixture rendering. */
  modelFallbackPolicy?: ModelFallbackPolicy;
  signal?: AbortSignal;
};

export type GenerateSiteOptions = GenerateSiteBaseOptions & (
  | { mode: "fresh"; input: CreateSiteInput; inputSnapshot?: never; intendedSiteId?: never }
  | { mode: "snapshot"; input?: never; inputSnapshot: GenerationInputSnapshotV1; intendedSiteId: string }
);

export type GenerateSiteJobOptions = Omit<GenerateSiteBaseOptions, "repository"> & (
  | { mode: "fresh"; input: CreateSiteInput; inputSnapshot?: never; intendedSiteId?: never }
  | { mode: "snapshot"; input?: never; inputSnapshot: GenerationInputSnapshotV1; intendedSiteId: string }
);

export type GenerateSiteResult = {
  runId: string;
  siteCandidateId: string;
  generation: SiteCandidateRecord;
  bundle: SiteBundle;
  preview?: undefined;
  previewError?: undefined;
};

export type PreCompileSiteCandidateBlockInput = {
  message: string;
  businessName?: string;
  vertical?: Vertical;
  sourceUrl?: string;
  sourceHost?: string;
  candidateSlug?: string;
  blockers: GenerationQaBlocker[];
  artifactType?: SiteArtifactRecord["artifactType"];
  artifactPayload?: Record<string, unknown>;
};

/** Explicit operator-review failure used by callers that validate before generation. */
export class PreCompileSiteCandidateBlockError extends Error {
  code = "precompile_generation_block" as const;
  readonly detail: PreCompileSiteCandidateBlockInput;

  constructor(input: PreCompileSiteCandidateBlockInput) {
    super(input.message);
    this.name = "PreCompileSiteCandidateBlockError";
    this.detail = input;
  }
}

export function createPreCompileSiteCandidateBlock(input: PreCompileSiteCandidateBlockInput) {
  return new PreCompileSiteCandidateBlockError(input);
}

export async function generateSite(options: GenerateSiteOptions): Promise<GenerateSiteResult> {
  const input = options.mode === "fresh" ? normalizeGenerationInput(options.input) : undefined;
  if (options.mode === "snapshot" && options.inputSnapshot.siteId !== options.intendedSiteId) {
    throw new Error("Regeneration snapshot does not target the intended managed site.");
  }
  const allowModelFallback = options.modelFallbackPolicy === "allow";
  const telemetry = await startRequiredSiteCandidateTelemetry(options.repository, {
    ...input,
    ...(options.mode === "snapshot" ? {
      inputSnapshotId: options.inputSnapshot.id,
      intendedSiteId: options.intendedSiteId
    } : {}),
    source: options.source,
    actorType: options.actorType,
    actorId: options.actorId,
    metadata: options.metadata
  });
  const siteCandidateId = siteCandidateIdForRun(telemetry.runId);
  const generatedSiteId = options.mode === "snapshot" ? options.inputSnapshot.siteId : siteIdForRun(telemetry.runId);
  let bundle: SiteBundle | undefined;
  let sourceHost: string | undefined;

  try {
    options.signal?.throwIfAborted();
    if (options.mode === "snapshot") {
      return await runAndPersistCanonicalCandidate({
        options,
        telemetry,
        siteCandidateId,
        snapshot: options.inputSnapshot,
        allowModelFallback
      });
    }
    if (!input) throw new Error("Fresh generation input was not normalized.");
    logGenerateSiteProgress("intake_start", { siteCandidateId });
    const prepared = await prepareIntakeInput(input, {
      telemetry,
      identity: { siteId: generatedSiteId },
      signal: options.signal
    });
    assertCanonicalUnderstanding(prepared, allowModelFallback);
    bundle = createSiteBundleFromInput(prepared);
    sourceHost = hostFromUrl(bundle.presenceAssessment.sourceUrl ?? input.url);
    verticalPackFor(bundle.businessProfile.vertical);
    logGenerateSiteProgress("intake_done", {
      siteCandidateId,
      businessName: bundle.businessProfile.name,
      services: bundle.businessProfile.services.length,
      proposedEvidence: prepared.understanding?.evidenceProposals.length ?? 0,
      acceptedEvidence: bundle.presenceAssessment.evidenceManifest?.items.length ?? 0
    });

    await retainAndAnalyzeAssets({
      bundle,
      telemetry,
      allowModelFallback,
      signal: options.signal
    });
    const assets = canonicalAssets(bundle);
    bundle.presenceAssessment.assetInventory = assets;
    const evidence = bundle.presenceAssessment.evidenceManifest;
    if (!evidence) throw new Error("Canonical generation evidence manifest was not composed during intake.");
    const canonicalInput = generationSnapshotFromIntakeBundle({
      bundle,
      assets,
      crawl: prepared.crawl,
      publicPresence: prepared.publicPresence,
      eligibilityMode: "protected_preview"
    });
    const snapshot = canonicalInput.snapshot;
    await options.repository.persistCanonicalGenerationInput(canonicalInput);
    bundle.presenceAssessment.generationInputSnapshot = snapshot;

    return await runAndPersistCanonicalCandidate({
      options,
      telemetry,
      siteCandidateId,
      snapshot,
      bundle,
      sourceHost,
      sourceUrl: bundle.presenceAssessment.sourceUrl ?? input.url,
      allowModelFallback
    });
  } catch (error) {
    const detail = failureDetail(error, telemetry.runId, siteCandidateId);
    if (bundle) {
      bundle.presenceAssessment.technicalNotes.push(
        `Canonical generation failed at ${detail.stage} (${detail.code}): ${detail.message}`
      );
    }
    await telemetry.failRun(error, {
      errorCode: detail.code,
      outputJson: { generationFailureDetail: serializeGenerationFailure(detail) },
      metadata: options.metadata
    });
    throw generationFailure(error, {
      stage: detail.stage,
      code: detail.code,
      runId: telemetry.runId,
      siteCandidateId
    });
  }
}

async function runAndPersistCanonicalCandidate(input: {
  options: GenerateSiteOptions;
  telemetry: Awaited<ReturnType<typeof startRequiredSiteCandidateTelemetry>>;
  siteCandidateId: string;
  snapshot: GenerationInputSnapshotV1;
  bundle?: SiteBundle;
  sourceHost?: string;
  sourceUrl?: string;
  allowModelFallback: boolean;
}): Promise<GenerateSiteResult> {
  const evidence = input.snapshot.evidenceManifest;
  const generationSpan = await input.telemetry.startSpan({
    spanType: "canonical_generation",
    name: "Canonical plan, copy, compile, gate, and judgment",
    inputJson: {
      siteId: input.snapshot.siteId,
      vertical: input.snapshot.business.vertical,
      evidenceAccepted: evidence.items.length,
      evidenceRejected: evidence.rejected.length,
      assets: input.snapshot.assets.length,
      immutableInputSnapshotId: input.snapshot.id
    }
  });
  let result: CanonicalGenerationResult;
  try {
    result = await runCanonicalGenerationPipeline({
      snapshot: input.snapshot,
      telemetry: input.telemetry,
      spanId: generationSpan.id,
      signal: input.options.signal,
      ...(input.allowModelFallback ? { dependencies: deterministicFixtureDependencies() } : {})
    });
    await generationSpan.end({
      outputJson: {
        status: result.status,
        reason: result.reason,
        designSystem: result.plan.designSystem,
        trace: result.trace.counts,
        objectiveGate: result.gate.status,
        judgeVerdict: result.judge?.verdict
      },
      artifactRefs: {
        screenshots: result.gate.routes.flatMap((route) => route.inspection.screenshots.map((screenshot) => screenshot.path))
      }
    });
  } catch (error) {
    await generationSpan.fail(error);
    throw error;
  }
  const bundle = input.bundle ?? siteRenderEnvelopeFromSnapshot({
    snapshot: input.snapshot,
    version: result.version,
    plan: result.plan,
    copy: result.copy
  });
  if (input.sourceUrl) bundle.presenceAssessment.sourceUrl = input.sourceUrl;
  applyCanonicalResult(bundle, input.snapshot, result);
  const artifactRecords = canonicalArtifactRecords(input.siteCandidateId, input.snapshot, result);
  result.version.artifactRefs = artifactRecords.map((item) => ({
    artifactId: item.id,
    artifactType: item.artifactType,
    artifactVersion: item.artifactVersion,
    contentHash: item.contentHash
  }));
  try {
    await persistPrimaryQaScreenshot({ candidateId: input.siteCandidateId, version: result.version });
  } catch (error) {
    bundle.presenceAssessment.technicalNotes.push(
      `Primary QA screenshot persistence skipped: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const generation = await input.options.repository.createSiteCandidate({
    id: input.siteCandidateId,
    agentRunId: input.telemetry.runId,
    sourceUrl: input.sourceUrl,
    sourceHost: input.sourceHost,
    snapshot: input.snapshot,
    version: result.version,
    plan: result.plan,
    copy: result.copy,
    status: result.status === "ship" ? "ready" : "blocked",
    candidatePurpose: input.options.candidatePurpose,
    intendedSiteId: input.options.mode === "snapshot" ? input.options.intendedSiteId : undefined
  });
  await persistCanonicalArtifacts(input.options.repository, artifactRecords);
  await input.telemetry.completeRun({
    targetType: "site_candidate",
    targetId: generation.id,
    outputSummary: runSummary(generation),
    outputJson: {
      ...baseRunOutput(generation),
      generationStatus: result.status,
      generationReason: result.reason,
      designSystem: result.plan.designSystem,
      evidenceYield: evidence.yield,
      traceCounts: result.trace.counts
    },
    metadata: {
      ...input.options.metadata,
      targetName: generation.businessName,
      candidatePurpose: generation.candidatePurpose,
      previewStatus: input.options.preview?.create ? "admin_only_until_acceptance" : "skipped"
    }
  });
  return { runId: input.telemetry.runId, siteCandidateId: generation.id, generation, bundle };
}

function assertCanonicalUnderstanding(prepared: IntakeInput, allowModelFallback: boolean) {
  if (allowModelFallback || prepared.understanding?.source === "openai") return;
  throw new Error("Canonical generation requires model-backed business understanding; deterministic fallback is disabled.");
}

async function retainAndAnalyzeAssets(input: {
  bundle: SiteBundle;
  telemetry: Awaited<ReturnType<typeof startRequiredSiteCandidateTelemetry>>;
  allowModelFallback: boolean;
  signal?: AbortSignal;
}) {
  try {
    const manifest = await scrapeAndStoreBusinessMedia(input.bundle);
    const storagePaths = manifest.map((entry) => entry.storedUrl.replace(/^\/api\/assets\//, ""));
    const palette = await extractImagePalette(storagePaths);
    if (palette.hexes.length) {
      const assessment = input.bundle.presenceAssessment.brandAssessment ?? {
        id: `brand_${input.bundle.businessProfile.siteId}`,
        siteId: input.bundle.businessProfile.siteId,
        confidence: 0.7,
        cues: [input.bundle.businessProfile.name],
        colorSignals: [],
        typographySignals: [],
        imageStyleSignals: [],
        toneSignals: [],
        preservationRules: [],
        sourceNotes: []
      };
      assessment.colorSignals = [...palette.hexes, ...assessment.colorSignals.filter((value) => !palette.hexes.includes(value))].slice(0, 8);
      assessment.sourceNotes.push(`Palette sampled from ${storagePaths.length} retained first-party asset(s).`);
      input.bundle.presenceAssessment.brandAssessment = assessment;
    }
    castScrapedPhotos(input.bundle);
    logGenerateSiteProgress("media_retained", { siteId: input.bundle.businessProfile.siteId, retained: manifest.length });
  } catch (error) {
    input.bundle.presenceAssessment.technicalNotes.push(
      `Source media retention skipped: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const span = await input.telemetry.startSpan({
    spanType: "asset_analysis_v1",
    name: "Capped first-party asset analysis",
    inputJson: {
      siteId: input.bundle.businessProfile.siteId,
      photos: input.bundle.businessProfile.photos.length,
      hasLogo: Boolean(input.bundle.businessProfile.logo)
    }
  });
  try {
    const analysis = await analyzeBusinessAssetsV1({
      bundle: input.bundle,
      telemetry: input.telemetry,
      spanId: span.id,
      strict: !input.allowModelFallback,
      signal: input.signal
    });
    await span.end({ outputJson: analysis });
  } catch (error) {
    await span.fail(error);
    if (!input.allowModelFallback) throw error;
    input.bundle.presenceAssessment.technicalNotes.push(
      `Asset analysis fixture fallback used: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function canonicalAssets(bundle: SiteBundle): SiteAsset[] {
  const createdAt = new Date().toISOString();
  const retainedByUrl = new Map(
    (bundle.presenceAssessment.scrapedMediaManifest ?? []).map((entry) => [entry.storedUrl, entry])
  );
  const toCanonicalAsset = (
    reference: NonNullable<SiteBundle["businessProfile"]["logo"]>,
    kind: "photo" | "logo",
    fallbackId: string
  ): SiteAsset | undefined => {
    const retained = retainedByUrl.get(reference.url);
    if (reference.source === "website_reference" && !retained) return undefined;
    if (!retained) {
      throw new Error(`Asset ${reference.id || fallbackId} is missing retained binary revision metadata.`);
    }
    return {
      id: reference.id || fallbackId,
      siteId: bundle.businessProfile.siteId,
      kind,
      url: retained.storedUrl,
      alt: reference.alt,
      source: reference.source,
      rightsStatus: reference.rightsStatus,
      usageScope: reference.rightsStatus === "reference_only" ? "preclaim_preview" : "published_site",
      ownerApproved: reference.rightsStatus === "customer_granted",
      metadata: {
        contentHash: retained.contentHash,
        bytes: retained.bytes,
        mimeType: retained.mimeType,
        storagePath: retained.storagePath,
        width: retained.width ?? reference.width,
        height: retained.height ?? reference.height,
        ...(reference.analysisV1 ? { analysisV1: reference.analysisV1 } : {})
      },
      createdAt: retained.scrapedAt || createdAt
    };
  };
  const photoAssets = bundle.businessProfile.photos.flatMap((photo, index): SiteAsset[] => {
    const asset = toCanonicalAsset(photo, "photo", `${bundle.businessProfile.siteId}_photo_${index + 1}`);
    return asset ? [asset] : [];
  });
  const logo = bundle.businessProfile.logo;
  const retainedLogo = logo
    ? toCanonicalAsset(logo, "logo", `${bundle.businessProfile.siteId}_logo`)
    : undefined;
  const logoAssets: SiteAsset[] = retainedLogo ? [retainedLogo] : [];
  const excludedReferences = bundle.businessProfile.photos.length + (logo ? 1 : 0) - photoAssets.length - logoAssets.length;
  if (excludedReferences > 0) {
    bundle.presenceAssessment.technicalNotes.push(
      `${excludedReferences} website media reference(s) were excluded because their bytes were not retained.`
    );
  }
  return [...photoAssets, ...logoAssets];
}

function applyCanonicalResult(bundle: SiteBundle, snapshot: GenerationInputSnapshotV1, result: CanonicalGenerationResult) {
  result.version.generationQa = generationQaFromObjectiveGate(
    bundle,
    result.version,
    result.gate,
    result.status === "ship" ? "ready" : "blocked"
  );
  bundle.siteModel.theme = result.version.theme ?? bundle.siteModel.theme;
  bundle.siteModel.versions = [result.version];
  bundle.presenceAssessment.generationPlan = result.plan;
  bundle.presenceAssessment.generationInputSnapshot = snapshot;
  bundle.presenceAssessment.siteCopy = result.copy;
  bundle.presenceAssessment.generationTrace = result.trace;
  bundle.presenceAssessment.generationJudge = result.judge;
}

function deterministicFixtureDependencies() {
  return {
    copy: async (input: Parameters<typeof createFixtureSiteCopy>[0] extends never ? never : {
      snapshot: GenerationInputSnapshotV1;
      plan: Parameters<typeof createFixtureSiteCopy>[0];
    }) => ({ copy: createFixtureSiteCopy(input.plan, input.snapshot), attempts: 1 as const }),
    judge: async (input: { packet: { images: Array<unknown> } }): Promise<GenerationJudgeResult> => ({
      schemaVersion: generationJudgeSchemaVersion,
      provenance: createRegenerableArtifactProvenanceV1({
        producerId: "fixture-generation-judge",
        producerVersion: generationJudgeSchemaVersion,
        inputs: { deterministicFixture: true }
      }),
      source: "unavailable",
      evaluatedAt: new Date().toISOString(),
      screenshotCount: input.packet.images.length,
      verdict: "ship",
      action: "none",
      summary: "Deterministic fixture generation passed the objective browser gate.",
      findings: []
    })
  };
}

function canonicalArtifactRecords(candidateId: string, snapshot: GenerationInputSnapshotV1, result: CanonicalGenerationResult) {
  const createdAt = new Date().toISOString();
  const evidence = snapshot.evidenceManifest;
  return [
    artifact(candidateId, "generation_input_snapshot", snapshot.schemaVersion, snapshot.evidenceManifest.provenance, { snapshot }, createdAt),
    artifact(candidateId, "generation_evidence_manifest", "generation-evidence-manifest-v1", evidence.provenance, { evidence }, createdAt),
    artifact(candidateId, "generation_plan", result.plan.schemaVersion, result.plan.provenance, { plan: result.plan }, createdAt),
    artifact(candidateId, "site_copy", result.copy.schemaVersion, result.copy.provenance, { copy: result.copy }, createdAt),
    artifact(candidateId, "generation_review", result.trace.schemaVersion, result.trace.provenance, {
      status: result.status,
      reason: result.reason,
      gate: {
        schemaVersion: result.gate.schemaVersion,
        status: result.gate.status,
        evaluatedAt: result.gate.evaluatedAt,
        blockers: result.gate.blockers,
        warnings: result.gate.warnings,
        routes: result.gate.routes.map((route) => ({ pageId: route.pageId, slug: route.slug }))
      },
      judge: result.judge,
      trace: result.trace
    }, createdAt)
  ];
}

async function persistCanonicalArtifacts(repository: SiteCandidateRepository, artifacts: SiteArtifactRecord[]) {
  for (const item of artifacts) await repository.upsertSiteArtifact(item);
}

function artifact(
  candidateId: string,
  artifactType: SiteArtifactRecord["artifactType"],
  artifactVersion: string,
  provenance: SiteArtifactRecord["provenance"],
  payload: Record<string, unknown>,
  createdAt: string
): SiteArtifactRecord {
  return {
    id: `${candidateId}_${artifactType}`,
    siteCandidateId: candidateId,
    scope: artifactType === "generation_review" || artifactType === "generation_failure" ? "qa_evidence" : "candidate_selected",
    artifactType,
    artifactVersion,
    provenance,
    contentHash: contentHash(payload),
    payload,
    createdAt
  };
}

function generationFailureArtifact(candidateId: string, detail: GenerationFailureDetail): SiteArtifactRecord {
  const createdAt = new Date().toISOString();
  return artifact(candidateId, "generation_failure", "generation-failure-v1", createRegenerableArtifactProvenanceV1({
    producerId: "site-candidate-service",
    producerVersion: "generation-failure-v1",
    createdAt,
    inputs: { candidateId, stage: detail.stage, code: detail.code }
  }), {
    status: "failed",
    failure: serializeGenerationFailure(detail)
  }, createdAt);
}

function failureDetail(error: unknown, runId: string, siteCandidateId: string) {
  const message = error instanceof Error ? error.message.toLocaleLowerCase("en-US") : String(error).toLocaleLowerCase("en-US");
  const stage = message.includes("copy") ? "copy" : message.includes("asset") ? "asset_analysis" : message.includes("browser") || message.includes("gate") || message.includes("judge") ? "qa" : "compile";
  const code = stage === "copy" ? "copy_unavailable" : stage === "asset_analysis" ? "asset_analysis_unavailable" : stage === "qa" ? "qa_failed" : "compile_failed";
  return generationFailureDetail(error, { stage, code, runId, siteCandidateId });
}

function normalizeGenerationInput(input: CreateSiteInput): CreateSiteInput {
  const url = normalizePublicFetchUrlInput(input.url);
  const prompt = input.prompt?.trim() || undefined;
  if (!url) throw new Error("Provide a valid website URL.");
  return { url, prompt };
}

function runSummary(generation: SiteCandidateRecord) {
  return `${generation.businessName} (${generation.candidateSlug})`;
}

function baseRunOutput(generation: SiteCandidateRecord) {
  return {
    siteCandidateId: generation.id,
    candidateSiteId: generation.inputSnapshot.siteId,
    candidateSlug: generation.candidateSlug,
    businessName: generation.businessName,
    vertical: generation.vertical
  };
}

function contentHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function siteCandidateIdForRun(runId: string) {
  return `sitecand_${runId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

function siteIdForRun(runId: string) {
  return `site_${runId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function logGenerateSiteProgress(event: string, payload: Record<string, unknown>) {
  if (process.env.LODESTA_GENERATE_SITE_PROGRESS !== "1") return;
  console.error(JSON.stringify({ event, scope: "canonical_generate_site", ...payload }));
}

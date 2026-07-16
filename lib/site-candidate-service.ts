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
import { createBusinessFactGraph } from "./business-fact-graph";
import { verticalPackFor } from "./vertical-packs";
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
    | "upsertSiteArtifact"
    | "replaceFactCandidates"
    | "replaceProposedBusinessServices"
    | "listExperimentLearnings"
  >;

export type GenerateSitePreviewOptions = {
  create?: boolean;
  expiresAt?: string;
  origin?: string;
};

export type ModelFallbackPolicy = "fail" | "allow";

export type GenerateSiteOptions = {
  repository: SiteCandidateRepository;
  input: CreateSiteInput;
  source: AgentRunSource;
  actorType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  candidatePurpose?: SiteCandidatePurpose;
  /** Existing managed site whose owner-truth profile and identity must survive regeneration. */
  intendedSite?: SiteBundle;
  preview?: GenerateSitePreviewOptions;
  /** Deterministic fallback exists only for tests and fixture rendering. */
  modelFallbackPolicy?: ModelFallbackPolicy;
  signal?: AbortSignal;
};

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
  const input = normalizeGenerationInput(options.input);
  const allowModelFallback = options.modelFallbackPolicy === "allow";
  const telemetry = await startRequiredSiteCandidateTelemetry(options.repository, {
    ...input,
    source: options.source,
    actorType: options.actorType,
    actorId: options.actorId,
    metadata: options.metadata
  });
  const siteCandidateId = siteCandidateIdForRun(telemetry.runId);
  let bundle: SiteBundle | undefined;
  let sourceHost: string | undefined;

  try {
    options.signal?.throwIfAborted();
    logGenerateSiteProgress("intake_start", { siteCandidateId });
    const prepared = await prepareIntakeInput(input, {
      telemetry,
      identity: { siteId: siteCandidateId },
      signal: options.signal
    });
    assertCanonicalUnderstanding(prepared, allowModelFallback);
    bundle = createSiteBundleFromInput(prepared);
    if (options.intendedSite) bundle = applyIntendedSiteContext(bundle, options.intendedSite);
    sourceHost = hostFromUrl(bundle.presenceAssessment.sourceUrl ?? input.url);
    verticalPackFor(bundle.businessProfile.vertical);
    logGenerateSiteProgress("intake_done", {
      siteCandidateId,
      businessName: bundle.businessProfile.name,
      services: bundle.businessProfile.services.length,
      proposedEvidence: prepared.understanding?.evidenceProposals.length ?? 0,
      acceptedEvidence: bundle.presenceAssessment.evidenceLedger?.items.length ?? 0
    });

    await retainAndAnalyzeAssets({
      bundle,
      telemetry,
      allowModelFallback,
      signal: options.signal
    });
    const assets = canonicalAssets(bundle);
    bundle.presenceAssessment.assetInventory = assets;
    const evidence = bundle.presenceAssessment.evidenceLedger;
    if (!evidence) throw new Error("Canonical evidence ledger was not composed during intake.");

    const generationSpan = await telemetry.startSpan({
      spanType: "canonical_generation",
      name: "Canonical plan, copy, compile, gate, and judgment",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        vertical: bundle.businessProfile.vertical,
        evidenceAccepted: evidence.items.length,
        evidenceRejected: evidence.rejected.length,
        assets: assets.length
      }
    });
    let result: CanonicalGenerationResult;
    try {
      result = await runCanonicalGenerationPipeline({
        bundle,
        evidence,
        assets,
        telemetry,
        spanId: generationSpan.id,
        signal: options.signal,
        ...(allowModelFallback ? { dependencies: deterministicFixtureDependencies() } : {})
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

    applyCanonicalResult(bundle, result);
    try {
      await persistPrimaryQaScreenshot({ candidateId: siteCandidateId, version: result.version });
    } catch (error) {
      bundle.presenceAssessment.technicalNotes.push(
        `Primary QA screenshot persistence skipped: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const generation = await options.repository.createSiteCandidate({
      id: siteCandidateId,
      agentRunId: telemetry.runId,
      sourceUrl: bundle.presenceAssessment.sourceUrl ?? input.url,
      sourceHost,
      bundle,
      status: result.status === "ship" ? "ready" : "blocked",
      candidatePurpose: options.candidatePurpose,
      intendedSiteId: options.intendedSite?.businessProfile.siteId
    });
    await persistCanonicalArtifacts(options.repository, generation, result);
    await telemetry.completeRun({
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
        ...options.metadata,
        targetName: generation.businessName,
        candidatePurpose: generation.candidatePurpose,
        previewStatus: options.preview?.create ? "admin_only_until_acceptance" : "skipped"
      }
    });
    return { runId: telemetry.runId, siteCandidateId: generation.id, generation, bundle: generation.bundle };
  } catch (error) {
    const detail = failureDetail(error, telemetry.runId, siteCandidateId);
    if (bundle) {
      bundle.presenceAssessment.technicalNotes.push(
        `Canonical generation failed at ${detail.stage} (${detail.code}): ${detail.message}`
      );
      try {
        const failed = await options.repository.createSiteCandidate({
          id: siteCandidateId,
          agentRunId: telemetry.runId,
          sourceUrl: bundle.presenceAssessment.sourceUrl ?? input.url,
          sourceHost,
          bundle,
          status: "blocked",
          candidatePurpose: options.candidatePurpose,
          intendedSiteId: options.intendedSite?.businessProfile.siteId
        });
        await options.repository.upsertSiteArtifact(generationFailureArtifact(failed.id, detail));
      } catch (persistenceError) {
        console.warn(`Blocked candidate persistence skipped: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`);
      }
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

function applyIntendedSiteContext(generated: SiteBundle, intended: SiteBundle): SiteBundle {
  const businessProfile = structuredClone(intended.businessProfile);
  const presenceAssessment = {
    ...generated.presenceAssessment,
    siteId: businessProfile.siteId,
    publicPresenceSignals: generated.presenceAssessment.publicPresenceSignals?.map((signal) => ({
      ...signal,
      siteId: businessProfile.siteId
    })),
    brandAssessment: generated.presenceAssessment.brandAssessment
      ? {
          ...generated.presenceAssessment.brandAssessment,
          id: `brand_${businessProfile.siteId}`,
          siteId: businessProfile.siteId
        }
      : undefined
  };
  presenceAssessment.businessFactGraph = createBusinessFactGraph({
    business: businessProfile,
    presence: presenceAssessment
  });
  return {
    ...generated,
    businessProfile,
    siteModel: {
      ...generated.siteModel,
      id: intended.siteModel.id,
      slug: intended.siteModel.slug,
      pinList: structuredClone(intended.siteModel.pinList),
      versions: []
    },
    extensionModel: structuredClone(intended.extensionModel),
    experiments: [] as SiteBundle["experiments"],
    presenceAssessment
  };
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
  const photoAssets = bundle.businessProfile.photos.map((photo, index): SiteAsset => ({
    id: photo.id || `${bundle.businessProfile.siteId}_photo_${index + 1}`,
    siteId: bundle.businessProfile.siteId,
    kind: "photo",
    url: photo.url,
    alt: photo.alt,
    source: photo.source,
    rightsStatus: photo.rightsStatus,
    usageScope: photo.rightsStatus === "reference_only" ? "preclaim_preview" : "published_site",
    ownerApproved: photo.rightsStatus === "customer_granted",
    metadata: {
      ...(photo.width ? { width: photo.width } : {}),
      ...(photo.height ? { height: photo.height } : {}),
      ...(photo.analysisV1 ? { analysisV1: photo.analysisV1 } : {})
    },
    createdAt
  }));
  const logo = bundle.businessProfile.logo;
  const logoAssets: SiteAsset[] = logo ? [{
    id: logo.id || `${bundle.businessProfile.siteId}_logo`,
    siteId: bundle.businessProfile.siteId,
    kind: "logo",
    url: logo.url,
    alt: logo.alt,
    source: logo.source,
    rightsStatus: logo.rightsStatus,
    usageScope: logo.rightsStatus === "reference_only" ? "preclaim_preview" : "published_site",
    ownerApproved: logo.rightsStatus === "customer_granted",
    metadata: {
      ...(logo.width ? { width: logo.width } : {}),
      ...(logo.height ? { height: logo.height } : {}),
      ...(logo.analysisV1 ? { analysisV1: logo.analysisV1 } : {})
    },
    createdAt
  }] : [];
  return [...photoAssets, ...logoAssets];
}

function applyCanonicalResult(bundle: SiteBundle, result: CanonicalGenerationResult) {
  result.version.generationQa = generationQaFromObjectiveGate(
    bundle,
    result.version,
    result.gate,
    result.status === "ship" ? "ready" : "blocked"
  );
  bundle.siteModel.theme = result.version.theme ?? bundle.siteModel.theme;
  bundle.siteModel.versions = [result.version];
  bundle.presenceAssessment.generationPlan = result.plan;
  bundle.presenceAssessment.siteCopy = result.copy;
  bundle.presenceAssessment.generationTrace = result.trace;
  bundle.presenceAssessment.generationJudge = result.judge;
}

function deterministicFixtureDependencies() {
  return {
    copy: async (input: Parameters<typeof createFixtureSiteCopy>[0] extends never ? never : {
      business: SiteBundle["businessProfile"];
      plan: Parameters<typeof createFixtureSiteCopy>[0];
    }) => ({ copy: createFixtureSiteCopy(input.plan, input.business), attempts: 1 as const }),
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

async function persistCanonicalArtifacts(
  repository: SiteCandidateRepository,
  generation: SiteCandidateRecord,
  result: CanonicalGenerationResult
) {
  const createdAt = new Date().toISOString();
  const evidence = generation.bundle.presenceAssessment.evidenceLedger;
  if (!evidence) throw new Error("Canonical generation completed without an evidence ledger.");
  const artifacts: SiteArtifactRecord[] = [
    artifact(generation.id, "evidence_ledger", "evidence-ledger-v1", evidence.provenance, { evidence }, createdAt),
    artifact(generation.id, "generation_plan", result.plan.schemaVersion, result.plan.provenance, { plan: result.plan }, createdAt),
    artifact(generation.id, "site_copy", result.copy.schemaVersion, result.copy.provenance, { copy: result.copy }, createdAt),
    artifact(generation.id, "generation_review", result.trace.schemaVersion, result.trace.provenance, {
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
  const url = input.url ? normalizePublicFetchUrlInput(input.url) || undefined : undefined;
  const prompt = input.prompt?.trim() || undefined;
  if (!url && !prompt) throw new Error("Provide a URL or prompt.");
  return { url, prompt };
}

function runSummary(generation: SiteCandidateRecord) {
  return `${generation.businessName} (${generation.candidateSlug})`;
}

function baseRunOutput(generation: SiteCandidateRecord) {
  return {
    siteCandidateId: generation.id,
    candidateSiteId: generation.bundle.businessProfile.siteId,
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

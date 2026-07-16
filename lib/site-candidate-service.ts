import { createHash } from "node:crypto";
import {
  startRequiredSiteCandidateTelemetry,
  type AgentTelemetryRepository,
  type RequiredAgentTelemetryRecorder
} from "./agent-telemetry";
import { createSiteV3FromInput, type IntakeInput } from "./intake";
import { slugify } from "./slug";
import { prepareIntakeInput } from "./intake-pipeline";
import { understandingVerticalConfidenceFloor } from "./business-understanding-v2";
import { factCandidatesFromBundle, proposedBusinessServices, selectCandidatesForPreview } from "./business-evidence";
import { castScrapedPhotos, scrapeAndStoreBusinessMedia } from "./scraped-media";
import { extractImagePalette } from "./image-palette";
import { createOpenAiGeneratedCopyDeck, lintGeneratedCopyDeck } from "./generated-copy-v2";
import { runInitialGeneratedSiteReadiness, type GeneratedSiteReadinessResult } from "./generated-site-readiness";
import { persistPrimaryQaScreenshot } from "./candidate-screenshot";
import { createDeterministicSiteDirectorPlanV1 } from "./deterministic-site-director-plan-v1";
import { composeSiteDossierV1, refreshSiteDossierCopyBriefV1 } from "./site-dossier-v1";
import { analyzeBusinessAssetsV1 } from "./asset-analysis-v1";
import { applyGeneratedSiteV3, applyGeneratedSiteV3WithAssetLibrary } from "./generated-site-v3-pipeline";
import { approvedAssetLibraryAssetsForVerticals, type ApprovedAssetLibraryAsset } from "./asset-library";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import { assertSiteVersionV3, pageCountForVersionV3 } from "./site-version-v3";
import { evaluatePreCompileResolutionGateV2 } from "./precompile-resolution-gate";
import type {
  AgentRunSource,
  SiteArtifactRecord,
  GenerationQaBlocker,
  SiteBundle,
  SiteCandidateRecord,
  SiteCandidatePurpose,
  SiteVersion,
  Vertical
} from "./models";
import type { CreateSiteInput, LodestaRepository } from "./repository";
import { normalizePublicFetchUrlInput } from "./url-safety";
import { isLaunchMarketError } from "./launch-market";
import {
  generationFailure,
  generationFailureDetail,
  isRetryableTransientGenerationError,
  serializeGenerationFailure,
  type GenerationFailureDetail
} from "./generation-failure";

export type SiteCandidateRepository = AgentTelemetryRepository &
  Pick<
    LodestaRepository,
    "createSiteCandidate" | "listExperimentLearnings" | "upsertSiteArtifact" | "replaceFactCandidates" | "replaceProposedBusinessServices"
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
  preview?: GenerateSitePreviewOptions;
  /**
   * Canonical candidate generation must fail when model-backed understanding,
   * planning, copy, or final visual QA is unavailable. Deterministic fallback is
   * reserved for explicit tests/fixture rendering where the caller opts in.
   */
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

export class PreCompileSiteCandidateBlockError extends Error {
  code = "precompile_generation_block" as const;
  businessName?: string;
  vertical?: Vertical;
  sourceUrl?: string;
  sourceHost?: string;
  candidateSlug?: string;
  blockers: GenerationQaBlocker[];
  artifactType: SiteArtifactRecord["artifactType"];
  artifactPayload: Record<string, unknown>;

  constructor(input: PreCompileSiteCandidateBlockInput) {
    super(input.message);
    this.name = "PreCompileSiteCandidateBlockError";
    this.businessName = input.businessName;
    this.vertical = input.vertical;
    this.sourceUrl = input.sourceUrl;
    this.sourceHost = input.sourceHost;
    this.candidateSlug = input.candidateSlug;
    this.blockers = input.blockers;
    this.artifactType = input.artifactType ?? "business_context_report";
    this.artifactPayload = input.artifactPayload ?? {};
  }
}

export function createPreCompileSiteCandidateBlock(input: PreCompileSiteCandidateBlockInput) {
  return new PreCompileSiteCandidateBlockError(input);
}

function assertCanonicalModelStagesAvailable(prepared: IntakeInput, allowModelFallback: boolean) {
  if (allowModelFallback) return;
  const fallbackStages: string[] = [];
  if (prepared.understanding?.source !== "openai") fallbackStages.push("business understanding");
  if (!fallbackStages.length) return;
  throw new Error(
    `Canonical generateSite requires model-backed ${fallbackStages.join(" and ")}; deterministic fallback is disabled. ` +
      "Use modelFallbackPolicy: 'allow' only for deterministic tests, fixtures, or isolated renderer workbench runs."
  );
}

export async function generateSite(options: GenerateSiteOptions): Promise<GenerateSiteResult> {
  const input = normalizeGenerationInput(options.input);
  const signal = options.signal;
  const modelFallbackPolicy = options.modelFallbackPolicy ?? "fail";
  const allowModelFallback = modelFallbackPolicy === "allow";
  const telemetry = await startRequiredSiteCandidateTelemetry(options.repository, {
    ...input,
    source: options.source,
    actorType: options.actorType,
    actorId: options.actorId,
    metadata: options.metadata
  });
  const siteCandidateId = siteCandidateIdForRun(telemetry.runId);
  let currentBundle: SiteBundle | undefined;
  let currentSourceHost: string | undefined;

  try {
    const identity = { siteId: siteCandidateId };
    signal?.throwIfAborted();
    logGenerateSiteProgress("prepare_intake_start", { siteCandidateId });
    let prepared: IntakeInput;
    try {
      prepared = await prepareIntakeInput(input, { telemetry, identity, signal });
    } catch (error) {
      throw generationFailure(error, {
        stage: "crawl",
        code: errorCodeForIntakePreparation(error),
        runId: telemetry.runId,
        siteCandidateId
      });
    }
    signal?.throwIfAborted();
    logGenerateSiteProgress("prepare_intake_done", {
      siteCandidateId,
      sourceUrl: prepared.url,
      crawlStatus: prepared.crawl?.status,
      understandingSource: prepared.understanding?.source,
      understandingVertical: prepared.understanding?.vertical,
      cleanedServices: prepared.understanding?.cleanedServices.length ?? 0,
      sourceScreenshots: prepared.renderInspection?.screenshots.length ?? 0
    });
    try {
      assertCanonicalModelStagesAvailable(prepared, allowModelFallback);
    } catch (error) {
      throw generationFailure(error, {
        stage: "precompile_gate",
        code: "precompile_generation_block",
        runId: telemetry.runId,
        siteCandidateId
      });
    }
    logGenerateSiteProgress("compile_input_start", { siteCandidateId });
    let bundle: SiteBundle;
    try {
      bundle = createSiteV3FromInput({
        ...prepared,
        identity,
        experimentLearnings: await options.repository.listExperimentLearnings({ status: "active" })
      });
      currentBundle = bundle;
    } catch (error) {
      throw generationFailure(error, {
        stage: "compile",
        code: "compile_failed",
        runId: telemetry.runId,
        siteCandidateId
      });
    }
    logGenerateSiteProgress("compile_input_done", {
      siteCandidateId,
      businessName: bundle.businessProfile.name,
      vertical: bundle.businessProfile.vertical,
      services: bundle.businessProfile.services.length
    });
    const sourceHost = hostFromUrl(bundle.presenceAssessment.sourceUrl ?? input.url);
    currentSourceHost = sourceHost;
    const resolutionGate = evaluatePreCompileResolutionGateV2(bundle);
    if (resolutionGate.status === "blocked") {
      throw createPreCompileSiteCandidateBlock({
        message: "Business identity or service resolution blocked before compilation.",
        businessName: bundle.businessProfile.name,
        vertical: bundle.businessProfile.vertical,
        sourceUrl: bundle.presenceAssessment.sourceUrl ?? input.url,
        sourceHost,
        candidateSlug: bundle.siteModel.slug,
        blockers: resolutionGate.blockers,
        artifactType: "identity_reconcile_report",
        artifactPayload: resolutionGate.artifactPayload
      });
    }
    assertVerticalResolutionForServiceBusiness(bundle, input.url);
    applyTextFirstFallbackApproval(bundle, options);
    signal?.throwIfAborted();
    // Real photos for protected previews: download crawl media into private
    // storage (reference_only; publish requires per-photo attestation).
    try {
      logGenerateSiteProgress("scraped_media_start", {
        siteCandidateId,
        sourcePhotos: bundle.businessProfile.photos.length
      });
      const scrapedManifest = await scrapeAndStoreBusinessMedia(bundle);
      signal?.throwIfAborted();
      logGenerateSiteProgress("scraped_media_done", {
        siteCandidateId,
        storedMedia: scrapedManifest.length
      });
      if (scrapedManifest.length) {
        // Brand palette from the pixels we just stored: logo first (it IS the
        // brand), then photos. Cues feed the existing WCAG-clamped derivation.
        const storagePaths = [...scrapedManifest]
          .sort((left, right) => (left.kind === "logo" ? -1 : 0) - (right.kind === "logo" ? -1 : 0))
          .map((entry) => entry.storedUrl.replace(/^\/api\/assets\//, ""));
        const palette = await extractImagePalette(storagePaths);
        if (palette.hexes.length) {
          const assessment = bundle.presenceAssessment.brandAssessment ?? {
            id: `brand_${bundle.businessProfile.siteId}`,
            siteId: bundle.businessProfile.siteId,
            confidence: 0.6,
            cues: [],
            colorSignals: [],
            typographySignals: [],
            imageStyleSignals: [],
            toneSignals: [],
            preservationRules: [],
            sourceNotes: []
          };
          assessment.colorSignals = [...palette.hexes, ...assessment.colorSignals].slice(0, 8);
          assessment.sourceNotes.push(`Palette sampled from ${storagePaths.length} scraped media files.`);
          bundle.presenceAssessment.brandAssessment = assessment;
        }
        // Media casting: dimensions recorded for hero/section placement rules.
        for (const entry of scrapedManifest) {
          const dimensions = palette.dimensions[entry.storedUrl.replace(/^\/api\/assets\//, "")];
          if (dimensions) Object.assign(entry, { width: dimensions.width, height: dimensions.height });
        }
        castScrapedPhotos(bundle);
      }
    } catch (error) {
      bundle.presenceAssessment.technicalNotes.push(
        `Scraped media storage skipped: ${error instanceof Error ? error.message : String(error)}`
      );
      logGenerateSiteProgress("scraped_media_failed", {
        siteCandidateId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    const assetAnalysisSpan = await telemetry.startSpan({
      spanType: "asset_analysis_v1",
      name: "First-party image analysis",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        photos: bundle.businessProfile.photos.length,
        hasLogo: Boolean(bundle.businessProfile.logo)
      }
    });
    try {
      logGenerateSiteProgress("asset_analysis_start", {
        siteCandidateId,
        photos: bundle.businessProfile.photos.length,
        hasLogo: Boolean(bundle.businessProfile.logo)
      });
      const assetAnalysis = await retryTransientGenerationStage("asset_analysis", () =>
        analyzeBusinessAssetsV1({
          bundle,
          telemetry,
          spanId: assetAnalysisSpan.id,
          strict: !allowModelFallback,
          signal
        })
      );
      logGenerateSiteProgress("asset_analysis_done", {
        siteCandidateId,
        eligible: assetAnalysis.eligible,
        selected: assetAnalysis.candidates,
        analyzed: assetAnalysis.analyzed,
        cached: assetAnalysis.cached,
        skippedOverBudget: assetAnalysis.skippedOverBudget,
        skippedUnreadable: assetAnalysis.skippedUnreadable,
        failed: assetAnalysis.failed
      });
      await assetAnalysisSpan.end({ outputJson: assetAnalysis });
    } catch (assetAnalysisError) {
      await assetAnalysisSpan.fail(assetAnalysisError);
      logGenerateSiteProgress("asset_analysis_failed", {
        siteCandidateId,
        error: assetAnalysisError instanceof Error ? assetAnalysisError.message : String(assetAnalysisError)
      });
      if (!allowModelFallback) {
        throw generationFailure(assetAnalysisError, {
          stage: "asset_analysis",
          code: "asset_analysis_unavailable",
          message:
          `Canonical generateSite requires model-backed AssetAnalysisV1 for first-party/source imagery; ${
            assetAnalysisError instanceof Error ? assetAnalysisError.message : String(assetAnalysisError)
          }`,
          runId: telemetry.runId,
          siteCandidateId
        });
      }
      console.warn("Asset analysis unavailable; explicit development fallback may use deterministic asset heuristics.", assetAnalysisError instanceof Error ? assetAnalysisError.message : assetAnalysisError);
    }
    bundle.presenceAssessment.siteDossierV1 = composeSiteDossierV1({ bundle, crawl: prepared.crawl });
    const assetLibraryAssets = await loadGenerationAssetLibraryAssets(bundle);
    const plannerSpan = await telemetry.startSpan({
      spanType: "design_system_planner_v1",
      name: "Deterministic design-system planner",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        vertical: bundle.businessProfile.vertical,
        services: bundle.businessProfile.services.length,
        assets: bundle.businessProfile.photos.length + (bundle.businessProfile.logo ? 1 : 0)
      }
    });
    try {
      logGenerateSiteProgress("design_system_planner_start", { siteCandidateId });
      const siteDirector = createDeterministicSiteDirectorPlanV1({
        bundle,
        assetLibraryAssets
      });
      bundle.presenceAssessment.siteDirectorPlanV1 = siteDirector;
      bundle.presenceAssessment.generationPlanningSource = "deterministic_design_system";
      logGenerateSiteProgress("design_system_planner_done", {
        siteCandidateId,
        source: siteDirector.source,
        plannedSections: siteDirector.plan.home.sections.length,
        catalogSchemaHash: siteDirector?.catalogSchemaHash,
        businessPlannerInputHash: siteDirector?.businessPlannerInputHash
      });
      await plannerSpan.end({
        outputJson: {
          source: siteDirector.source,
          model: siteDirector.model,
          siteDossierHash: bundle.presenceAssessment.siteDossierV1?.contentHash,
          plannedSections: siteDirector.plan.home.sections.map((section) => ({
            id: section.id,
            role: section.role,
            templateId: section.templateId,
            presentation: section.presentation
          })),
          catalogSchemaHash: siteDirector.catalogSchemaHash,
          businessPlannerInputHash: siteDirector.businessPlannerInputHash,
          planInputHash: siteDirector.planInputHash,
          validationStatus: siteDirector.validation.status
        }
      });
    } catch (plannerError) {
      await plannerSpan.fail(plannerError);
      logGenerateSiteProgress("design_system_planner_failed", {
        siteCandidateId,
        error: plannerError instanceof Error ? plannerError.message : String(plannerError)
      });
      throw generationFailure(plannerError, {
        stage: "planner",
        code: "planner_unavailable",
        message: `Deterministic SiteDirectorPlanV1 failed: ${
          plannerError instanceof Error ? plannerError.message : String(plannerError)
        }`,
        runId: telemetry.runId,
        siteCandidateId
      });
    }
    bundle.presenceAssessment.siteDossierV1 = refreshSiteDossierCopyBriefV1(bundle);
    const copySpan = await telemetry.startSpan({
      spanType: "generated_copy_deck",
      name: "Fact-grounded copy deck",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        vertical: bundle.businessProfile.vertical,
        services: bundle.businessProfile.services.length,
        siteDirectorPlan: bundle.presenceAssessment.siteDirectorPlanV1?.validation.status ?? "missing"
      }
    });
    try {
      logGenerateSiteProgress("copy_deck_start", { siteCandidateId });
      bundle.presenceAssessment.generatedCopyDeck = await retryTransientGenerationStage("copy", () =>
        createOpenAiGeneratedCopyDeck({
          bundle,
          telemetry,
          spanId: copySpan.id,
          signal,
          failureMode: !allowModelFallback ? "throw" : "return_undefined"
        })
      );
      if (!bundle.presenceAssessment.generatedCopyDeck && !allowModelFallback) {
        throw generationFailure(new Error("Canonical generateSite requires a model-backed copy deck; deterministic copy fallback is disabled."), {
          stage: "copy",
          code: "copy_empty_output",
          runId: telemetry.runId,
          siteCandidateId
        });
      }
      logGenerateSiteProgress("copy_deck_done", {
        siteCandidateId,
        source: bundle.presenceAssessment.generatedCopyDeck ? "openai" : "deterministic_fallback",
        serviceItems: bundle.presenceAssessment.generatedCopyDeck?.serviceItems.length ?? 0,
        siteDirectorPlan: bundle.presenceAssessment.siteDirectorPlanV1?.validation.status ?? "missing"
      });
      await copySpan.end({
        outputJson: {
          source: bundle.presenceAssessment.generatedCopyDeck ? "openai" : "deterministic_fallback",
          serviceItems: bundle.presenceAssessment.generatedCopyDeck?.serviceItems.length ?? 0,
          faqs: bundle.presenceAssessment.generatedCopyDeck?.faqs.length ?? 0,
          siteDirectorPlan: bundle.presenceAssessment.siteDirectorPlanV1?.validation.status ?? "missing"
        }
      });
    } catch (error) {
      await copySpan.fail(error);
      throw generationFailure(error, {
        stage: "copy",
        code: "copy_unavailable",
        runId: telemetry.runId,
        siteCandidateId
      });
    }
    logGenerateSiteProgress("apply_v3_start", { siteCandidateId });
    signal?.throwIfAborted();
    let v3Application: Awaited<ReturnType<typeof applyGeneratedSiteV3WithAssetLibrary>>;
    try {
      v3Application = assetLibraryAssets.length
        ? applyGeneratedSiteV3({ bundle, assetLibraryAssets })
        : await applyGeneratedSiteV3WithAssetLibrary({ bundle });
    } catch (error) {
      throw generationFailure(error, {
        stage: "compile",
        code: "compile_failed",
        runId: telemetry.runId,
        siteCandidateId
      });
    }
    logGenerateSiteProgress("apply_v3_done", {
      siteCandidateId,
      pages: bundle.siteModel.versions[0]
        ? pageCountForVersionV3(assertSiteVersionV3(bundle.siteModel.versions[0], "generateSite progress version"))
        : 0
    });
    await recordGeneratedSiteV3Application({
      telemetry,
      bundle,
      application: v3Application
    });
    const qaSpan = await telemetry.startSpan({
      spanType: "generated_site_qa",
      name: "Generated-site readiness QA",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        versionId: bundle.siteModel.versions[0]?.id
      }
    });
    let readiness: Awaited<ReturnType<typeof runInitialGeneratedSiteReadiness>>;
    try {
      logGenerateSiteProgress("readiness_start", { siteCandidateId });
      readiness = await runInitialGeneratedSiteReadiness({
        bundle,
        telemetry,
        spanId: qaSpan.id,
        modelFallbackPolicy,
        qualitySignals: v3Application.qualitySignals,
        signal
      });
      logGenerateSiteProgress("readiness_done", {
        siteCandidateId,
        status: readiness.status,
        readiness: readiness.qa.readiness,
        verdict: readiness.verdict,
        visualQaSource: readiness.qa.visualQa?.source,
        blockers: readiness.qa.blockers.length
      });
      await qaSpan.end({
        outputJson: {
          readiness: readiness.qa.readiness,
          blockers: readiness.qa.blockers.length,
          warnings: readiness.qa.warnings.length,
          verdict: readiness.verdict,
          visualQaSource: readiness.qa.visualQa?.source,
          visualQaFindings: readiness.qa.visualQa?.findings.length ?? 0,
          costStatus: readiness.qa.generationCostEstimate?.status,
          estimatedCostUnits: readiness.qa.generationCostEstimate?.estimatedUnits,
          budgetUnits: readiness.qa.generationCostEstimate?.budgetUnits
        },
        artifactRefs: {
          screenshots: readiness.qa.artifactRefs ?? []
        }
      });
      const regenerationResult = await maybeRegenerateGeneratedSite({
        bundle,
        siteCandidateId,
        readiness,
        assetLibraryAssets,
        telemetry,
        modelFallbackPolicy,
        allowModelFallback,
        signal
      });
      if (regenerationResult) {
        readiness = regenerationResult.readiness;
        v3Application = regenerationResult.application;
        logGenerateSiteProgress("readiness_regenerated", {
          siteCandidateId,
          status: readiness.status,
          readiness: readiness.qa.readiness,
          verdict: readiness.verdict,
          blockers: readiness.qa.blockers.length,
          mode: readiness.qa.regeneration?.mode
        });
      }
    } catch (error) {
      await qaSpan.fail(error);
      throw generationFailure(error, {
        stage: "qa",
        code: "qa_failed",
        runId: telemetry.runId,
        siteCandidateId
      });
    }
    try {
      const version = bundle.siteModel.versions[0];
      signal?.throwIfAborted();
      if (version) await persistPrimaryQaScreenshot({ candidateId: siteCandidateId, version });
    } catch (screenshotError) {
      console.warn(
        "QA screenshot persistence failed (non-fatal):",
        screenshotError instanceof Error ? screenshotError.message : screenshotError
      );
    }
    signal?.throwIfAborted();
    const generation = await options.repository.createSiteCandidate({
      id: siteCandidateId,
      agentRunId: telemetry.runId,
      sourceUrl: bundle.presenceAssessment.sourceUrl ?? input.url,
      sourceHost,
      bundle,
      status: readiness.status,
      candidatePurpose: options.candidatePurpose
    });
    logGenerateSiteProgress("candidate_persisted", {
      siteCandidateId,
      status: generation.status,
      candidatePurpose: generation.candidatePurpose
    });
    await persistCopyDeckArtifacts({ repository: options.repository, generation });
    await persistEvidenceLayer({ repository: options.repository, generation });
    const runOutput = baseRunOutput(generation);
    const runMetadata = baseRunMetadata(generation, options.metadata);
    const finalOutput = {
      ...runOutput,
      generationCostEstimate: generation.bundle.presenceAssessment.generationCostEstimate
    };
    const finalMetadata = {
      ...runMetadata,
      generationCostStatus: generation.bundle.presenceAssessment.generationCostEstimate?.status,
      generationCostUnits: generation.bundle.presenceAssessment.generationCostEstimate?.estimatedUnits,
      generationCostBudgetUnits: generation.bundle.presenceAssessment.generationCostEstimate?.budgetUnits,
      previewStatus: options.preview?.create ? "admin_only_until_acceptance" : "skipped"
    };

    await telemetry.completeRun({
      targetType: "site_candidate",
      targetId: generation.id,
      outputSummary: runSummary(generation),
      outputJson: finalOutput,
      metadata: finalMetadata
    });

    return {
      runId: telemetry.runId,
      siteCandidateId: generation.id,
      generation,
      bundle: generation.bundle
    };
  } catch (error) {
    if (error instanceof PreCompileSiteCandidateBlockError) {
      const generation = await persistPreCompileBlockedGeneration({
        repository: options.repository,
        siteCandidateId: siteCandidateIdForRun(telemetry.runId),
        runId: telemetry.runId,
        input,
        candidatePurpose: options.candidatePurpose,
        block: error
      });
      await telemetry.completeRun({
        targetType: "site_candidate",
        targetId: generation.id,
        outputSummary: `Blocked before compile: ${error.message}`,
        outputJson: {
          ...baseRunOutput(generation),
          readiness: "blocked",
          blockers: error.blockers
        },
        metadata: {
          ...baseRunMetadata(generation, options.metadata),
          preCompileBlocked: true,
          preCompileBlockerCount: error.blockers.length
        }
      });
      return {
        runId: telemetry.runId,
        siteCandidateId: generation.id,
        generation,
        bundle: generation.bundle
      };
    }
    const detail = generationFailureDetail(error, {
      stage: "compile",
      code: "unknown_generation_failure",
      runId: telemetry.runId,
      siteCandidateId: siteCandidateIdForRun(telemetry.runId)
    });
    await persistFailedGenerationIfUseful({
      repository: options.repository,
      siteCandidateId: siteCandidateIdForRun(telemetry.runId),
      runId: telemetry.runId,
      input,
      sourceHost: currentSourceHost,
      bundle: currentBundle,
      candidatePurpose: options.candidatePurpose,
      failure: detail
    });
    await telemetry.failRun(error, {
      errorCode: detail.code,
      outputJson: { generationFailureDetail: serializeGenerationFailure(detail) },
      metadata: {
        ...options.metadata,
        generationFailureStage: detail.stage,
        generationFailureCode: detail.code
      }
    });
    throw generationFailure(error, detail);
  }
}

function errorCodeForIntakePreparation(error: unknown) {
  if (isLaunchMarketError(error)) return "unsupported_launch_market";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("url") || message.includes("hostname") || message.includes("fetch")) return "invalid_url";
  return "crawl_failed";
}

async function persistFailedGenerationIfUseful(input: {
  repository: SiteCandidateRepository;
  siteCandidateId: string;
  runId: string;
  input: CreateSiteInput;
  sourceHost?: string;
  bundle?: SiteBundle;
  candidatePurpose?: SiteCandidatePurpose;
  failure: GenerationFailureDetail;
}) {
  if (!failureStageShouldPersist(input.failure.stage)) return;
  try {
    const sourceUrl = input.bundle?.presenceAssessment.sourceUrl ?? input.input.url;
    const sourceHost = input.sourceHost ?? hostFromUrl(sourceUrl);
    const bundle = input.bundle
      ? failedBundleFromPartial(input.bundle, input.failure)
      : createFailedGenerationBundle({
          siteCandidateId: input.siteCandidateId,
          sourceUrl,
          sourceHost,
          failure: input.failure
        });
    const generation = await input.repository.createSiteCandidate({
      id: input.siteCandidateId,
      agentRunId: input.runId,
      sourceUrl,
      sourceHost,
      bundle,
      status: "blocked",
      candidatePurpose: input.candidatePurpose
    });
    await input.repository.upsertSiteArtifact(
      createGenerationFailureArtifact({
        siteCandidateId: generation.id,
        sourceUrl,
        sourceHost,
        failure: input.failure
      })
    );
  } catch (artifactError) {
    console.warn(
      `Generation failure artifact persistence skipped: ${
        artifactError instanceof Error ? artifactError.message : String(artifactError)
      }`
    );
  }
}

function failureStageShouldPersist(stage: GenerationFailureDetail["stage"]) {
  return stage === "asset_analysis" || stage === "planner" || stage === "copy" || stage === "compile" || stage === "qa";
}

/**
 * A known-service business that still resolves to general_local with low
 * classification confidence must block instead of shipping a generic local
 * site that cannot represent its trade.
 */
function assertVerticalResolutionForServiceBusiness(bundle: SiteBundle, sourceUrl: string | undefined) {
  if (bundle.businessProfile.vertical !== "general_local") return;
  if (!sourceUrl && !bundle.presenceAssessment.sourceUrl) return;
  const understanding = bundle.presenceAssessment.businessUnderstanding;
  const hasServiceSignals = bundle.businessProfile.services.length > 0 || (understanding?.cleanedServices.length ?? 0) > 0;
  if (!hasServiceSignals) return;
  const confidentGeneralLocal = Boolean(
    understanding &&
      understanding.vertical === "general_local" &&
      understanding.verticalConfidence >= understandingVerticalConfidenceFloor
  );
  if (confidentGeneralLocal) return;
  throw createPreCompileSiteCandidateBlock({
    message: "A service business could not be classified into a supported vertical with enough confidence to generate a credible site.",
    businessName: bundle.businessProfile.name,
    vertical: bundle.businessProfile.vertical,
    sourceUrl: bundle.presenceAssessment.sourceUrl ?? sourceUrl,
    candidateSlug: bundle.siteModel.slug,
    blockers: [
      {
        id: "vertical_unresolved_service_business",
        title: "Vertical classification is unresolved",
        detail: `Extracted services exist but the business fell back to general_local${
          understanding ? ` with confidence ${understanding.verticalConfidence.toFixed(2)}` : " without an understanding pass"
        }. Generating a generic local site would misrepresent the trade.`,
        category: "needs_operator_review",
        severity: "blocking"
      }
    ],
    artifactType: "vertical_classification_report",
    artifactPayload: {
      understanding: understanding ?? null,
      extractedServices: bundle.businessProfile.services
    }
  });
}

/**
 * Operators can explicitly approve a text-first candidate for a visual-trade
 * vertical via metadata.approvedTextFirstFallback (true or a reason string).
 * The approval is recorded on the bundle and downgrades the media-completeness
 * blocking finding to advisory.
 */
function applyTextFirstFallbackApproval(bundle: SiteBundle, options: GenerateSiteOptions) {
  const approval = options.metadata?.approvedTextFirstFallback;
  if (approval !== true && typeof approval !== "string") return;
  bundle.presenceAssessment.textFirstFallbackApproval = {
    approvedBy: options.actorId ?? options.actorType ?? "operator",
    reason: typeof approval === "string" && approval.trim()
      ? approval.trim()
      : "Operator approved a text-first fallback for this candidate.",
    approvedAt: new Date().toISOString()
  };
}

async function loadGenerationAssetLibraryAssets(bundle: SiteBundle): Promise<ApprovedAssetLibraryAsset[]> {
  const vertical = bundle.businessProfile.vertical;
  if (vertical !== "auto_services" && vertical !== "auto_body") return [];
  try {
    return await approvedAssetLibraryAssetsForVerticals(vertical === "auto_body" ? ["auto_body", "auto_services"] : ["auto_services"]);
  } catch (error) {
    bundle.presenceAssessment.technicalNotes.push(
      `Asset library lookup unavailable for ${vertical}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function logGenerateSiteProgress(event: string, payload: Record<string, unknown>) {
  if (process.env.LODESTA_GENERATE_SITE_PROGRESS !== "1") return;
  console.error(JSON.stringify({ event, ...payload }));
}

async function retryTransientGenerationStage<T>(stage: "asset_analysis" | "planner" | "copy", operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || !isRetryableTransientGenerationError(error)) throw error;
      logGenerateSiteProgress("model_stage_retry", {
        stage,
        attempt,
        nextAttempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  throw lastError;
}

/**
 * Phase 1 evidence layer: derive fact candidates (statuses per the evidence
 * model; preview compiles from system_selected_for_preview) and proposed
 * business_services mapped onto the canonical catalog. Failure here never
 * blocks generation — evidence is additive to the candidate record.
 */
async function persistEvidenceLayer(input: {
  repository: SiteCandidateRepository;
  generation: SiteCandidateRecord;
}) {
  try {
    const bundle = input.generation.bundle;
    const businessId = bundle.business?.id ?? input.generation.businessId;
    if (!businessId) return;
    const candidates = selectCandidatesForPreview(factCandidatesFromBundle(bundle, businessId));
    await input.repository.replaceFactCandidates(businessId, candidates);
    const services = proposedBusinessServices(businessId, bundle.businessProfile.vertical, bundle.businessProfile);
    await input.repository.replaceProposedBusinessServices(businessId, services);
  } catch (error) {
    console.warn(`Evidence layer persistence skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function maybeRegenerateGeneratedSite(input: {
  bundle: SiteBundle;
  siteCandidateId: string;
  readiness: GeneratedSiteReadinessResult;
  assetLibraryAssets: ApprovedAssetLibraryAsset[];
  telemetry: RequiredAgentTelemetryRecorder;
  modelFallbackPolicy: ModelFallbackPolicy;
  allowModelFallback: boolean;
  signal?: AbortSignal;
}): Promise<{ readiness: GeneratedSiteReadinessResult; application: Awaited<ReturnType<typeof applyGeneratedSiteV3WithAssetLibrary>> } | undefined> {
  if (input.readiness.verdict !== "needs_regen") return undefined;
  const failedVersion = input.bundle.siteModel.versions[0];
  if (!failedVersion || failedVersion.status === "published" || failedVersion.ownerTouched) return undefined;

  const mode = regenerationModeForQa(input.readiness.qa);
  const triggerFindings = regenerationFeedbackFromQa(input.readiness.qa);
  const failedVersionClone = structuredClone(failedVersion) as SiteVersion;
  failedVersionClone.id = `${failedVersion.id}_failed_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  failedVersionClone.generationQa = {
    ...input.readiness.qa,
    regeneration: {
      version: "generation-regeneration-v1",
      role: "initial_failed",
      attempt: 0,
      triggerVerdict: input.readiness.verdict,
      triggerFindings,
      mode,
      createdAt: new Date().toISOString()
    }
  };

  const regenSpan = await input.telemetry.startSpan({
    spanType: "generated_site_regeneration",
    name: "One-shot generated-site regeneration",
    inputJson: {
      siteCandidateId: input.siteCandidateId,
      failedVersionId: failedVersionClone.id,
      mode,
      triggerFindings
    }
  });

  try {
    if (mode === "planner_and_copy") {
      const plannerSpan = await input.telemetry.startSpan({
        spanType: "design_system_planner_v1",
        name: "Regeneration planner pass",
        parentSpanId: regenSpan.id,
        inputJson: {
          siteId: input.bundle.businessProfile.siteId,
          vertical: input.bundle.businessProfile.vertical,
          triggerFindings
        }
      });
      try {
        const siteDirector = createDeterministicSiteDirectorPlanV1({
          bundle: input.bundle,
          assetLibraryAssets: input.assetLibraryAssets
        });
        input.bundle.presenceAssessment.siteDirectorPlanV1 = siteDirector;
        await plannerSpan.end({
          outputJson: {
            source: siteDirector.source,
            validationStatus: siteDirector.validation.status,
            plannedSections: siteDirector.plan.home.sections.map((section) => section.id)
          }
        });
      } catch (error) {
        await plannerSpan.fail(error);
        throw generationFailure(error, {
          stage: "planner",
          code: "planner_unavailable",
          runId: input.telemetry.runId,
          siteCandidateId: input.siteCandidateId
        });
      }
    }

    input.bundle.presenceAssessment.siteDossierV1 = refreshSiteDossierCopyBriefV1(input.bundle);
    const copySpan = await input.telemetry.startSpan({
      spanType: "generated_copy_deck",
      name: "Regeneration copy deck",
      parentSpanId: regenSpan.id,
      inputJson: {
        siteId: input.bundle.businessProfile.siteId,
        mode,
        triggerFindings
      }
    });
    try {
      input.bundle.presenceAssessment.generatedCopyDeck = await retryTransientGenerationStage("copy", () =>
        createOpenAiGeneratedCopyDeck({
          bundle: input.bundle,
          telemetry: input.telemetry,
          spanId: copySpan.id,
          signal: input.signal,
          failureMode: !input.allowModelFallback ? "throw" : "return_undefined",
          regenerationFeedback: [
            "This is the single allowed regeneration attempt after final generated-site QA. Rewrite the copy to address the findings without inventing facts.",
            ...triggerFindings
          ]
        })
      );
      if (!input.bundle.presenceAssessment.generatedCopyDeck && !input.allowModelFallback) {
        throw generationFailure(new Error("Regeneration requires a model-backed copy deck."), {
          stage: "copy",
          code: "copy_empty_output",
          runId: input.telemetry.runId,
          siteCandidateId: input.siteCandidateId
        });
      }
      await copySpan.end({
        outputJson: {
          source: input.bundle.presenceAssessment.generatedCopyDeck ? "openai" : "deterministic_fallback",
          serviceItems: input.bundle.presenceAssessment.generatedCopyDeck?.serviceItems.length ?? 0
        }
      });
    } catch (error) {
      await copySpan.fail(error);
      throw generationFailure(error, {
        stage: "copy",
        code: "copy_unavailable",
        runId: input.telemetry.runId,
        siteCandidateId: input.siteCandidateId
      });
    }

    const application = input.assetLibraryAssets.length
      ? applyGeneratedSiteV3({ bundle: input.bundle, assetLibraryAssets: input.assetLibraryAssets })
      : await applyGeneratedSiteV3WithAssetLibrary({ bundle: input.bundle });
    await recordGeneratedSiteV3Application({
      telemetry: input.telemetry,
      bundle: input.bundle,
      application
    });
    const retriedVersion = input.bundle.siteModel.versions[0];
    if (retriedVersion) {
      input.bundle.siteModel.versions = [
        retriedVersion,
        failedVersionClone,
        ...input.bundle.siteModel.versions.slice(1).filter((version) => version.id !== failedVersionClone.id)
      ];
    }

    const retryReadiness = await runInitialGeneratedSiteReadiness({
      bundle: input.bundle,
      version: retriedVersion,
      telemetry: input.telemetry,
      spanId: regenSpan.id,
      modelFallbackPolicy: input.modelFallbackPolicy,
      qualitySignals: application.qualitySignals,
      signal: input.signal
    });
    retryReadiness.qa.regeneration = {
      version: "generation-regeneration-v1",
      role: "retry",
      attempt: 1,
      triggerVersionId: failedVersionClone.id,
      triggerVerdict: input.readiness.verdict,
      triggerFindings,
      mode,
      createdAt: new Date().toISOString()
    };
    if (retriedVersion) retriedVersion.generationQa = retryReadiness.qa;
    if (retryReadiness.verdict === "needs_regen") {
      retryReadiness.verdict = "operator_review";
    }
    await regenSpan.end({
      outputJson: {
        mode,
        retryReadiness: retryReadiness.qa.readiness,
        retryVerdict: retryReadiness.verdict,
        retryBlockers: retryReadiness.qa.blockers.length,
        triggerFindings
      }
    });
    return { readiness: retryReadiness, application };
  } catch (error) {
    await regenSpan.fail(error);
    throw error;
  }
}

function regenerationModeForQa(qa: GeneratedSiteReadinessResult["qa"]): "copy_only" | "planner_and_copy" {
  const text = [
    qa.visualQa?.summary,
    ...qa.blockers.map((blocker) => `${blocker.title} ${blocker.detail}`),
    ...(qa.visualQa?.findings ?? []).map((finding) => `${finding.category} ${finding.defectCategory ?? ""} ${finding.title} ${finding.evidence} ${finding.recommendation ?? ""}`)
  ].filter(Boolean).join("\n").toLowerCase();
  if (/\b(layout|spacing|overflow|responsive|mobile|media|image|photo|crop|blank|broken|contrast|section|hierarchy|navigation)\b/.test(text)) {
    return "planner_and_copy";
  }
  return "copy_only";
}

function regenerationFeedbackFromQa(qa: GeneratedSiteReadinessResult["qa"]) {
  const findings = [
    ...qa.blockers.map((blocker) => `${blocker.title}: ${blocker.detail}`),
    ...(qa.visualQa?.findings ?? [])
      .filter((finding) => finding.severity === "fail" || finding.severity === "warning")
      .map((finding) => `${finding.title}: ${finding.evidence}${finding.recommendation ? ` Recommendation: ${finding.recommendation}` : ""}`)
  ];
  if (qa.visualQa?.summary) findings.unshift(`Visual QA summary: ${qa.visualQa.summary}`);
  return findings.slice(0, 12);
}

async function persistCopyDeckArtifacts(input: {
  repository: SiteCandidateRepository;
  generation: SiteCandidateRecord;
}) {
  const brandCueReport = input.generation.bundle.presenceAssessment.brandCueReport;
  if (brandCueReport) {
    await input.repository.upsertSiteArtifact({
      id: `${input.generation.id}_brand_cues`,
      siteCandidateId: input.generation.id,
      scope: "candidate_selected",
      artifactType: "brand_cue_report",
      artifactVersion: "brand-cue-report-v2",
      producerId: "brand-expression-v1",
      producerVersion: "brand-expression-v1",
      sourceFactIds: [],
      contentHash: contentHash(brandCueReport),
      payload: { report: brandCueReport },
      createdAt: new Date().toISOString()
    });
  }
  const dossier = input.generation.bundle.presenceAssessment.siteDossierV1;
  if (dossier) {
    await input.repository.upsertSiteArtifact({
      id: `${input.generation.id}_site_dossier_v1`,
      siteCandidateId: input.generation.id,
      scope: "qa_evidence",
      artifactType: "business_context_report",
      artifactVersion: dossier.version,
      producerId: dossier.producerId,
      producerVersion: dossier.producerVersion,
      sourceFactIds: input.generation.bundle.presenceAssessment.businessFactGraph?.facts.map((fact) => fact.id) ?? [],
      contentHash: dossier.contentHash,
      payload: { dossier },
      createdAt: new Date().toISOString()
    });
  }
  const deck = input.generation.bundle.presenceAssessment.generatedCopyDeck;
  if (!deck) return;
  const createdAt = new Date().toISOString();
  const lintViolations = lintGeneratedCopyDeck(deck);
  await input.repository.upsertSiteArtifact({
    id: `${input.generation.id}_copy_deck`,
    siteCandidateId: input.generation.id,
    scope: "candidate_selected",
    artifactType: "copy_artifact",
    artifactVersion: "generated-copy-deck-v2",
    producerId: "generated-copy-v2",
    producerVersion: "generated-copy-deck-v2",
    sourceFactIds: [],
    contentHash: contentHash(deck),
    payload: { deck },
    createdAt
  });
  await input.repository.upsertSiteArtifact({
    id: `${input.generation.id}_copy_evaluation`,
    siteCandidateId: input.generation.id,
    scope: "qa_evidence",
    artifactType: "copy_evaluation_report",
    artifactVersion: "generated-copy-deck-v2",
    producerId: "generated-copy-v2",
    producerVersion: "generated-copy-deck-v2",
    sourceFactIds: [],
    contentHash: contentHash({ lintViolations, groundingNotes: deck.groundingNotes }),
    payload: {
      lintViolations,
      groundingNotes: deck.groundingNotes,
      status: lintViolations.length ? "violations_found" : "passed"
    },
    createdAt
  });
}

async function persistPreCompileBlockedGeneration(input: {
  repository: SiteCandidateRepository;
  siteCandidateId: string;
  runId: string;
  input: CreateSiteInput;
  candidatePurpose?: SiteCandidatePurpose;
  block: PreCompileSiteCandidateBlockError;
}) {
  const sourceUrl = input.block.sourceUrl ?? input.input.url;
  const sourceHost = input.block.sourceHost ?? hostFromUrl(sourceUrl);
  const bundle = createPreCompileBlockedBundle({
    siteCandidateId: input.siteCandidateId,
    sourceUrl,
    sourceHost,
    block: input.block
  });
  const generation = await input.repository.createSiteCandidate({
    id: input.siteCandidateId,
    agentRunId: input.runId,
    sourceUrl,
    sourceHost,
    bundle,
    status: "blocked",
    candidatePurpose: input.candidatePurpose
  });
  await input.repository.upsertSiteArtifact(
    createPreCompileBlockArtifact({
      siteCandidateId: generation.id,
      sourceUrl,
      sourceHost,
      block: input.block
    })
  );
  return generation;
}

function createPreCompileBlockedBundle(input: {
  siteCandidateId: string;
  sourceUrl?: string;
  sourceHost?: string;
  block: PreCompileSiteCandidateBlockError;
}): SiteBundle {
  const businessName = input.block.businessName ?? input.sourceHost ?? "Blocked site candidate";
  const candidateSlug = slugify(input.block.candidateSlug ?? businessName) || input.siteCandidateId;
  return {
    businessProfile: {
      id: input.siteCandidateId,
      siteId: input.siteCandidateId,
      name: businessName,
      vertical: input.block.vertical ?? "general_local",
      categories: [],
      services: [],
      serviceAreas: [],
      socialLinks: [],
      bookingLinks: [],
      orderingLinks: [],
      photos: [],
      pressLinks: [],
      provenance: {}
    },
    siteModel: {
      id: input.siteCandidateId,
      slug: candidateSlug,
      theme: blockedGenerationTheme(),
      versions: [],
      pinList: []
    },
    extensionModel: {
      forms: [],
      workflows: [],
      customBlocks: []
    },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: input.siteCandidateId,
      sourceUrl: input.sourceUrl,
      technicalNotes: [`Blocked before compile: ${input.block.message}`],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function failedBundleFromPartial(bundle: SiteBundle, failure: GenerationFailureDetail): SiteBundle {
  const failed = structuredClone(bundle);
  failed.presenceAssessment.technicalNotes = [
    ...failed.presenceAssessment.technicalNotes,
    `Generation failed at ${failure.stage} (${failure.code}): ${failure.message}`
  ];
  return failed;
}

function createFailedGenerationBundle(input: {
  siteCandidateId: string;
  sourceUrl?: string;
  sourceHost?: string;
  failure: GenerationFailureDetail;
}): SiteBundle {
  const businessName = input.sourceHost ?? "Failed site candidate";
  const candidateSlug = slugify(businessName) || input.siteCandidateId;
  return {
    businessProfile: {
      id: input.siteCandidateId,
      siteId: input.siteCandidateId,
      name: businessName,
      vertical: "general_local",
      categories: [],
      services: [],
      serviceAreas: [],
      socialLinks: [],
      bookingLinks: [],
      orderingLinks: [],
      photos: [],
      pressLinks: [],
      provenance: {}
    },
    siteModel: {
      id: input.siteCandidateId,
      slug: candidateSlug,
      theme: blockedGenerationTheme(),
      versions: [],
      pinList: []
    },
    extensionModel: {
      forms: [],
      workflows: [],
      customBlocks: []
    },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: input.siteCandidateId,
      sourceUrl: input.sourceUrl,
      technicalNotes: [`Generation failed at ${input.failure.stage} (${input.failure.code}): ${input.failure.message}`],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function createPreCompileBlockArtifact(input: {
  siteCandidateId: string;
  sourceUrl?: string;
  sourceHost?: string;
  block: PreCompileSiteCandidateBlockError;
}): SiteArtifactRecord {
  const createdAt = new Date().toISOString();
  const payload = {
    status: "blocked",
    phase: "pre_compile",
    message: input.block.message,
    sourceUrl: input.sourceUrl,
    sourceHost: input.sourceHost,
    blockers: input.block.blockers,
    ...input.block.artifactPayload
  };
  return {
    id: `${input.siteCandidateId}_precompile_block`,
    siteCandidateId: input.siteCandidateId,
    scope: "qa_evidence",
    artifactType: input.block.artifactType,
    artifactVersion: "precompile-block-v1",
    producerId: "site-candidate-service",
    producerVersion: "precompile-block-v1",
    sourceFactIds: [],
    contentHash: contentHash(payload),
    payload,
    createdAt
  };
}

function createGenerationFailureArtifact(input: {
  siteCandidateId: string;
  sourceUrl?: string;
  sourceHost?: string;
  failure: GenerationFailureDetail;
}): SiteArtifactRecord {
  const createdAt = new Date().toISOString();
  const failure = serializeGenerationFailure(input.failure);
  const payload = {
    status: "failed",
    phase: "generation",
    sourceUrl: input.sourceUrl,
    sourceHost: input.sourceHost,
    failure
  };
  return {
    id: `${input.siteCandidateId}_generation_failure`,
    siteCandidateId: input.siteCandidateId,
    scope: "qa_evidence",
    artifactType: "business_context_report",
    artifactVersion: "generation-failure-v1",
    producerId: "site-candidate-service",
    producerVersion: "generation-failure-v1",
    sourceFactIds: [],
    contentHash: contentHash(payload),
    payload,
    createdAt
  };
}

async function recordGeneratedSiteV3Application(input: {
  telemetry: Awaited<ReturnType<typeof startRequiredSiteCandidateTelemetry>>;
  bundle: SiteBundle;
  application: Awaited<ReturnType<typeof applyGeneratedSiteV3>>;
}) {
  const span = await input.telemetry.startSpan({
    spanType: "generated_site_v3",
    name: "Generated-site V3 routing",
    inputJson: {
      siteId: input.bundle.businessProfile.siteId,
      vertical: input.bundle.businessProfile.vertical
    }
  });
  await span.end({
    outputJson: {
      applied: input.application.applied,
      reason: input.application.reason,
      rendererVersion: input.bundle.siteModel.versions[0]?.rendererVersion,
      designSchemaVersion: input.bundle.siteModel.versions[0]?.designSchemaVersion,
      backgroundKinds: generatedSiteV3BackgroundKinds(input.bundle)
    }
  });
}

function generatedSiteV3BackgroundKinds(bundle: SiteBundle) {
  const version = bundle.siteModel.versions[0];
  if (!version || !("pageComposition" in version)) return [];
  const kinds = new Set<string>();
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visualSection = getVisualSectionV3(section.props);
      if (visualSection) kinds.add(visualSection.options.background.kind);
    }
  }
  return [...kinds].sort();
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

function baseRunMetadata(generation: SiteCandidateRecord, metadata: Record<string, unknown> | undefined) {
  return {
    ...metadata,
    targetName: generation.businessName,
    siteCandidateId: generation.id,
    candidateSlug: generation.candidateSlug,
    generationUrl: `/admin/site-candidates/${generation.id}`,
    pages: generation.bundle.siteModel.versions[0] ? pageCountForVersionV3(assertSiteVersionV3(generation.bundle.siteModel.versions[0], "candidate run metadata version")) : 0,
    vertical: generation.vertical
  };
}

function blockedGenerationTheme() {
  return {
    paletteName: "Blocked generation",
    colors: {
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      primary: "#1d4ed8",
      primaryText: "#ffffff",
      accent: "#f59e0b",
      border: "#dbe3ea"
    },
    typography: {
      heading: "Inter",
      body: "Inter"
    },
    radius: "sm" as const,
    density: "standard" as const,
    mood: "utilitarian" as const
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

import { createHash } from "node:crypto";
import {
  startRequiredSiteCandidateTelemetry,
  type AgentTelemetryRepository
} from "./agent-telemetry";
import { createSiteV3FromInput, type IntakeInput } from "./intake";
import { slugify } from "./slug";
import { prepareIntakeInput } from "./intake-pipeline";
import { understandingVerticalConfidenceFloor } from "./business-understanding-v2";
import { generateWordmarkCandidateV2, wordmarkCandidateArtifactV2 } from "./brand-wordmark-v2";
import { factCandidatesFromBundle, proposedBusinessServices, selectCandidatesForPreview } from "./business-evidence";
import { castScrapedPhotos, scrapeAndStoreBusinessMedia } from "./scraped-media";
import { extractImagePalette } from "./image-palette";
import { createOpenAiGeneratedCopyDeck, lintGeneratedCopyDeck } from "./generated-copy-v2";
import { runInitialGeneratedSiteReadiness } from "./generated-site-readiness";
import { persistPrimaryQaScreenshot } from "./candidate-screenshot";
import { runShadowCraftLoop } from "./craft-loop";
import { createOpenAiSiteDirectorPlanV1 } from "./site-director-plan-generation-v1";
import { analyzeBusinessAssetsV1 } from "./asset-analysis-v1";
import { applyGeneratedSiteV3, applyGeneratedSiteV3WithAssetLibrary } from "./generated-site-v3-pipeline";
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
  Vertical
} from "./models";
import type { CreateSiteInput, LodestaRepository } from "./repository";
import { normalizePublicFetchUrlInput } from "./url-safety";

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
  const modelFallbackPolicy = options.modelFallbackPolicy ?? "fail";
  const allowModelFallback = modelFallbackPolicy === "allow";
  const telemetry = await startRequiredSiteCandidateTelemetry(options.repository, {
    ...input,
    source: options.source,
    actorType: options.actorType,
    actorId: options.actorId,
    metadata: options.metadata
  });

  try {
    const siteCandidateId = siteCandidateIdForRun(telemetry.runId);
    const identity = { siteId: siteCandidateId };
    logGenerateSiteProgress("prepare_intake_start", { siteCandidateId });
    const prepared = await prepareIntakeInput(input, { telemetry, identity });
    logGenerateSiteProgress("prepare_intake_done", {
      siteCandidateId,
      sourceUrl: prepared.url,
      crawlStatus: prepared.crawl?.status,
      understandingSource: prepared.understanding?.source,
      understandingVertical: prepared.understanding?.vertical,
      cleanedServices: prepared.understanding?.cleanedServices.length ?? 0,
      sourceScreenshots: prepared.renderInspection?.screenshots.length ?? 0
    });
    assertCanonicalModelStagesAvailable(prepared, allowModelFallback);
    logGenerateSiteProgress("compile_input_start", { siteCandidateId });
    const bundle = createSiteV3FromInput({
      ...prepared,
      identity,
      experimentLearnings: await options.repository.listExperimentLearnings({ status: "active" })
    });
    logGenerateSiteProgress("compile_input_done", {
      siteCandidateId,
      businessName: bundle.businessProfile.name,
      vertical: bundle.businessProfile.vertical,
      services: bundle.businessProfile.services.length
    });
    const sourceHost = hostFromUrl(bundle.presenceAssessment.sourceUrl ?? input.url);
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
    // Real photos for protected previews: download crawl media into private
    // storage (reference_only; publish requires per-photo attestation).
    try {
      logGenerateSiteProgress("scraped_media_start", {
        siteCandidateId,
        sourcePhotos: bundle.businessProfile.photos.length
      });
      const scrapedManifest = await scrapeAndStoreBusinessMedia(bundle);
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
      const assetAnalysis = await analyzeBusinessAssetsV1({
        bundle,
        telemetry,
        spanId: assetAnalysisSpan.id,
        strict: !allowModelFallback
      });
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
        throw new Error(
          `Canonical generateSite requires model-backed AssetAnalysisV1 for first-party/source imagery; ${
            assetAnalysisError instanceof Error ? assetAnalysisError.message : String(assetAnalysisError)
          }`
        );
      }
      console.warn("Asset analysis unavailable; explicit development fallback may use deterministic asset heuristics.", assetAnalysisError instanceof Error ? assetAnalysisError.message : assetAnalysisError);
    }
    const directorSpan = await telemetry.startSpan({
      spanType: "site_director_plan_v1",
      name: "Catalog-bounded site director plan",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        vertical: bundle.businessProfile.vertical,
        services: bundle.businessProfile.services.length,
        assets: bundle.businessProfile.photos.length + (bundle.businessProfile.logo ? 1 : 0)
      }
    });
    try {
      logGenerateSiteProgress("site_director_start", { siteCandidateId });
      const siteDirector = await createOpenAiSiteDirectorPlanV1({
        bundle,
        telemetry,
        spanId: directorSpan.id,
        strict: !allowModelFallback
      });
      if (siteDirector) {
        bundle.presenceAssessment.siteDirectorPlanV1 = siteDirector;
        bundle.presenceAssessment.generationPlanningSource = "openai";
      } else if (!allowModelFallback) {
        throw new Error("OpenAI site director plan was unavailable.");
      }
      logGenerateSiteProgress("site_director_done", {
        siteCandidateId,
        source: siteDirector?.source ?? "none",
        plannedSections: siteDirector?.plan.home.sections.length ?? 0,
        catalogSchemaHash: siteDirector?.catalogSchemaHash,
        businessDirectorInputHash: siteDirector?.businessDirectorInputHash
      });
      await directorSpan.end({
        outputJson: {
          source: siteDirector?.source ?? "none",
          model: siteDirector?.model,
          plannedSections: siteDirector?.plan.home.sections.map((section) => ({
            id: section.id,
            role: section.role,
            templateId: section.templateId,
            presentation: section.presentation
          })),
          catalogSchemaHash: siteDirector?.catalogSchemaHash,
          businessDirectorInputHash: siteDirector?.businessDirectorInputHash,
          planInputHash: siteDirector?.planInputHash,
          validationStatus: siteDirector?.validation.status
        }
      });
    } catch (directorError) {
      await directorSpan.fail(directorError);
      logGenerateSiteProgress("site_director_failed", {
        siteCandidateId,
        error: directorError instanceof Error ? directorError.message : String(directorError)
      });
      if (!allowModelFallback) {
        throw new Error(
          `Canonical generateSite requires a model-backed SiteDirectorPlanV1; deterministic creative fallback is disabled. ${
            directorError instanceof Error ? directorError.message : String(directorError)
          }`
        );
      }
      console.warn("Site director unavailable; existing design brief/compiler controls will be used.", directorError instanceof Error ? directorError.message : directorError);
    }
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
      bundle.presenceAssessment.generatedCopyDeck = await createOpenAiGeneratedCopyDeck({
        bundle,
        telemetry,
        spanId: copySpan.id
      });
      if (!bundle.presenceAssessment.generatedCopyDeck && !allowModelFallback) {
        throw new Error("Canonical generateSite requires a model-backed copy deck; deterministic copy fallback is disabled.");
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
      throw error;
    }
    logGenerateSiteProgress("apply_v3_start", { siteCandidateId });
    const v3Application = await applyGeneratedSiteV3WithAssetLibrary({ bundle });
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
        qualitySignals: v3Application.qualitySignals
      });
      logGenerateSiteProgress("readiness_done", {
        siteCandidateId,
        status: readiness.status,
        readiness: readiness.qa.readiness,
        verdict: readiness.qa.scorecard?.verdict,
        visualQaSource: readiness.qa.visualQa?.source,
        blockers: readiness.qa.blockers.length
      });
      await qaSpan.end({
        outputJson: {
          readiness: readiness.qa.readiness,
          blockers: readiness.qa.blockers.length,
          warnings: readiness.qa.warnings.length,
          repaired: readiness.repaired,
          repairAttempted: readiness.qa.repair?.attempted ?? false,
          repairSummaries: readiness.qa.repair?.mutationSummaries ?? [],
          qualityVerdict: readiness.qa.scorecard?.verdict,
          qualityDimensions: readiness.qa.scorecard?.dimensions.map((dimension) => ({
            id: dimension.id,
            score: dimension.score,
            required: dimension.requirement === "required",
            passes: dimension.passes,
            premiumPasses: dimension.premiumPasses
          })),
          qualityBlockingFindings: readiness.qa.qualityReport?.findings.filter((finding) => finding.severity === "blocking").length ?? 0,
          qualityRubric: readiness.qa.qualityReport?.rubric,
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
    } catch (error) {
      await qaSpan.fail(error);
      throw error;
    }
    // Shadow craft loop (opt-in via LODESTA_CRAFT_LOOP=shadow): observes what
    // typed Tier-1 mutations would do; never alters the served candidate.
    try {
      const version = bundle.siteModel.versions[0];
      if (version) {
        const craftLoop = await runShadowCraftLoop({ bundle, version, qa: readiness.qa, telemetry, spanId: qaSpan.id });
        if (craftLoop && version.generationQa) version.generationQa.craftLoop = craftLoop;
      }
    } catch (craftLoopError) {
      console.warn("Shadow craft loop failed (non-fatal):", craftLoopError instanceof Error ? craftLoopError.message : craftLoopError);
    }
    try {
      const version = bundle.siteModel.versions[0];
      if (version) await persistPrimaryQaScreenshot({ candidateId: siteCandidateId, version });
    } catch (screenshotError) {
      console.warn(
        "QA screenshot persistence failed (non-fatal):",
        screenshotError instanceof Error ? screenshotError.message : screenshotError
      );
    }
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
    await telemetry.failRun(error);
    throw error;
  }
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

function logGenerateSiteProgress(event: string, payload: Record<string, unknown>) {
  if (process.env.LODESTA_GENERATE_SITE_PROGRESS !== "1") return;
  console.error(JSON.stringify({ event, ...payload }));
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

async function persistCopyDeckArtifacts(input: {
  repository: SiteCandidateRepository;
  generation: SiteCandidateRecord;
}) {
  const wordmarkVersion = input.generation.bundle.siteModel.versions[0];
  if (wordmarkVersion?.rendererVersion === "layout-v3" && wordmarkVersion.theme) {
    await input.repository.upsertSiteArtifact(
      wordmarkCandidateArtifactV2({
        siteCandidateId: input.generation.id,
        candidate: generateWordmarkCandidateV2({
          business: input.generation.bundle.businessProfile,
          theme: wordmarkVersion.theme,
          fontPairingId: wordmarkVersion.artDirection.fontPairingId
        })
      })
    );
  }
  const brandCueReport = input.generation.bundle.presenceAssessment.brandCueReport;
  if (brandCueReport) {
    await input.repository.upsertSiteArtifact({
      id: `${input.generation.id}_brand_cues`,
      siteCandidateId: input.generation.id,
      scope: "candidate_selected",
      artifactType: "brand_cue_report",
      artifactVersion: "brand-cue-report-v2",
      producerId: "brand-derivation-v2",
      producerVersion: "brand-cue-report-v2",
      sourceFactIds: [],
      contentHash: contentHash(brandCueReport),
      payload: { report: brandCueReport },
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

import { createHash } from "node:crypto";
import {
  startRequiredSiteGenerationTelemetry,
  type AgentTelemetryRepository
} from "./agent-telemetry";
import { createSiteFromInput, slugify } from "./intake";
import { prepareIntakeInput } from "./intake-pipeline";
import { runInitialGeneratedSiteReadiness } from "./generated-site-readiness";
import { createOpenAiSiteDirectorPlan } from "./openai-site-director";
import { copyArtifactsToGenerationArtifacts, maybeApplyGeneratedSiteV2 } from "./generated-site-v2-pipeline";
import { maybeApplyGeneratedSiteV3 } from "./generated-site-v3-pipeline";
import { evaluatePreCompileResolutionGateV2 } from "./precompile-resolution-gate";
import type {
  AgentRunSource,
  CopyArtifactV2,
  GenerationArtifactV2,
  GenerationQaBlocker,
  SiteBundle,
  SiteGenerationRecord,
  Vertical
} from "./models";
import type { CreateSiteInput, LodestaRepository } from "./repository";
import { normalizePublicFetchUrlInput } from "./url-safety";

export type SiteGenerationRepository = AgentTelemetryRepository &
  Pick<LodestaRepository, "createSiteGeneration" | "listExperimentLearnings" | "upsertGenerationArtifact">;

export type GenerateSitePreviewOptions = {
  create?: boolean;
  expiresAt?: string;
  origin?: string;
};

export type GenerateSiteOptions = {
  repository: SiteGenerationRepository;
  input: CreateSiteInput;
  source: AgentRunSource;
  actorType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  preview?: GenerateSitePreviewOptions;
};

export type GenerateSiteResult = {
  runId: string;
  generationId: string;
  generation: SiteGenerationRecord;
  bundle: SiteBundle;
  preview?: undefined;
  previewError?: undefined;
};

export type PreCompileSiteGenerationBlockInput = {
  message: string;
  businessName?: string;
  vertical?: Vertical;
  sourceUrl?: string;
  sourceHost?: string;
  candidateSlug?: string;
  blockers: GenerationQaBlocker[];
  artifactType?: GenerationArtifactV2["artifactType"];
  artifactPayload?: Record<string, unknown>;
};

export class PreCompileSiteGenerationBlockError extends Error {
  code = "precompile_generation_block" as const;
  businessName?: string;
  vertical?: Vertical;
  sourceUrl?: string;
  sourceHost?: string;
  candidateSlug?: string;
  blockers: GenerationQaBlocker[];
  artifactType: GenerationArtifactV2["artifactType"];
  artifactPayload: Record<string, unknown>;

  constructor(input: PreCompileSiteGenerationBlockInput) {
    super(input.message);
    this.name = "PreCompileSiteGenerationBlockError";
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

export function createPreCompileSiteGenerationBlock(input: PreCompileSiteGenerationBlockInput) {
  return new PreCompileSiteGenerationBlockError(input);
}

export async function generateSite(options: GenerateSiteOptions): Promise<GenerateSiteResult> {
  const input = normalizeGenerationInput(options.input);
  const telemetry = await startRequiredSiteGenerationTelemetry(options.repository, {
    ...input,
    source: options.source,
    actorType: options.actorType,
    actorId: options.actorId,
    metadata: options.metadata
  });

  try {
    const generationId = siteGenerationIdForRun(telemetry.runId);
    const identity = { siteId: generationId };
    const prepared = await prepareIntakeInput(input, { telemetry, identity });
    const bundle = createSiteFromInput({
      ...prepared,
      identity,
      experimentLearnings: await options.repository.listExperimentLearnings({ status: "active" })
    });
    const sourceHost = hostFromUrl(bundle.presenceAssessment.sourceUrl ?? input.url);
    const resolutionGate = evaluatePreCompileResolutionGateV2(bundle);
    if (resolutionGate.status === "blocked") {
      throw createPreCompileSiteGenerationBlock({
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
    const v3Application = maybeApplyGeneratedSiteV3({
      bundle,
      sourceHost,
      explicitOperatorRequest: isExplicitV3Request(options.metadata)
    });
    await recordGeneratedSiteV3Application({
      telemetry,
      bundle,
      application: v3Application
    });
    const v2Application = v3Application.applied
      ? { applied: false, reason: "layout-v2 skipped because layout-v3 was applied.", copyArtifacts: [] }
      : maybeApplyGeneratedSiteV2({
          bundle,
          sourceHost,
          explicitOperatorRequest: isExplicitV2Request(options.metadata)
        });
    await recordGeneratedSiteV2Application({
      telemetry,
      bundle,
      application: v2Application
    });
    await runSiteDirector({ bundle, telemetry });
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
      readiness = await runInitialGeneratedSiteReadiness({ bundle, telemetry, spanId: qaSpan.id });
      await qaSpan.end({
        outputJson: {
          readiness: readiness.qa.readiness,
          blockers: readiness.qa.blockers.length,
          warnings: readiness.qa.warnings.length,
          repaired: readiness.repaired,
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
    const generation = await options.repository.createSiteGeneration({
      id: generationId,
      agentRunId: telemetry.runId,
      sourceUrl: bundle.presenceAssessment.sourceUrl ?? input.url,
      sourceHost,
      bundle,
      status: readiness.status
    });
    await storeGeneratedSiteV2Artifacts({
      repository: options.repository,
      generationId,
      copyArtifacts: v2Application.copyArtifacts
    });
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
      previewStatus: options.preview?.create ? "admin_only_until_promotion" : "skipped"
    };

    await telemetry.completeRun({
      targetType: "site_generation",
      targetId: generation.id,
      outputSummary: runSummary(generation),
      outputJson: finalOutput,
      metadata: finalMetadata
    });

    return {
      runId: telemetry.runId,
      generationId: generation.id,
      generation,
      bundle: generation.bundle
    };
  } catch (error) {
    if (error instanceof PreCompileSiteGenerationBlockError) {
      const generation = await persistPreCompileBlockedGeneration({
        repository: options.repository,
        generationId: siteGenerationIdForRun(telemetry.runId),
        runId: telemetry.runId,
        input,
        block: error
      });
      await telemetry.completeRun({
        targetType: "site_generation",
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
        generationId: generation.id,
        generation,
        bundle: generation.bundle
      };
    }
    await telemetry.failRun(error);
    throw error;
  }
}

async function persistPreCompileBlockedGeneration(input: {
  repository: SiteGenerationRepository;
  generationId: string;
  runId: string;
  input: CreateSiteInput;
  block: PreCompileSiteGenerationBlockError;
}) {
  const sourceUrl = input.block.sourceUrl ?? input.input.url;
  const sourceHost = input.block.sourceHost ?? hostFromUrl(sourceUrl);
  const bundle = createPreCompileBlockedBundle({
    generationId: input.generationId,
    sourceUrl,
    sourceHost,
    block: input.block
  });
  const generation = await input.repository.createSiteGeneration({
    id: input.generationId,
    agentRunId: input.runId,
    sourceUrl,
    sourceHost,
    bundle,
    status: "blocked"
  });
  await input.repository.upsertGenerationArtifact(
    createPreCompileBlockArtifact({
      generationId: generation.id,
      sourceUrl,
      sourceHost,
      block: input.block
    })
  );
  return generation;
}

function createPreCompileBlockedBundle(input: {
  generationId: string;
  sourceUrl?: string;
  sourceHost?: string;
  block: PreCompileSiteGenerationBlockError;
}): SiteBundle {
  const businessName = input.block.businessName ?? input.sourceHost ?? "Blocked site generation";
  const candidateSlug = slugify(input.block.candidateSlug ?? businessName) || input.generationId;
  return {
    businessProfile: {
      id: input.generationId,
      siteId: input.generationId,
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
      id: input.generationId,
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
      siteId: input.generationId,
      sourceUrl: input.sourceUrl,
      technicalNotes: [`Blocked before compile: ${input.block.message}`],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function createPreCompileBlockArtifact(input: {
  generationId: string;
  sourceUrl?: string;
  sourceHost?: string;
  block: PreCompileSiteGenerationBlockError;
}): GenerationArtifactV2 {
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
    id: `${input.generationId}_precompile_block`,
    generationId: input.generationId,
    scope: "qa_evidence",
    artifactType: input.block.artifactType,
    artifactVersion: "precompile-block-v1",
    producerId: "site-generation-service",
    producerVersion: "precompile-block-v1",
    sourceFactIds: [],
    contentHash: contentHash(payload),
    payload,
    createdAt
  };
}

async function runSiteDirector(input: {
  bundle: SiteBundle;
  telemetry: Awaited<ReturnType<typeof startRequiredSiteGenerationTelemetry>>;
}) {
  const version = input.bundle.siteModel.versions[0];
  const factGraph = input.bundle.presenceAssessment.businessFactGraph;
  const plan = input.bundle.presenceAssessment.generationPlanV2;
  if (!version || version.rendererVersion === "layout-v2" || version.rendererVersion === "layout-v3" || !factGraph || !plan) return;

  const span = await input.telemetry.startSpan({
    spanType: "ai_site_director",
    name: "AI Site Director",
    inputJson: {
      siteId: input.bundle.businessProfile.siteId,
      versionId: version.id,
      planId: plan.id,
      sections: plan.pages.reduce((count, page) => count + page.sections.length, 0),
      facts: factGraph.facts.length
    }
  });
  try {
    const directedPlan = await createOpenAiSiteDirectorPlan({
      bundle: input.bundle,
      version,
      factGraph,
      plan,
      telemetry: input.telemetry,
      spanId: span.id
    });
    if (directedPlan) {
      input.bundle.presenceAssessment.generationPlanV2 = directedPlan;
    }
    const finalPlan = input.bundle.presenceAssessment.generationPlanV2;
    await span.end({
      outputJson: {
        source: finalPlan?.source,
        status: finalPlan?.directorRun?.status ?? "not_run",
        directorSource: finalPlan?.directorRun?.source ?? "deterministic",
        model: finalPlan?.directorRun?.model,
        issues: finalPlan?.directorRun?.issues?.length ?? 0
      }
    });
  } catch (error) {
    await span.fail(error, {
      outputJson: {
        fallback: "deterministic_site_director"
      }
    });
    throw error;
  }
}

async function recordGeneratedSiteV2Application(input: {
  telemetry: Awaited<ReturnType<typeof startRequiredSiteGenerationTelemetry>>;
  bundle: SiteBundle;
  application: ReturnType<typeof maybeApplyGeneratedSiteV2>;
}) {
  const span = await input.telemetry.startSpan({
    spanType: "generated_site_v2",
    name: "Generated-site V2 routing",
    inputJson: {
      siteId: input.bundle.businessProfile.siteId,
      vertical: input.bundle.businessProfile.vertical
    }
  });
  await span.end({
    outputJson: {
      applied: input.application.applied,
      reason: input.application.reason,
      copyArtifacts: input.application.copyArtifacts.length,
      rendererVersion: input.bundle.siteModel.versions[0]?.rendererVersion,
      designSchemaVersion: input.bundle.siteModel.versions[0]?.designSchemaVersion
    }
  });
}

async function recordGeneratedSiteV3Application(input: {
  telemetry: Awaited<ReturnType<typeof startRequiredSiteGenerationTelemetry>>;
  bundle: SiteBundle;
  application: ReturnType<typeof maybeApplyGeneratedSiteV3>;
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
      designSchemaVersion: input.bundle.siteModel.versions[0]?.designSchemaVersion
    }
  });
}

async function storeGeneratedSiteV2Artifacts(input: {
  repository: Pick<LodestaRepository, "upsertGenerationArtifact">;
  generationId: string;
  copyArtifacts: CopyArtifactV2[];
}) {
  if (!input.copyArtifacts.length) return;
  const artifacts = copyArtifactsToGenerationArtifacts({
    generationId: input.generationId,
    artifacts: input.copyArtifacts
  });
  for (const artifact of artifacts) await input.repository.upsertGenerationArtifact(artifact);
}

function isExplicitV2Request(metadata: Record<string, unknown> | undefined) {
  return metadata?.generatedSiteV2 === true || metadata?.rendererVersion === "layout-v2";
}

function isExplicitV3Request(metadata: Record<string, unknown> | undefined) {
  return metadata?.generatedSiteV3 === true || metadata?.rendererVersion === "layout-v3";
}

function normalizeGenerationInput(input: CreateSiteInput): CreateSiteInput {
  const url = input.url ? normalizePublicFetchUrlInput(input.url) || undefined : undefined;
  const prompt = input.prompt?.trim() || undefined;
  if (!url && !prompt) throw new Error("Provide a URL or prompt.");
  return { url, prompt };
}

function runSummary(generation: SiteGenerationRecord) {
  return `${generation.businessName} (${generation.candidateSlug})`;
}

function baseRunOutput(generation: SiteGenerationRecord) {
  return {
    generationId: generation.id,
    candidateSiteId: generation.bundle.businessProfile.siteId,
    candidateSlug: generation.candidateSlug,
    businessName: generation.businessName,
    vertical: generation.vertical
  };
}

function baseRunMetadata(generation: SiteGenerationRecord, metadata: Record<string, unknown> | undefined) {
  return {
    ...metadata,
    targetName: generation.businessName,
    generationId: generation.id,
    candidateSlug: generation.candidateSlug,
    generationUrl: `/admin/site-generations/${generation.id}`,
    pages: generation.bundle.siteModel.versions[0]?.pages.length ?? 0,
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

function siteGenerationIdForRun(runId: string) {
  return `sitegen_${runId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

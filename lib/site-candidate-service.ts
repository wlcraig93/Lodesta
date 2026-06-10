import { createHash } from "node:crypto";
import {
  startRequiredSiteCandidateTelemetry,
  type AgentTelemetryRepository
} from "./agent-telemetry";
import { createSiteFromInput, slugify } from "./intake";
import { prepareIntakeInput } from "./intake-pipeline";
import { runInitialGeneratedSiteReadiness } from "./generated-site-readiness";
import { maybeApplyGeneratedSiteV3 } from "./generated-site-v3-pipeline";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import { evaluatePreCompileResolutionGateV2 } from "./precompile-resolution-gate";
import type {
  AgentRunSource,
  SiteArtifactRecord,
  GenerationQaBlocker,
  SiteBundle,
  SiteCandidateRecord,
  Vertical
} from "./models";
import type { CreateSiteInput, LodestaRepository } from "./repository";
import { normalizePublicFetchUrlInput } from "./url-safety";

export type SiteCandidateRepository = AgentTelemetryRepository &
  Pick<LodestaRepository, "createSiteCandidate" | "listExperimentLearnings" | "upsertSiteArtifact">;

export type GenerateSitePreviewOptions = {
  create?: boolean;
  expiresAt?: string;
  origin?: string;
};

export type GenerateSiteOptions = {
  repository: SiteCandidateRepository;
  input: CreateSiteInput;
  source: AgentRunSource;
  actorType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  preview?: GenerateSitePreviewOptions;
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

export async function generateSite(options: GenerateSiteOptions): Promise<GenerateSiteResult> {
  const input = normalizeGenerationInput(options.input);
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
    const prepared = await prepareIntakeInput(input, { telemetry, identity });
    const bundle = createSiteFromInput({
      ...prepared,
      identity,
      experimentLearnings: await options.repository.listExperimentLearnings({ status: "active" })
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
    const generation = await options.repository.createSiteCandidate({
      id: siteCandidateId,
      agentRunId: telemetry.runId,
      sourceUrl: bundle.presenceAssessment.sourceUrl ?? input.url,
      sourceHost,
      bundle,
      status: readiness.status
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

async function persistPreCompileBlockedGeneration(input: {
  repository: SiteCandidateRepository;
  siteCandidateId: string;
  runId: string;
  input: CreateSiteInput;
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
    status: "blocked"
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

function isExplicitV3Request(metadata: Record<string, unknown> | undefined) {
  return metadata?.generatedSiteV3 === true || metadata?.rendererVersion === "layout-v3";
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

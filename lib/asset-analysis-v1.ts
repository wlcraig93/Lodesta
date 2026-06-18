import { z } from "zod";
import {
  extractOpenAiUsage,
  sanitizeTelemetryPayload,
  type AgentTelemetryRecorder
} from "./agent-telemetry";
import { readLocalAsset, isSupportedAssetMimeType, imageMimeTypeMatchesBytes } from "./asset-storage";
import { elapsedOpenAiCallMs, extractOpenAiResponseText, openAiErrorMessage } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import { validatePublicHostname } from "./url-safety";
import type {
  AssetAnalysisCropIntentV1,
  AssetAnalysisFocalPointV1,
  AssetAnalysisImageKindV1,
  AssetAnalysisUsableSlotV1,
  AssetAnalysisV1,
  AssetAnalysisWarningV1,
  AssetReference,
  SiteBundle
} from "./models";

export const assetAnalysisVersionV1 = "asset-analysis-v1" as const;

const imageKindValues = [
  "logo",
  "storefront",
  "team",
  "person",
  "vehicle",
  "repair_detail",
  "before_after",
  "interior",
  "equipment",
  "product",
  "food",
  "space",
  "generic_graphic",
  "text_heavy_graphic",
  "low_quality",
  "unknown"
] as const satisfies readonly AssetAnalysisImageKindV1[];

const usableSlotValues = ["hero", "service", "proof", "gallery", "background", "logo"] as const satisfies readonly AssetAnalysisUsableSlotV1[];
const focalPointValues = ["center", "top", "bottom", "left", "right"] as const satisfies readonly AssetAnalysisFocalPointV1[];
const cropIntentValues = ["subject", "wide", "portrait", "center", "detail_zoom"] as const satisfies readonly AssetAnalysisCropIntentV1[];
const warningValues = [
  "low_resolution",
  "blurry",
  "text_overlay",
  "logo_like",
  "collage_or_composite",
  "awkward_empty_space",
  "poor_lighting",
  "not_business_relevant",
  "rights_review_required"
] as const satisfies readonly AssetAnalysisWarningV1[];

const cropRecommendationSchema = z.object({
  focalPoint: z.enum(focalPointValues),
  cropIntent: z.enum(cropIntentValues),
  suitability: z.number().min(0).max(100),
  notes: z.string().max(160).optional()
});

const assetAnalysisResponseSchema = z.object({
  imageKind: z.enum(imageKindValues),
  qualityScore: z.number().min(0).max(100),
  usableSlots: z.array(z.enum(usableSlotValues)).min(0).max(6),
  focalPoint: z.enum(focalPointValues),
  subjectPlacement: z.enum(["centered", "left", "right", "top", "bottom", "full_frame", "unclear"]),
  recommendedCropIntent: z.enum(cropIntentValues),
  cropRecommendations: z.object({
    wide: cropRecommendationSchema,
    square: cropRecommendationSchema,
    portrait: cropRecommendationSchema,
    card: cropRecommendationSchema
  }),
  warnings: z.array(z.enum(warningValues)).min(0).max(8),
  contentTags: z.array(z.string().min(1).max(32)).min(0).max(8),
  summary: z.string().min(8).max(240),
  limitations: z.array(z.string().min(1).max(120)).min(0).max(5)
});

type AssetAnalysisResponseV1 = z.infer<typeof assetAnalysisResponseSchema>;

export type AnalyzeBusinessAssetsResultV1 = {
  version: typeof assetAnalysisVersionV1;
  eligible: number;
  candidates: number;
  analyzed: number;
  cached: number;
  skippedOverBudget: number;
  skippedUnreadable: number;
  failed: number;
};

export async function analyzeBusinessAssetsV1(input: {
  bundle: SiteBundle;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  strict?: boolean;
}): Promise<AnalyzeBusinessAssetsResultV1> {
  const selection = assetAnalysisCandidatesV1(input.bundle);
  const candidates = selection.selected;
  const result: AnalyzeBusinessAssetsResultV1 = {
    version: assetAnalysisVersionV1,
    eligible: selection.eligible,
    candidates: candidates.length,
    analyzed: 0,
    cached: 0,
    skippedOverBudget: selection.skippedOverBudget,
    skippedUnreadable: 0,
    failed: 0
  };
  if (!candidates.length) return result;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (input.strict) throw new Error("Canonical generateSite requires model-backed AssetAnalysisV1 for first-party/source assets; OPENAI_API_KEY is not configured.");
    return result;
  }

  const model = process.env.LODESTA_ASSET_ANALYSIS_MODEL ?? process.env.LODESTA_VISUAL_QA_MODEL ?? "gpt-5-mini";

  for (const candidate of candidates) {
    if (hasFreshAssetAnalysisV1(candidate.asset)) {
      result.cached += 1;
      continue;
    }
    const imageInput = await loadAssetImageInputV1(candidate.asset);
    if (!imageInput) {
      result.skippedUnreadable += 1;
      if (input.strict && requiresReadableAnalysisV1(candidate.asset)) {
        throw new Error(`AssetAnalysisV1 could not read source asset ${candidate.asset.id} (${candidate.asset.url}).`);
      }
      continue;
    }
    try {
      const analysis = await createOpenAiAssetAnalysisV1({
        apiKey,
        model,
        asset: candidate.asset,
        imageInput,
        telemetry: input.telemetry,
        spanId: input.spanId
      });
      candidate.assign({ ...candidate.asset, analysisV1: analysis });
      result.analyzed += 1;
    } catch (error) {
      result.failed += 1;
      if (input.strict) throw error;
      input.bundle.presenceAssessment.technicalNotes.push(
        `Asset analysis skipped for ${candidate.asset.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return result;
}

export function hasFreshAssetAnalysisV1(asset: AssetReference): boolean {
  return asset.analysisV1?.version === assetAnalysisVersionV1 && asset.analysisV1.source === "openai";
}

function assetAnalysisCandidatesV1(bundle: SiteBundle) {
  const candidates: Array<{ asset: AssetReference; assign: (asset: AssetReference) => void; priority: number }> = [];
  const seen = new Set<string>();
  const push = (asset: AssetReference | undefined, assign: (asset: AssetReference) => void, priority: number) => {
    if (!asset || !isFirstPartyAnalysisCandidateV1(asset)) return;
    const identity = asset.id || asset.url;
    if (seen.has(identity)) return;
    seen.add(identity);
    candidates.push({ asset, assign, priority });
  };
  push(bundle.businessProfile.logo, (asset) => {
    bundle.businessProfile.logo = asset;
  }, 10_000);
  bundle.businessProfile.photos.forEach((photo, index) => {
    push(photo, (asset) => {
      bundle.businessProfile.photos[index] = asset;
    }, assetAnalysisPriorityV1(photo, index));
  });
  const selected = candidates
    .sort((left, right) => right.priority - left.priority)
    .slice(0, assetAnalysisBudgetV1())
    .map(({ asset, assign }) => ({ asset, assign }));
  return {
    eligible: candidates.length,
    selected,
    skippedOverBudget: Math.max(0, candidates.length - selected.length)
  };
}

function isFirstPartyAnalysisCandidateV1(asset: AssetReference) {
  if (asset.source === "generated" || asset.source === "licensed" || asset.source === "placeholder") return false;
  return asset.rightsStatus === "reference_only" || asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe";
}

function requiresReadableAnalysisV1(asset: AssetReference) {
  return asset.url.startsWith("/api/assets/") || asset.source === "uploaded" || asset.rightsStatus === "customer_granted";
}

function assetAnalysisBudgetV1() {
  const configured = Number(process.env.LODESTA_ASSET_ANALYSIS_MAX_ASSETS);
  if (Number.isFinite(configured) && configured >= 1 && configured <= 16) return Math.floor(configured);
  return 6;
}

function assetAnalysisPriorityV1(asset: AssetReference, index: number) {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const area = width * height;
  const aspect = width && height ? width / height : 1;
  let score = 100 - index;
  if (hasFreshAssetAnalysisV1(asset)) score += 200;
  if (area >= 1_000_000) score += 80;
  else if (area >= 480_000) score += 55;
  else if (area >= 160_000) score += 25;
  else score -= 45;
  if (aspect >= 1.15 && aspect <= 2.4) score += 30;
  if (aspect >= 0.75 && aspect <= 1.35) score += 15;
  if (asset.source === "uploaded") score += 35;
  if (asset.rightsStatus === "customer_granted") score += 30;
  if (asset.rightsStatus === "reference_only") score += 10;
  return score;
}

type LoadedImageInputV1 = {
  imageUrl: string;
  mimeType: string;
  bytes: number;
};

async function loadAssetImageInputV1(asset: AssetReference): Promise<LoadedImageInputV1 | undefined> {
  const storedPath = storagePathFromAssetUrlV1(asset.url);
  const stored = storedPath ? await readLocalAsset(storedPath) : undefined;
  const loaded = stored ?? (await fetchRemoteImageInputV1(asset.url));
  if (!loaded || !isSupportedAssetMimeType(loaded.mimeType) || !imageMimeTypeMatchesBytes(loaded.mimeType, loaded.bytes)) return undefined;
  return {
    imageUrl: `data:${loaded.mimeType};base64,${loaded.bytes.toString("base64")}`,
    mimeType: loaded.mimeType,
    bytes: loaded.bytes.byteLength
  };
}

function storagePathFromAssetUrlV1(url: string) {
  const match = url.match(/^\/api\/assets\/(.+)$/);
  return match?.[1];
}

async function fetchRemoteImageInputV1(url: string): Promise<{ bytes: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp" } | undefined> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    if (parsed.username || parsed.password) return undefined;
    if (!validatePublicHostname(parsed.hostname).ok) return undefined;
    const response = await fetch(parsed.href, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "image/jpeg,image/png,image/webp,image/*" }
    });
    if (!response.ok) return undefined;
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!isSupportedAssetMimeType(mimeType)) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) return undefined;
    return { bytes, mimeType };
  } catch {
    return undefined;
  }
}

async function createOpenAiAssetAnalysisV1(input: {
  apiKey: string;
  model: string;
  asset: AssetReference;
  imageInput: LoadedImageInputV1;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<AssetAnalysisV1> {
  const body = {
    model: input.model,
    reasoning: { effort: "low" as const },
    max_output_tokens: 1400,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text" as const,
            text: [
              "You analyze first-party small-business website images for a bounded website builder.",
              "Return only schema-valid JSON.",
              "Your job is image suitability and cropping, not business fact extraction.",
              "Do not infer publishable services, credentials, guarantees, insurance facts, prices, or customer claims from the image.",
              "Mark text-heavy graphics, logos, screenshots, low-quality photos, awkward empty space, and poor crops clearly.",
              "Prefer practical slots: hero/background only for strong wide contextual photos; service/proof for detail shots; logo only for true brand marks."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text" as const,
            text: JSON.stringify({
              asset: {
                id: input.asset.id,
                alt: input.asset.alt,
                source: input.asset.source,
                rightsStatus: input.asset.rightsStatus,
                width: input.asset.width,
                height: input.asset.height
              },
              requestedOutput: {
                scoreScale: "0-100",
                cropSuitabilityScale: "0-100",
                note: "Crop recommendations should identify the best focal point for object-fit cover crops."
              }
            })
          },
          { type: "input_image" as const, image_url: input.imageInput.imageUrl, detail: "high" as const }
        ]
      }
    ],
    text: {
      verbosity: "low" as const,
      format: {
        type: "json_schema" as const,
        name: "lodesta_asset_analysis_v1",
        strict: true,
        schema: assetAnalysisResponseJsonSchema
      }
    }
  };

  const startedAt = new Date().toISOString();
  let recorded = false;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal(90_000)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model: input.model,
      endpoint: "/v1/responses",
      operation: "asset_analysis_v1",
      status: response.ok ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload({
        model: input.model,
        assetId: input.asset.id,
        assetSource: input.asset.source,
        rightsStatus: input.asset.rightsStatus,
        width: input.asset.width,
        height: input.asset.height,
        mimeType: input.imageInput.mimeType,
        bytes: input.imageInput.bytes,
        promptVersion: assetAnalysisVersionV1
      }),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok ? undefined : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    recorded = true;
    if (!response.ok) throw new Error(openAiErrorMessage(payload) ?? `OpenAI asset analysis failed with status ${response.status}`);
    const text = extractOpenAiResponseText(payload);
    if (!text) throw new Error("OpenAI asset analysis response did not include output text.");
    const parsed = assetAnalysisResponseSchema.parse(JSON.parse(text));
    return normalizeAssetAnalysisV1(parsed, input.model);
  } catch (error) {
    if (!recorded) {
      const endedAt = new Date().toISOString();
      await input.telemetry?.recordModelCall({
        spanId: input.spanId,
        provider: "openai",
        model: input.model,
        endpoint: "/v1/responses",
        operation: "asset_analysis_v1",
        status: "failed",
        requestJson: sanitizeTelemetryPayload({
          model: input.model,
          assetId: input.asset.id,
          mimeType: input.imageInput.mimeType,
          bytes: input.imageInput.bytes,
          promptVersion: assetAnalysisVersionV1
        }),
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
      });
    }
    throw error;
  }
}

function normalizeAssetAnalysisV1(parsed: AssetAnalysisResponseV1, model: string): AssetAnalysisV1 {
  return {
    version: assetAnalysisVersionV1,
    source: "openai",
    model,
    analyzedAt: new Date().toISOString(),
    imageKind: parsed.imageKind,
    qualityScore: Math.round(parsed.qualityScore),
    usableSlots: dedupeV1(parsed.usableSlots),
    focalPoint: parsed.focalPoint,
    subjectPlacement: parsed.subjectPlacement,
    recommendedCropIntent: parsed.recommendedCropIntent,
    cropRecommendations: {
      wide: normalizeCropRecommendationV1(parsed.cropRecommendations.wide),
      square: normalizeCropRecommendationV1(parsed.cropRecommendations.square),
      portrait: normalizeCropRecommendationV1(parsed.cropRecommendations.portrait),
      card: normalizeCropRecommendationV1(parsed.cropRecommendations.card)
    },
    warnings: dedupeV1(parsed.warnings),
    contentTags: dedupeV1(parsed.contentTags.map((tag) => tag.trim()).filter(Boolean)).slice(0, 8),
    summary: parsed.summary,
    limitations: dedupeV1(parsed.limitations).slice(0, 5)
  };
}

function normalizeCropRecommendationV1(recommendation: AssetAnalysisResponseV1["cropRecommendations"]["wide"]) {
  return {
    focalPoint: recommendation.focalPoint,
    cropIntent: recommendation.cropIntent,
    suitability: Math.round(recommendation.suitability),
    ...(recommendation.notes ? { notes: recommendation.notes } : {})
  };
}

function dedupeV1<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

const cropRecommendationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["focalPoint", "cropIntent", "suitability", "notes"],
  properties: {
    focalPoint: { type: "string", enum: focalPointValues },
    cropIntent: { type: "string", enum: cropIntentValues },
    suitability: { type: "number", minimum: 0, maximum: 100 },
    notes: { type: "string", maxLength: 160 }
  }
};

const assetAnalysisResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "imageKind",
    "qualityScore",
    "usableSlots",
    "focalPoint",
    "subjectPlacement",
    "recommendedCropIntent",
    "cropRecommendations",
    "warnings",
    "contentTags",
    "summary",
    "limitations"
  ],
  properties: {
    imageKind: { type: "string", enum: imageKindValues },
    qualityScore: { type: "number", minimum: 0, maximum: 100 },
    usableSlots: { type: "array", items: { type: "string", enum: usableSlotValues }, minItems: 0, maxItems: 6 },
    focalPoint: { type: "string", enum: focalPointValues },
    subjectPlacement: { type: "string", enum: ["centered", "left", "right", "top", "bottom", "full_frame", "unclear"] },
    recommendedCropIntent: { type: "string", enum: cropIntentValues },
    cropRecommendations: {
      type: "object",
      additionalProperties: false,
      required: ["wide", "square", "portrait", "card"],
      properties: {
        wide: cropRecommendationJsonSchema,
        square: cropRecommendationJsonSchema,
        portrait: cropRecommendationJsonSchema,
        card: cropRecommendationJsonSchema
      }
    },
    warnings: { type: "array", items: { type: "string", enum: warningValues }, minItems: 0, maxItems: 8 },
    contentTags: { type: "array", items: { type: "string", minLength: 1, maxLength: 32 }, minItems: 0, maxItems: 8 },
    summary: { type: "string", minLength: 8, maxLength: 240 },
    limitations: { type: "array", items: { type: "string", minLength: 1, maxLength: 120 }, minItems: 0, maxItems: 5 }
  }
};

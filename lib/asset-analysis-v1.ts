import { z } from "zod";
import {
  extractOpenAiUsage,
  sanitizeTelemetryPayload,
  type AgentTelemetryRecorder
} from "./agent-telemetry";
import { readLocalAsset, isSupportedAssetMimeType, imageMimeTypeMatchesBytes } from "./asset-storage";
import {
  elapsedOpenAiCallMs,
  extractOpenAiResponseText,
  openAiErrorMessage,
  openAiResponseIncompleteReason
} from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import { validatePublicHostname } from "./url-safety";
import type {
  AssetAnalysisFocalPointV1,
  AssetAnalysisImageKindV1,
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

const focalPointValues = ["center", "top", "bottom", "left", "right"] as const satisfies readonly AssetAnalysisFocalPointV1[];
const warningValues = [
  "low_resolution",
  "blurry",
  "text_overlay",
  "logo_like",
  "collage_or_composite",
  "awkward_empty_space",
  "poor_lighting",
  "not_business_relevant"
] as const satisfies readonly AssetAnalysisWarningV1[];

const assetAnalysisResponseSchema = z.object({
  imageKind: z.enum(imageKindValues),
  focalPoint: z.enum(focalPointValues),
  subjectPlacement: z.enum(["centered", "left", "right", "top", "bottom", "full_frame", "unclear"]),
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
  signal?: AbortSignal;
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

  const model = process.env.LODESTA_ASSET_ANALYSIS_MODEL ?? "gpt-5-mini";

  const concurrency = assetAnalysisConcurrencyV1();
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    const batch = candidates.slice(offset, offset + concurrency);
    const outcomes = await Promise.all(batch.map(async (candidate) => {
      if (hasFreshAssetAnalysisV1(candidate.asset)) return { kind: "cached" as const, candidate };
      const imageInput = await loadAssetImageInputV1(candidate.asset);
      if (!imageInput) return { kind: "unreadable" as const, candidate };
      try {
        const analysis = await createOpenAiAssetAnalysisV1({
          apiKey,
          model,
          asset: candidate.asset,
          imageInput,
          telemetry: input.telemetry,
          spanId: input.spanId,
          signal: input.signal
        });
        return { kind: "analyzed" as const, candidate, analysis };
      } catch (error) {
        return { kind: "failed" as const, candidate, error };
      }
    }));
    for (const outcome of outcomes) {
      if (outcome.kind === "cached") {
        result.cached += 1;
        continue;
      }
      if (outcome.kind === "unreadable") {
        result.skippedUnreadable += 1;
        if (input.strict && requiresReadableAnalysisV1(outcome.candidate.asset)) {
          throw new Error(`AssetAnalysisV1 could not read source asset ${outcome.candidate.asset.id} (${outcome.candidate.asset.url}).`);
        }
        continue;
      }
      if (outcome.kind === "analyzed") {
        outcome.candidate.assign({ ...outcome.candidate.asset, analysisV1: outcome.analysis });
        result.analyzed += 1;
        continue;
      }
      result.failed += 1;
      input.bundle.presenceAssessment.technicalNotes.push(
        `Asset analysis skipped for ${outcome.candidate.asset.id}: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`
      );
    }
  }
  return result;
}

export function hasFreshAssetAnalysisV1(asset: AssetReference): boolean {
  return asset.analysisV1?.version === assetAnalysisVersionV1 && asset.analysisV1.source === "openai";
}

export function assetAnalysisSelectionV1(bundle: SiteBundle) {
  const selection = assetAnalysisCandidatesV1(bundle);
  return {
    eligible: selection.eligible,
    selectedAssetIdentities: selection.selected.map(({ asset }) => asset.id || asset.url),
    skippedOverBudget: selection.skippedOverBudget
  };
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
  return asset.source === "uploaded" || asset.source === "website_reference";
}

function requiresReadableAnalysisV1(asset: AssetReference) {
  return asset.url.startsWith("/api/assets/") || asset.source === "uploaded";
}

function assetAnalysisBudgetV1() {
  const configured = Number(process.env.LODESTA_ASSET_ANALYSIS_MAX_ASSETS);
  if (Number.isFinite(configured) && configured >= 1 && configured <= 64) return Math.floor(configured);
  return 16;
}

function assetAnalysisConcurrencyV1() {
  const configured = Number(process.env.LODESTA_ASSET_ANALYSIS_CONCURRENCY);
  if (Number.isFinite(configured) && configured >= 1 && configured <= 8) return Math.floor(configured);
  return 4;
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
  signal?: AbortSignal;
}): Promise<AssetAnalysisV1> {
  let lastError: unknown;
  for (const attempt of [1, 2] as const) {
    try {
      return await createOpenAiAssetAnalysisAttemptV1(input, attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenAI asset analysis failed after one retry.");
}

async function createOpenAiAssetAnalysisAttemptV1(input: {
  apiKey: string;
  model: string;
  asset: AssetReference;
  imageInput: LoadedImageInputV1;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
}, attempt: 1 | 2): Promise<AssetAnalysisV1> {
  const body = {
    model: input.model,
    reasoning: { effort: "low" as const },
    max_output_tokens: attempt === 1 ? 1400 : 2200,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text" as const,
            text: [
              "You analyze first-party small-business website images for a bounded website builder.",
              "Return only schema-valid JSON.",
              "Report objective visual facts only; deterministic code decides suitability, placement, and cropping.",
              "Do not infer publishable services, credentials, guarantees, insurance facts, prices, or customer claims from the image.",
              "Mark text-heavy graphics, logos, screenshots, low-quality photos, awkward empty space, poor lighting, and blur clearly.",
              "Classify the visible image kind, focal point, subject placement, warnings, and content tags without recommending a page slot."
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
                width: input.asset.width,
                height: input.asset.height
              },
              requestedOutput: {
                note: "Describe visible content and constraints. Do not score quality or choose hero, proof, gallery, service, background, or logo placement."
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
      signal: openAiRequestSignal(90_000, input.signal)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    const incomplete = response.ok ? openAiResponseIncompleteReason(payload) : undefined;
    let parsed: AssetAnalysisResponseV1 | undefined;
    let parseError: unknown;
    if (response.ok && !incomplete) {
      try {
        const text = extractOpenAiResponseText(payload);
        if (!text) throw new Error("OpenAI asset analysis response did not include output text.");
        parsed = assetAnalysisResponseSchema.parse(JSON.parse(text));
      } catch (error) {
        parseError = error;
      }
    }
    const failureMessage = !response.ok
      ? openAiErrorMessage(payload) ?? `HTTP ${response.status}`
      : incomplete
        ? `Incomplete response (${incomplete})`
        : parseError instanceof Error
          ? parseError.message
          : parseError
            ? String(parseError)
            : undefined;
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model: input.model,
      endpoint: "/v1/responses",
      operation: "asset_analysis_v1",
      status: failureMessage ? "failed" : "completed",
      requestJson: sanitizeTelemetryPayload({
        model: input.model,
        assetId: input.asset.id,
        assetSource: input.asset.source,
        width: input.asset.width,
        height: input.asset.height,
        mimeType: input.imageInput.mimeType,
        bytes: input.imageInput.bytes,
        promptVersion: assetAnalysisVersionV1,
        attempt
      }),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: failureMessage,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    recorded = true;
    if (failureMessage) throw new Error(`OpenAI asset analysis failed: ${failureMessage}`);
    if (!parsed) throw new Error("OpenAI asset analysis did not produce a validated payload.");
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
          promptVersion: assetAnalysisVersionV1,
          attempt
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
    focalPoint: parsed.focalPoint,
    subjectPlacement: parsed.subjectPlacement,
    warnings: dedupeV1(parsed.warnings),
    contentTags: dedupeV1(parsed.contentTags.map((tag) => tag.trim()).filter(Boolean)).slice(0, 8),
    summary: parsed.summary,
    limitations: dedupeV1(parsed.limitations).slice(0, 5)
  };
}

function dedupeV1<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

const assetAnalysisResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "imageKind",
    "focalPoint",
    "subjectPlacement",
    "warnings",
    "contentTags",
    "summary",
    "limitations"
  ],
  properties: {
    imageKind: { type: "string", enum: imageKindValues },
    focalPoint: { type: "string", enum: focalPointValues },
    subjectPlacement: { type: "string", enum: ["centered", "left", "right", "top", "bottom", "full_frame", "unclear"] },
    warnings: { type: "array", items: { type: "string", enum: warningValues }, minItems: 0, maxItems: 8 },
    contentTags: { type: "array", items: { type: "string", minLength: 1, maxLength: 32 }, minItems: 0, maxItems: 8 },
    summary: { type: "string", minLength: 8, maxLength: 240 },
    limitations: { type: "array", items: { type: "string", minLength: 1, maxLength: 120 }, minItems: 0, maxItems: 5 }
  }
};

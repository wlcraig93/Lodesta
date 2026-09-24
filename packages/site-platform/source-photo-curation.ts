import OpenAI from "openai";
import sharp from "sharp";
import { sha256, stableJson } from "@/packages/business-data";
import type { ManagerModelUsage } from "@/packages/site-agent/contracts";
import { usageForModel } from "@/packages/site-agent/run-policy";
import { assertOpenAiStrictJsonSchema } from "@/packages/site-agent/strict-tool-schema";
import type { SiteAgentAssetCuration } from "@/packages/site-contracts";
import { stockImageSignal, type SourcePhotoPageRole } from "./source-resource-ranking";

/**
 * Input preparation for initial authoring: pick the business's best retained
 * first-party photographs before the author starts, label them from their
 * pixels, and hand the selection to the platform's source-photo adoption path.
 * The author still decides where (and whether) each curated photo is used.
 */
export const sourcePhotoCurationProducer = "source-photo-curation@1" as const;
export const sourcePhotoCurationModelId = "gpt-6-luna" as const;
export const sourcePhotoCurationLimit = 32;
/** Retained photos considered for curation (labeling cost scales with this). */
export const sourcePhotoCurationPoolLimit = 96;
/** Uncurated retained photos still shown to the author on source sheets. */
export const sourcePhotoCurationRemainderLimit = 24;
export const sourcePhotoCurationFallbackLimit = 20;
const heroSlots = 6;
const labelBatchSize = 10;
const labelConcurrency = 3;
const labelPreviewEdge = 512;
const minimumCuratedEdge = 320;
const nearDuplicateDistance = 5;
/**
 * Grayscale entropy (bits) below which an image is flat artwork (line
 * drawings, logos, text panels) rather than a photograph. Measured retained
 * photos sit above 5.9, line-art panels near 1.
 */
const flatArtworkEntropy = 4.5;
const maximumLabelOutputTokens = 4_000;

export const photoCurationSubjects = [
  "crew_people",
  "vehicle",
  "finished_work",
  "before_after",
  "equipment",
  "premises",
  "product",
  "other"
] as const;
export type PhotoCurationSubject = (typeof photoCurationSubjects)[number];
export const photoCurationQualities = ["excellent", "good", "fair", "poor"] as const;
export type PhotoCurationQuality = (typeof photoCurationQualities)[number];
export const photoCurationOverlays = ["none", "minor", "dominant"] as const;
export type PhotoCurationOverlay = (typeof photoCurationOverlays)[number];

export type PhotoCurationLabel = {
  subject: PhotoCurationSubject;
  quality: PhotoCurationQuality;
  heroCapable: boolean;
  peoplePresent: boolean;
  overlay: PhotoCurationOverlay;
  stockLike: boolean;
  alt: string;
};

export type PhotoCurationCandidate = {
  /** Source resource id; unique within one curation. */
  resourceId: string;
  sourceId: string;
  sourcePageId: string;
  sourcePageUrl: string;
  imageUrl: string;
  rawContentHash: string;
  pageRole: SourcePhotoPageRole;
  relevanceScore: number;
  width: number;
  height: number;
  bytes: Buffer;
};

export type PhotoLabeler = {
  modelId: string;
  label(input: {
    images: Array<{ id: string; dataUrl: string }>;
    signal?: AbortSignal;
  }): Promise<{ labels: Array<PhotoCurationLabel & { id: string }>; usage: ManagerModelUsage }>;
};

export type CuratedPhoto = {
  candidate: PhotoCurationCandidate;
  subject: PhotoCurationSubject | "unlabeled";
  quality: Exclude<PhotoCurationQuality, "poor"> | "unlabeled";
  heroCapable: boolean;
  peoplePresent?: boolean;
  alt: string;
};

export const photoCurationPromptVersion = 4;
const labelInstructions = [
  "You label photographs retained from a small business's own website so a web designer can choose images.",
  "Judge only the visible pixels. Never guess names, places, brands, or claims the pixels do not show.",
  "subject: the main visible subject of the photograph: crew_people (staff or customers are the subject), vehicle, finished_work (a completed job or result), before_after (a side-by-side or explicit before/after pair), equipment (tools, machines, supplies), premises (building, shop, office, interior), product (goods for sale), other.",
  "quality: excellent = sharp, well lit, well composed; good = clear and usable; fair = usable small only (soft, dark, cluttered or low resolution); poor = blurry, broken, tiny or unusable.",
  "heroCapable: true only when the photo is sharp and strong enough to fill a wide first-screen banner.",
  "peoplePresent: true when any person is visible.",
  "overlay: text, watermark, logo or graphic overlaid on the photo: none, minor (small corner mark) or dominant.",
  "stockLike: true when it looks like generic licensed stock photography rather than the business's own photo.",
  "alt: one short factual sentence (at most 16 words) describing only what is visible, suitable as image alt text. No business names, locations or marketing words.",
  "Return exactly one entry per supplied image id, in the same order."
].join(" ");

const labelResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "subject", "quality", "heroCapable", "peoplePresent", "overlay", "stockLike", "alt"],
        properties: {
          id: { type: "string" },
          subject: { type: "string", enum: [...photoCurationSubjects] },
          quality: { type: "string", enum: [...photoCurationQualities] },
          heroCapable: { type: "boolean" },
          peoplePresent: { type: "boolean" },
          overlay: { type: "string", enum: [...photoCurationOverlays] },
          stockLike: { type: "boolean" },
          alt: { type: "string" }
        }
      }
    }
  }
} as const;

/** Batched low-detail vision labeling on the approved cheap model. */
export function createOpenAiPhotoLabeler(options: { apiKey?: string; modelId?: string } = {}): PhotoLabeler | undefined {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return undefined;
  const modelId = options.modelId ?? sourcePhotoCurationModelId;
  assertOpenAiStrictJsonSchema(labelResponseSchema, "source_photo_labels");
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 90_000 });
  return {
    modelId,
    async label({ images, signal }) {
      const startedAt = Date.now();
      const response = await client.responses.create({
        model: modelId,
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: maximumLabelOutputTokens,
        instructions: labelInstructions,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: `Label these ${images.length} photos. Image ids in order: ${images.map((image) => image.id).join(", ")}.` },
            ...images.flatMap((image) => [
              { type: "input_text" as const, text: `id: ${image.id}` },
              { type: "input_image" as const, image_url: image.dataUrl, detail: "low" as const }
            ])
          ]
        }],
        text: { format: { type: "json_schema", name: "source_photo_labels", strict: true, schema: labelResponseSchema as never } }
      }, signal ? { signal } : undefined);
      const usage = usageForModel(modelId, response.usage, Date.now() - startedAt);
      if (response.status !== "completed" || !response.output_text.trim()) {
        throw Object.assign(new Error("photo_labeling_incomplete"), { usage });
      }
      const parsed = JSON.parse(response.output_text) as { photos: Array<PhotoCurationLabel & { id: string }> };
      return { labels: parsed.photos, usage };
    }
  };
}

const zeroUsage = (): ManagerModelUsage => ({
  inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0,
  costUsd: 0, costSource: "catalog_estimate", upstreamInferenceCostUsd: 0, durationMs: 0
});

function addUsage(left: ManagerModelUsage, right: ManagerModelUsage): ManagerModelUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    costUsd: left.costUsd + right.costUsd,
    costSource: left.costSource === right.costSource ? left.costSource : "mixed",
    upstreamInferenceCostUsd: left.upstreamInferenceCostUsd + right.upstreamInferenceCostUsd,
    durationMs: Math.max(left.durationMs, right.durationMs)
  };
}

/** 64-bit difference hash of the auto-oriented pixels. */
export async function photoDifferenceHash(bytes: Buffer) {
  const { data } = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false })
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      hash = (hash << 1n) | (data[row * 9 + column]! > data[row * 9 + column + 1]! ? 1n : 0n);
    }
  }
  return hash;
}

/** Grayscale entropy of a small auto-oriented rendition. */
export async function photoPixelEntropy(bytes: Buffer) {
  const small = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false })
    .rotate()
    .resize(256, 256, { fit: "inside" })
    .toBuffer();
  return (await sharp(small).stats()).entropy;
}

function hammingDistance(left: bigint, right: bigint) {
  let value = left ^ right;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

/**
 * Collapse visually identical photos (re-encodes, resized copies, CDN
 * variants the URL family missed). The larger, then higher-ranked copy wins.
 */
export async function dedupeCurationCandidates(candidates: readonly PhotoCurationCandidate[]) {
  const hashes = await Promise.all(candidates.map((candidate) => photoDifferenceHash(candidate.bytes).catch(() => undefined)));
  const order = candidates.map((candidate, index) => ({ candidate, index, hash: hashes[index] }))
    .sort((left, right) =>
      right.candidate.width * right.candidate.height - left.candidate.width * left.candidate.height
      || right.candidate.relevanceScore - left.candidate.relevanceScore
      || left.index - right.index);
  const kept: typeof order = [];
  const duplicates: Array<{ resourceId: string; duplicateOf: string }> = [];
  for (const entry of order) {
    const original = entry.hash === undefined
      ? undefined
      : kept.find((other) => other.hash !== undefined && hammingDistance(other.hash, entry.hash!) <= nearDuplicateDistance);
    if (original) duplicates.push({ resourceId: entry.candidate.resourceId, duplicateOf: original.candidate.resourceId });
    else kept.push(entry);
  }
  return {
    unique: kept.sort((left, right) => left.index - right.index).map((entry) => entry.candidate),
    duplicates
  };
}

export function curationInputHash(candidates: readonly PhotoCurationCandidate[], modelId: string) {
  return sha256(stableJson({
    producer: sourcePhotoCurationProducer,
    promptVersion: photoCurationPromptVersion,
    modelId,
    limit: sourcePhotoCurationLimit,
    candidates: candidates.map((candidate) => ({
      resourceId: candidate.resourceId,
      sourceId: candidate.sourceId,
      sourcePageId: candidate.sourcePageId,
      rawContentHash: candidate.rawContentHash
    }))
  }));
}

function wideEnoughForHero(candidate: PhotoCurationCandidate) {
  return candidate.width >= 1200 && candidate.width >= candidate.height * 1.2;
}

const qualityPoints: Record<PhotoCurationQuality, number> = { excellent: 300, good: 200, fair: 100, poor: 0 };
const rolePoints: Record<SourcePhotoPageRole, number> = { home: 30, service: 20, portfolio: 20, about: 15, other: 0 };

function curationEligible(candidate: PhotoCurationCandidate) {
  return Math.min(candidate.width, candidate.height) >= minimumCuratedEdge && !stockImageSignal(candidate.imageUrl);
}

/**
 * Deterministic selection over labeled candidates: drop unusable, stock-like,
 * overlaid images; take hero-capable photos first, then fill by
 * round-robin across subjects so the gallery covers the business's range.
 */
export function selectCuratedPhotos(input: {
  candidates: readonly PhotoCurationCandidate[];
  labels?: ReadonlyMap<string, PhotoCurationLabel>;
  fallbackAlt: string;
  limit?: number;
}): CuratedPhoto[] {
  if (!input.labels) {
    const limit = Math.min(input.limit ?? sourcePhotoCurationFallbackLimit, sourcePhotoCurationFallbackLimit);
    const eligible = input.candidates.filter(curationEligible);
    const hero = eligible.filter(wideEnoughForHero).slice(0, heroSlots);
    const ordered = [...hero, ...eligible.filter((candidate) => !hero.includes(candidate))].slice(0, limit);
    return ordered.map((candidate) => ({
      candidate,
      subject: "unlabeled",
      quality: "unlabeled",
      heroCapable: hero.includes(candidate),
      alt: input.fallbackAlt
    }));
  }
  const labels = input.labels;
  const limit = input.limit ?? sourcePhotoCurationLimit;
  const scored = input.candidates.flatMap((candidate) => {
    const label = labels.get(candidate.resourceId);
    if (!label || !curationEligible(candidate)) return [];
    if (label.quality === "poor" || label.overlay === "dominant") return [];
    const heroCapable = label.heroCapable && wideEnoughForHero(candidate)
      && (label.quality === "excellent" || label.quality === "good") && label.overlay === "none";
    // Candidates are already first-party and free of stock URL evidence. A
    // stock-like look is common in polished professional shoots of the
    // business's own work, so it is shown to the author but does not rank.
    const score = qualityPoints[label.quality] + (heroCapable ? 80 : 0) + rolePoints[candidate.pageRole]
      + Math.max(-50, Math.min(50, candidate.relevanceScore / 10));
    return [{ candidate, label, heroCapable, score }];
  }).sort((left, right) => right.score - left.score || left.candidate.resourceId.localeCompare(right.candidate.resourceId));
  type Scored = (typeof scored)[number];
  const selected: Scored[] = [];
  const roundRobin = (pool: Scored[], cap: number) => {
    const buckets = new Map<PhotoCurationSubject, Scored[]>();
    for (const entry of pool) {
      if (selected.includes(entry)) continue;
      const bucket = buckets.get(entry.label.subject) ?? [];
      bucket.push(entry);
      buckets.set(entry.label.subject, bucket);
    }
    // Subjects are visited in the order of their best photo.
    const queues = [...buckets.values()];
    let taken = 0;
    while (taken < cap && selected.length < limit && queues.some((queue) => queue.length)) {
      for (const queue of queues) {
        if (taken >= cap || selected.length >= limit) break;
        const next = queue.shift();
        if (!next) continue;
        selected.push(next);
        taken += 1;
      }
    }
  };
  // Lead with the best hero-capable photo of each subject, then fill by
  // subject round-robin (score order within a subject).
  const firstHeroBySubject = new Map<PhotoCurationSubject, Scored>();
  for (const entry of scored) {
    if (entry.heroCapable && !firstHeroBySubject.has(entry.label.subject)) firstHeroBySubject.set(entry.label.subject, entry);
  }
  roundRobin([...firstHeroBySubject.values()], heroSlots);
  roundRobin(scored, limit);
  return selected.map(({ candidate, label, heroCapable }) => ({
    candidate,
    subject: label.subject,
    quality: label.quality as CuratedPhoto["quality"],
    heroCapable,
    peoplePresent: label.peoplePresent,
    alt: normalizedAlt(label.alt) || input.fallbackAlt
  }));
}

function normalizedAlt(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function labelPreview(bytes: Buffer) {
  const preview = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false })
    .rotate()
    .resize({ width: labelPreviewEdge, height: labelPreviewEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return `data:image/jpeg;base64,${preview.toString("base64")}`;
}

/**
 * Label every candidate in small batches. A failed batch leaves its photos
 * unlabeled; if no batch succeeds the caller falls back to ranking-only.
 */
export async function labelCurationCandidates(input: {
  candidates: readonly PhotoCurationCandidate[];
  labeler: PhotoLabeler;
  signal?: AbortSignal;
}) {
  const batches: PhotoCurationCandidate[][] = [];
  for (let index = 0; index < input.candidates.length; index += labelBatchSize) {
    batches.push(input.candidates.slice(index, index + labelBatchSize));
  }
  const labels = new Map<string, PhotoCurationLabel>();
  let usage = zeroUsage();
  const failures: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      try {
        const images = await Promise.all(batch.map(async (candidate) => ({
          id: candidate.resourceId,
          dataUrl: await labelPreview(candidate.bytes)
        })));
        const result = await input.labeler.label({ images, signal: input.signal });
        usage = addUsage(usage, result.usage);
        const expected = new Set(batch.map((candidate) => candidate.resourceId));
        for (const label of result.labels) {
          if (!expected.has(label.id) || labels.has(label.id)) continue;
          if (!validLabel(label)) continue;
          labels.set(label.id, {
            subject: label.subject, quality: label.quality, heroCapable: label.heroCapable,
            peoplePresent: label.peoplePresent, overlay: label.overlay, stockLike: label.stockLike,
            alt: normalizedAlt(label.alt)
          });
        }
      } catch (error) {
        const partial = (error as { usage?: ManagerModelUsage } | undefined)?.usage;
        if (partial) usage = addUsage(usage, partial);
        if (input.signal?.aborted) throw error;
        failures.push(error instanceof Error ? error.message.slice(0, 120) : "photo_labeling_failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(labelConcurrency, batches.length) }, worker));
  return { labels, usage, failures };
}

function validLabel(label: PhotoCurationLabel) {
  return photoCurationSubjects.includes(label.subject)
    && photoCurationQualities.includes(label.quality)
    && photoCurationOverlays.includes(label.overlay)
    && typeof label.heroCapable === "boolean"
    && typeof label.peoplePresent === "boolean"
    && typeof label.stockLike === "boolean"
    && typeof label.alt === "string";
}

/**
 * The whole curation step. `retained` is a prior curation from the same run;
 * when its input hash matches, its labels are reused instead of paying for a
 * second vision pass (resumed executions stay deterministic).
 */
export async function curateSourcePhotos(input: {
  candidates: readonly PhotoCurationCandidate[];
  labeler?: PhotoLabeler;
  publicBuildInputId: string;
  businessName: string;
  retained?: SiteAgentAssetCuration;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<{ curation: SiteAgentAssetCuration; selected: CuratedPhoto[]; reused: boolean }> {
  const { unique: deduped, duplicates } = await dedupeCurationCandidates(input.candidates);
  // Flat artwork (line drawings, logos, text panels) is excluded from its
  // pixels alone, deterministically, before any labeling spend.
  const entropies = await Promise.all(deduped.map((candidate) => photoPixelEntropy(candidate.bytes).catch(() => 0)));
  const flatArtwork = deduped.filter((_candidate, index) => entropies[index]! < flatArtworkEntropy).map((candidate) => candidate.resourceId);
  const unique = deduped.filter((candidate) => !flatArtwork.includes(candidate.resourceId));
  const modelId = input.labeler?.modelId ?? sourcePhotoCurationModelId;
  const inputHash = curationInputHash(deduped, modelId);
  const fallbackAlt = `Photo from the ${input.businessName} website`.slice(0, 200);
  let labels: Map<string, PhotoCurationLabel> | undefined;
  let usage = zeroUsage();
  let fallbackReason: string | undefined;
  let reused = false;
  if (input.retained && input.retained.inputHash === inputHash) {
    reused = true;
    if (input.retained.labeler === "vision") {
      labels = new Map(input.retained.labels.map(({ resourceId, ...label }) => [resourceId, label]));
    } else {
      fallbackReason = input.retained.fallbackReason;
    }
  } else if (!input.labeler) {
    fallbackReason = "labeler_unavailable";
  } else if (unique.length) {
    const labeled = await labelCurationCandidates({ candidates: unique, labeler: input.labeler, signal: input.signal });
    usage = labeled.usage;
    if (labeled.labels.size) labels = labeled.labels;
    else fallbackReason = labeled.failures[0] ?? "photo_labeling_empty";
  }
  const selected = selectCuratedPhotos({ candidates: unique, labels, fallbackAlt });
  const curation: SiteAgentAssetCuration = input.retained && reused ? input.retained : {
    schemaVersion: 1,
    producer: sourcePhotoCurationProducer,
    promptVersion: photoCurationPromptVersion,
    modelId,
    labeler: labels ? "vision" : "ranking_fallback",
    ...(fallbackReason ? { fallbackReason: fallbackReason.slice(0, 200) } : {}),
    publicBuildInputId: input.publicBuildInputId,
    inputHash,
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    candidateCount: input.candidates.length,
    duplicates,
    flatArtwork,
    labels: labels ? [...labels].map(([resourceId, label]) => ({ resourceId, ...label })) : [],
    selected: selected.map((photo) => ({
      resourceId: photo.candidate.resourceId,
      sourceId: photo.candidate.sourceId,
      sourcePageId: photo.candidate.sourcePageId,
      subject: photo.subject,
      quality: photo.quality,
      heroCapable: photo.heroCapable,
      alt: photo.alt
    })),
    usage
  };
  return { curation, selected, reused };
}

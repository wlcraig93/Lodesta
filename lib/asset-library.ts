import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getSupabaseAdminClient } from "./supabase/client";
import { openAiRequestSignal } from "./openai-timeout";
import type { BusinessProfile, Vertical } from "./models";
import { matchServiceDefinition, serviceDefinitionsForVertical } from "./service-catalog";

export const ASSET_LIBRARY_BUCKET_NAME = "lodesta-asset-library";
export const ASSET_LIBRARY_MANIFEST_VERSION = "asset-library-manifest-v1";
export const ASSET_LIBRARY_ACTIVE_MANIFEST_NAME = "tire-auto-v2";
export const ASSET_LIBRARY_ACTIVE_MANIFEST_NAMES = [
  "tire-auto-v2",
  "auto-services-wave-1-v1",
  "auto-services-environment-wave-1-v1",
  "auto-glass-wave-1-v1",
  "auto-body-wave-1-v1"
] as const;
export const ASSET_LIBRARY_STATUS_VALUES = ["candidate", "needs_edit", "approved", "rejected", "archived"] as const;
export const ASSET_LIBRARY_REVIEW_DECISIONS = ["approved", "rejected", "needs_edit", "archived"] as const;
export const ASSET_LIBRARY_APPROVED_VARIANTS = ["hero-1600.webp", "card-900.webp", "thumb-320.webp"] as const;
export const ASSET_LIBRARY_GENERATION_DEFAULT_LIMIT = 10;
export const ASSET_LIBRARY_ENVIRONMENT_MANIFEST_NAME = "auto-services-environment-wave-1-v1";
export const ASSET_LIBRARY_ENVIRONMENT_HERO_MIN_WIDTH = 2400;
export const ASSET_LIBRARY_HERO_DERIVATIVE_MIN_WIDTH = 1600;

export const REQUIRED_NEGATIVE_CONSTRAINTS = [
  "no logos",
  "no readable text",
  "no license plates",
  "no real business names",
  "no fake certifications",
  "no unsafe shop behavior",
  "no customer-specific claims",
  "no distorted hands or tools",
  "no obvious AI artifacts"
] as const;

export const ASSET_LIBRARY_V2_REQUIRED_NEGATIVE_CONSTRAINTS = [
  ...REQUIRED_NEGATIVE_CONSTRAINTS,
  "no screens",
  "no documents",
  "no forms",
  "no receipts",
  "no calibration targets"
] as const;

export const ASSET_LIBRARY_ENVIRONMENT_REQUIRED_NEGATIVE_CONSTRAINTS = [
  ...ASSET_LIBRARY_V2_REQUIRED_NEGATIVE_CONSTRAINTS,
  "no people",
  "no faces",
  "no staff",
  "no customers",
  "no tire or equipment branding",
  "no VIN",
  "no signage",
  "no storefront facade",
  "no address",
  "no specific business identity"
] as const;

export const ASSET_LIBRARY_SAFE_CLASSIFICATION_TAGS = [
  "service_detail",
  "hands_tools",
  "part_closeup",
  "tool_closeup",
  "tire_closeup",
  "glass_closeup",
  "shop_texture",
  "shop_environment"
] as const;

export const ASSET_LIBRARY_POLICY_MODIFIER_TAGS = ["no_location_context"] as const;

export const ASSET_LIBRARY_POLICY_FAIL_TAGS = [
  "policy_fail_shop_exterior",
  "policy_fail_storefront",
  "policy_fail_front_counter",
  "policy_fail_waiting_area",
  "policy_fail_staff_customer",
  "policy_fail_real_location_implied",
  "policy_fail_visible_face_subject",
  "policy_fail_documents_forms",
  "policy_fail_signage_pseudo_text",
  "policy_fail_screens",
  "policy_fail_calibration_targets",
  "policy_fail_people_visible",
  "policy_fail_plate_or_vin",
  "policy_fail_branding_logo",
  "policy_fail_specific_vehicle_identity"
] as const;

export const ASSET_LIBRARY_IMAGE_FAMILIES = [
  "tires_wheels",
  "brakes",
  "oil_maintenance",
  "battery_diagnostics",
  "alignment_suspension",
  "auto_glass",
  "collision_body",
  "paint_refinish",
  "detail_texture",
  "general_mechanical",
  "shop_environment"
] as const;

export const ASSET_LIBRARY_COMPOSITION_TEMPLATES = [
  "macro_detail",
  "hands_tools_closeup",
  "parts_flat_lay",
  "machine_detail",
  "surface_texture",
  "wide_environment",
  "soft_blur_background"
] as const;

export const ASSET_LIBRARY_DERIVED_TAG_PREFIXES = ["family_", "subject_", "hint_", "catalog_", "scene_", "clear_"] as const;

export type AssetLibraryStatus = (typeof ASSET_LIBRARY_STATUS_VALUES)[number];
export type AssetLibraryReviewDecision = (typeof ASSET_LIBRARY_REVIEW_DECISIONS)[number];
export type AssetLibraryApprovedVariant = (typeof ASSET_LIBRARY_APPROVED_VARIANTS)[number];
export type AssetLibrarySafeClassificationTag = (typeof ASSET_LIBRARY_SAFE_CLASSIFICATION_TAGS)[number];
export type AssetLibraryPolicyFailTag = (typeof ASSET_LIBRARY_POLICY_FAIL_TAGS)[number];
export type AssetLibraryImageFamily = (typeof ASSET_LIBRARY_IMAGE_FAMILIES)[number];
export type AssetLibraryCompositionTemplate = (typeof ASSET_LIBRARY_COMPOSITION_TEMPLATES)[number];
export type AssetLibraryHeroClearSide = "left" | "right" | "none";

export type AssetLibraryPromptRecord = {
  id: string;
  title: string;
  category: string;
  intendedUses: string[];
  tags: string[];
  imageFamily: AssetLibraryImageFamily;
  imageSubjects: string[];
  serviceHints: string[];
  catalogServiceSlugs: string[];
  compositionTemplate: AssetLibraryCompositionTemplate;
  sceneFamily?: string;
  heroClearSide?: AssetLibraryHeroClearSide;
  aspectRatio: string;
  prompt: string;
  negativeConstraints: string[];
  notes: string;
};

export type AssetLibraryManifest = {
  version: typeof ASSET_LIBRARY_MANIFEST_VERSION;
  name: string;
  vertical: Vertical;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: "low" | "medium" | "high" | "auto";
  prompts: AssetLibraryPromptRecord[];
};

export type AssetLibraryBatch = {
  id: string;
  manifestName: string;
  vertical: Vertical;
  model: string;
  candidatesPerPrompt: number;
  promptCount: number;
  estimatedImages: number;
  estimatedCostUsd: number;
  status: "estimated" | "running" | "completed" | "failed";
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
};

export type AssetLibraryPromptSelection = {
  limit?: number;
  offset?: number;
  promptIds?: string[];
};

export type AssetLibraryResolvedPromptSelection = {
  prompts: AssetLibraryPromptRecord[];
  selectionMode: "prefix" | "offset" | "prompt_ids";
  offset?: number;
  limit?: number;
  promptIds?: string[];
};

export type AssetLibraryAsset = {
  id: string;
  batchId?: string;
  parentAssetId?: string;
  promptId: string;
  promptMetadata: AssetLibraryPromptRecord;
  vertical: Vertical;
  category: string;
  intendedUses: string[];
  tags: string[];
  status: AssetLibraryStatus;
  rawStoragePath: string;
  approvedStoragePaths: Partial<Record<"original" | AssetLibraryApprovedVariant, string>>;
  publicUrl?: string;
  checksum: string;
  width?: number;
  height?: number;
  mimeType: string;
  model: string;
  quality: string;
  size: string;
  generationIndex: number;
  qc: AssetLibraryMechanicalQc;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
};

export type AssetLibraryReview = {
  id: string;
  assetId: string;
  decision: AssetLibraryReviewDecision;
  notes?: string;
  rejectionReasons: string[];
  reviewer: string;
  createdAt: string;
};

export type AssetLibraryMechanicalQc = {
  ok: boolean;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};

export type AssetLibraryPolicyAssessment = {
  siteSelectable: boolean;
  recommendedDecision: Extract<AssetLibraryReviewDecision, "approved" | "rejected" | "needs_edit">;
  allowedUses: string[];
  subjectClassifications: AssetLibrarySafeClassificationTag[];
  modifiers: string[];
  hardFailReasons: string[];
  softWarnings: string[];
};

export type ApprovedAssetLibraryAsset = Pick<
  AssetLibraryAsset,
  "id" | "vertical" | "category" | "intendedUses" | "tags" | "publicUrl" | "promptMetadata" | "approvedStoragePaths"
>;

type AssetLibraryBatchRow = {
  id: string;
  manifest_name: string;
  vertical: Vertical;
  model: string;
  candidates_per_prompt: number;
  prompt_count: number;
  estimated_images: number;
  estimated_cost_usd: number | string;
  status: AssetLibraryBatch["status"];
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
};

type AssetLibraryAssetRow = {
  id: string;
  batch_id: string | null;
  parent_asset_id: string | null;
  prompt_id: string;
  prompt_metadata: AssetLibraryPromptRecord;
  vertical: Vertical;
  category: string;
  intended_uses: string[];
  tags: string[];
  status: AssetLibraryStatus;
  raw_storage_path: string;
  approved_storage_paths: Partial<Record<"original" | AssetLibraryApprovedVariant, string>>;
  public_url: string | null;
  checksum: string;
  width: number | null;
  height: number | null;
  mime_type: string;
  model: string;
  quality: string;
  size: string;
  generation_index: number;
  qc_json: AssetLibraryMechanicalQc;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

type AssetLibraryReviewRow = {
  id: string;
  asset_id: string;
  decision: AssetLibraryReviewDecision;
  notes: string | null;
  rejection_reasons: string[];
  reviewer: string;
  created_at: string;
};

const promptSchema = z.object({
  id: z.string().trim().min(1).max(96).regex(/^[a-z0-9][a-z0-9_-]*$/),
  title: z.string().trim().min(1).max(140),
  category: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
  intendedUses: z.array(z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/)).min(1).max(8),
  tags: z.array(z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/)).min(1).max(24),
  imageFamily: z.enum(ASSET_LIBRARY_IMAGE_FAMILIES),
  imageSubjects: z.array(z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/)).min(1).max(12),
  serviceHints: z.array(z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/)).min(1).max(16),
  catalogServiceSlugs: z.array(z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/)).max(12),
  compositionTemplate: z.enum(ASSET_LIBRARY_COMPOSITION_TEMPLATES),
  sceneFamily: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
  heroClearSide: z.enum(["left", "right", "none"]).optional(),
  aspectRatio: z.string().trim().min(1).max(16),
  prompt: z.string().trim().min(80).max(1600),
  negativeConstraints: z.array(z.string().trim().min(1).max(96)).min(REQUIRED_NEGATIVE_CONSTRAINTS.length),
  notes: z.string().trim().min(1).max(600)
});

const manifestSchema = z.object({
  version: z.literal(ASSET_LIBRARY_MANIFEST_VERSION),
  name: z.string().trim().min(1).max(96).regex(/^[a-z0-9][a-z0-9_-]*$/),
  vertical: z.enum(["auto_services", "auto_body"]),
  defaultModel: z.string().trim().min(1).max(80),
  defaultSize: z.string().trim().min(1).max(40),
  defaultQuality: z.enum(["low", "medium", "high", "auto"]),
  prompts: z.array(promptSchema).min(1).max(1000)
});

export async function readAssetLibraryManifest(filePath: string): Promise<AssetLibraryManifest> {
  const raw = await readFile(filePath, "utf8");
  const parsedJson = JSON.parse(raw) as unknown;
  const result = validateAssetLibraryManifest(parsedJson);
  if (!result.ok) {
    throw new Error(`Invalid asset library manifest:\n${result.issues.join("\n")}`);
  }
  return result.manifest;
}

export function validateAssetLibraryManifest(input: unknown):
  | { ok: true; manifest: AssetLibraryManifest; issues: [] }
  | { ok: false; issues: string[] } {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`) };
  }
  const issues: string[] = [];
  if (!(ASSET_LIBRARY_ACTIVE_MANIFEST_NAMES as readonly string[]).includes(parsed.data.name)) {
    issues.push(`manifest.name: ${parsed.data.name} is frozen for provenance; use an active asset-library generation manifest`);
  }
  const isEnvironmentManifest = parsed.data.name === ASSET_LIBRARY_ENVIRONMENT_MANIFEST_NAME;
  if (isEnvironmentManifest) {
    const size = parseImageSize(parsed.data.defaultSize);
    if (!size) {
      issues.push("manifest.defaultSize: environment manifest must use explicit WIDTHxHEIGHT size");
    } else {
      const ratio = size.width / size.height;
      if (size.width < ASSET_LIBRARY_ENVIRONMENT_HERO_MIN_WIDTH || Math.abs(ratio - 2) > 0.05) {
        issues.push(
          `manifest.defaultSize: environment manifest must be at least ${ASSET_LIBRARY_ENVIRONMENT_HERO_MIN_WIDTH}px wide and roughly 2:1; received ${parsed.data.defaultSize}`
        );
      }
    }
  }
  const seenPromptIds = new Set<string>();
  const environmentScenes = new Map<string, { count: number; sides: Set<AssetLibraryHeroClearSide>; promptIds: string[] }>();
  const allowedCatalogSlugs = new Set(serviceDefinitionsForVertical(parsed.data.vertical).map((definition) => definition.slug));
  for (const prompt of parsed.data.prompts) {
    if (seenPromptIds.has(prompt.id)) issues.push(`prompts.${prompt.id}: duplicate prompt id`);
    seenPromptIds.add(prompt.id);
    const normalizedConstraints = new Set(prompt.negativeConstraints.map((constraint) => constraint.toLowerCase()));
    const isEnvironmentPrompt = isEnvironmentAssetLibraryPrompt(prompt) || isEnvironmentManifest;
    const requiredNegativeConstraints = isEnvironmentPrompt
      ? ASSET_LIBRARY_ENVIRONMENT_REQUIRED_NEGATIVE_CONSTRAINTS
      : ASSET_LIBRARY_V2_REQUIRED_NEGATIVE_CONSTRAINTS;
    for (const required of requiredNegativeConstraints) {
      if (!normalizedConstraints.has(required.toLowerCase())) {
        issues.push(`prompts.${prompt.id}: missing negative constraint "${required}"`);
      }
    }
    const classifications = assetLibrarySafeClassificationTags(prompt.tags);
    if (classifications.length !== 1) {
      issues.push(`prompts.${prompt.id}: expected exactly one safe subject classification tag, found ${classifications.length}`);
    }
    if (prompt.tags.includes("no_location_context") && classifications.length !== 1) {
      issues.push(`prompts.${prompt.id}: no_location_context is only a modifier and must accompany one safe subject classification`);
    }
    const failTags = prompt.tags.filter(isAssetLibraryPolicyFailTag);
    if (failTags.length) {
      issues.push(`prompts.${prompt.id}: prompt manifests cannot include policy fail tags (${failTags.join(", ")})`);
    }
    const derivedTags = prompt.tags.filter(isAssetLibraryDerivedTaxonomyTag);
    if (derivedTags.length) {
      issues.push(`prompts.${prompt.id}: derived taxonomy tags are generated from prompt metadata, not authored in manifests (${derivedTags.join(", ")})`);
    }
    if (isEnvironmentPrompt) {
      if (parsed.data.vertical !== "auto_services") {
        issues.push(`prompts.${prompt.id}: shop environment prompts are only active for auto_services in V1`);
      }
      if (!prompt.tags.includes("shop_environment")) {
        issues.push(`prompts.${prompt.id}: environment prompts must carry the shop_environment safe classification`);
      }
      if (!prompt.sceneFamily) {
        issues.push(`prompts.${prompt.id}: environment prompts must declare sceneFamily`);
      }
      if (!prompt.heroClearSide) {
        issues.push(`prompts.${prompt.id}: environment prompts must declare heroClearSide`);
      }
      if (prompt.aspectRatio !== "2:1") {
        issues.push(`prompts.${prompt.id}: environment prompts must use 2:1 aspectRatio`);
      }
      if (prompt.compositionTemplate !== "wide_environment" && prompt.compositionTemplate !== "soft_blur_background") {
        issues.push(`prompts.${prompt.id}: environment prompts must use wide_environment or soft_blur_background compositionTemplate`);
      }
      if (prompt.compositionTemplate === "wide_environment") {
        if (prompt.heroClearSide !== "left" && prompt.heroClearSide !== "right") {
          issues.push(`prompts.${prompt.id}: wide environment prompts must use left or right heroClearSide`);
        } else if (prompt.sceneFamily) {
          const entry = environmentScenes.get(prompt.sceneFamily) ?? { count: 0, sides: new Set<AssetLibraryHeroClearSide>(), promptIds: [] };
          entry.count += 1;
          entry.sides.add(prompt.heroClearSide);
          entry.promptIds.push(prompt.id);
          environmentScenes.set(prompt.sceneFamily, entry);
        }
      }
      if (prompt.compositionTemplate === "soft_blur_background" && prompt.heroClearSide !== "none") {
        issues.push(`prompts.${prompt.id}: soft blur background prompts must use heroClearSide none`);
      }
    }
    for (const slug of prompt.catalogServiceSlugs) {
      if (!allowedCatalogSlugs.has(slug)) {
        issues.push(`prompts.${prompt.id}: catalogServiceSlugs.${slug} is not an existing ${parsed.data.vertical} service catalog slug`);
      }
    }
    if (prompt.imageFamily === "collision_body" || prompt.imageFamily === "paint_refinish") {
      if (parsed.data.vertical !== "auto_body") {
        issues.push(`prompts.${prompt.id}: ${prompt.imageFamily} belongs in the auto_body asset manifest, not ${parsed.data.vertical}`);
      }
    }
  }
  if (isEnvironmentManifest) {
    for (const [sceneFamily, entry] of environmentScenes) {
      if (entry.count !== 2 || !entry.sides.has("left") || !entry.sides.has("right")) {
        issues.push(
          `prompts.${sceneFamily}: wide environment sceneFamily must have exactly one left and one right prompt; found ${entry.promptIds.join(", ")}`
        );
      }
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, manifest: parsed.data, issues: [] };
}

export function estimateAssetLibraryGeneration(input: {
  manifest: Pick<AssetLibraryManifest, "prompts">;
  candidates: number;
  limit?: number;
  offset?: number;
  promptIds?: string[];
  pricePerImageUsd?: number;
}) {
  const candidateCount = positiveInt(input.candidates, "candidates");
  const promptSelection = selectAssetLibraryManifestPrompts(input.manifest, {
    limit: input.limit,
    offset: input.offset,
    promptIds: input.promptIds
  });
  const promptCount = promptSelection.prompts.length;
  const estimatedImages = promptCount * candidateCount;
  const pricePerImageUsd = input.pricePerImageUsd ?? assetLibraryPricePerImageUsd();
  return {
    promptCount,
    candidatesPerPrompt: candidateCount,
    estimatedImages,
    pricePerImageUsd,
    estimatedCostUsd: roundCurrency(estimatedImages * pricePerImageUsd),
    selection: {
      selectionMode: promptSelection.selectionMode,
      offset: promptSelection.offset,
      limit: promptSelection.limit,
      promptIds: promptSelection.promptIds
    }
  };
}

export async function createAssetLibraryBatch(input: {
  manifest: AssetLibraryManifest;
  candidates: number;
  limit?: number;
  offset?: number;
  promptIds?: string[];
  model?: string;
  metadata?: Record<string, unknown>;
  status?: AssetLibraryBatch["status"];
}) {
  const estimate = estimateAssetLibraryGeneration({
    manifest: input.manifest,
    candidates: input.candidates,
    limit: input.limit,
    offset: input.offset,
    promptIds: input.promptIds
  });
  const id = `asset_batch_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const row = await requireData<AssetLibraryBatchRow>(
    getSupabaseAdminClient()
      .from("asset_library_batches")
      .insert({
        id,
        manifest_name: input.manifest.name,
        vertical: input.manifest.vertical,
        model: input.model ?? input.manifest.defaultModel,
        candidates_per_prompt: estimate.candidatesPerPrompt,
        prompt_count: estimate.promptCount,
        estimated_images: estimate.estimatedImages,
        estimated_cost_usd: estimate.estimatedCostUsd,
        status: input.status ?? "running",
        metadata: {
          ...(input.metadata ?? {}),
          manifestVersion: input.manifest.version,
          defaultSize: input.manifest.defaultSize,
          defaultQuality: input.manifest.defaultQuality,
          pricePerImageUsd: estimate.pricePerImageUsd,
          promptSelection: estimate.selection
        }
      })
      .select("*")
      .single(),
    "Create asset library batch"
  );
  return rowToBatch(row);
}

export async function completeAssetLibraryBatch(batchId: string, status: "completed" | "failed", metadata?: Record<string, unknown>) {
  const patch: Record<string, unknown> = {
    status,
    completed_at: new Date().toISOString()
  };
  if (metadata) patch.metadata = metadata;
  const row = await requireData<AssetLibraryBatchRow>(
    getSupabaseAdminClient().from("asset_library_batches").update(patch).eq("id", batchId).select("*").single(),
    "Complete asset library batch"
  );
  return rowToBatch(row);
}

export async function generateAssetLibraryCandidates(input: {
  manifest: AssetLibraryManifest;
  candidates: number;
  limit: number;
  offset?: number;
  promptIds?: string[];
  confirmCost: boolean;
  model?: string;
  size?: string;
  quality?: string;
}) {
  const candidates = positiveInt(input.candidates, "candidates");
  const limit = positiveInt(input.limit, "limit");
  if (!Number.isFinite(limit) || limit < 1) throw new Error("Generation requires an explicit positive --limit.");
  const promptSelection = selectAssetLibraryManifestPrompts(input.manifest, {
    limit,
    offset: input.offset,
    promptIds: input.promptIds
  });
  const estimate = estimateAssetLibraryGeneration({
    manifest: input.manifest,
    candidates,
    limit,
    offset: input.offset,
    promptIds: input.promptIds
  });
  if (!input.confirmCost) {
    throw new Error(
      `Generation refused: estimated ${estimate.estimatedImages} image(s), approximately $${estimate.estimatedCostUsd.toFixed(2)}. Re-run with --confirm-cost.`
    );
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for asset-library generation.");

  const batch = await createAssetLibraryBatch({
    manifest: input.manifest,
    candidates,
    limit,
    offset: input.offset,
    promptIds: input.promptIds,
    model: input.model,
    metadata: { estimate, source: "asset-library-cli" }
  });
  const model = input.model ?? input.manifest.defaultModel;
  const size = input.size ?? input.manifest.defaultSize;
  const quality = input.quality ?? input.manifest.defaultQuality;
  const generated: AssetLibraryAsset[] = [];

  try {
    for (const prompt of promptSelection.prompts) {
      for (let index = 1; index <= candidates; index += 1) {
        const bytes = await generateOpenAiImageBytes({ apiKey, model, size, quality, prompt });
        const asset = await storeGeneratedLibraryCandidate({
          batchId: batch.id,
          manifest: input.manifest,
          prompt,
          generationIndex: index,
          bytes,
          mimeType: "image/jpeg",
          model,
          size,
          quality
        });
        generated.push(asset);
      }
    }
    await completeAssetLibraryBatch(batch.id, "completed", { generated: generated.length, estimate });
    return { batch, generated, estimate };
  } catch (caught) {
    await completeAssetLibraryBatch(batch.id, "failed", {
      generated: generated.length,
      estimate,
      error: caught instanceof Error ? caught.message : String(caught)
    }).catch(() => undefined);
    throw caught;
  }
}

export async function storeGeneratedLibraryCandidate(input: {
  batchId: string;
  manifest: AssetLibraryManifest;
  prompt: AssetLibraryPromptRecord;
  generationIndex: number;
  bytes: Buffer | Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  model: string;
  size: string;
  quality: string;
  parentAssetId?: string;
}) {
  const bytes = Buffer.from(input.bytes);
  const metadata = imageMetadata(bytes, input.mimeType);
  const checksum = sha256(bytes);
  const assetId = `asset_${input.manifest.name}_${input.prompt.id}_${input.generationIndex}_${checksum.slice(0, 10)}`;
  const rawStoragePath = rawAssetLibraryPath(input.manifest.vertical, input.batchId, assetId, input.mimeType);
  const duplicateCount = await existingChecksumCount(checksum);
  const qc = mechanicalQc({
    bytes,
    mimeType: input.mimeType,
    width: metadata.width,
    height: metadata.height,
    prompt: input.prompt,
    duplicateCount
  });
  await uploadAssetLibraryBytes(rawStoragePath, bytes, input.mimeType);
  const row = await requireData<AssetLibraryAssetRow>(
    getSupabaseAdminClient()
      .from("asset_library_assets")
      .insert({
        id: assetId,
        batch_id: input.batchId,
        parent_asset_id: input.parentAssetId,
        prompt_id: input.prompt.id,
        prompt_metadata: input.prompt,
        vertical: input.manifest.vertical,
        category: input.prompt.category,
        intended_uses: input.prompt.intendedUses,
        tags: assetLibraryStoredTagsForPrompt(input.prompt),
        status: "candidate",
        raw_storage_path: rawStoragePath,
        approved_storage_paths: {},
        checksum,
        width: metadata.width,
        height: metadata.height,
        mime_type: input.mimeType,
        model: input.model,
        quality: input.quality,
        size: input.size,
        generation_index: input.generationIndex,
        qc_json: qc
      })
      .select("*")
      .single(),
    "Create asset library candidate"
  );
  return rowToAsset(row);
}

export async function listAssetLibraryAssets(filter: {
  vertical?: Vertical;
  status?: AssetLibraryStatus;
  excludeStatuses?: AssetLibraryStatus[];
  tag?: string;
  intendedUse?: string;
  batchId?: string;
  limit?: number;
  offset?: number;
} = {}) {
  let query = getSupabaseAdminClient()
    .from("asset_library_assets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
  if (filter.offset) query = query.range(filter.offset, filter.offset + Math.min(Math.max(filter.limit ?? 100, 1), 500) - 1);
  if (filter.vertical) query = query.eq("vertical", filter.vertical);
  if (filter.status) query = query.eq("status", filter.status);
  for (const status of filter.excludeStatuses ?? []) query = query.neq("status", status);
  if (filter.batchId) query = query.eq("batch_id", filter.batchId);
  if (filter.tag) query = query.contains("tags", [filter.tag]);
  if (filter.intendedUse) query = query.contains("intended_uses", [filter.intendedUse]);
  const rows = await requireData<AssetLibraryAssetRow[]>(query, "List asset library assets");
  return rows.map(rowToAsset);
}

export async function listAssetLibraryBatches(limit = 50) {
  const rows = await requireData<AssetLibraryBatchRow[]>(
    getSupabaseAdminClient()
      .from("asset_library_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100)),
    "List asset library batches"
  );
  return rows.map(rowToBatch);
}

export async function getAssetLibraryAsset(assetId: string) {
  const row = await requireMaybe<AssetLibraryAssetRow>(
    getSupabaseAdminClient().from("asset_library_assets").select("*").eq("id", assetId).maybeSingle(),
    "Get asset library asset"
  );
  return row ? rowToAsset(row) : undefined;
}

export async function getAssetLibraryReviews(assetId: string) {
  const rows = await requireData<AssetLibraryReviewRow[]>(
    getSupabaseAdminClient()
      .from("asset_library_reviews")
      .select("*")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: false }),
    "List asset library reviews"
  );
  return rows.map(rowToReview);
}

export async function reviewAssetLibraryAsset(input: {
  assetId: string;
  decision: AssetLibraryReviewDecision;
  notes?: string;
  rejectionReasons?: string[];
  policyFailureTags?: AssetLibraryPolicyFailTag[];
  reviewer?: string;
}) {
  const asset = await getAssetLibraryAsset(input.assetId);
  if (!asset) throw new Error("Asset library asset not found.");
  if (!isAllowedReviewTransition(asset.status, input.decision)) {
    throw new Error(`Invalid asset review transition: ${asset.status} -> ${input.decision}.`);
  }

  const now = new Date().toISOString();
  const nextStatus: AssetLibraryStatus = input.decision;
  const nextTags = input.policyFailureTags
    ? replaceAssetLibraryPolicyFailTags(asset.tags, input.policyFailureTags)
    : cleanTokenList(asset.tags);
  const policy = assessAssetLibraryPolicy({ ...asset, tags: nextTags });
  if (nextStatus === "approved" && !policy.siteSelectable) {
    throw new Error(`Asset library approval blocked by generated-image policy: ${policy.hardFailReasons.join("; ")}`);
  }
  const patch: Record<string, unknown> = {
    status: nextStatus,
    tags: nextTags,
    updated_at: now
  };
  if (nextStatus === "approved") patch.approved_at = now;
  const rejectionReasons = cleanTokenList([...(input.rejectionReasons ?? []), ...(input.policyFailureTags ?? [])]);
  const reviewRow = await requireData<AssetLibraryReviewRow>(
    getSupabaseAdminClient()
      .from("asset_library_reviews")
      .insert({
        id: `asset_review_${randomUUID().replace(/-/g, "")}`,
        asset_id: asset.id,
        decision: input.decision,
        notes: input.notes?.trim() || null,
        rejection_reasons: rejectionReasons,
        reviewer: input.reviewer?.trim() || "operator"
      })
      .select("*")
      .single(),
    "Create asset library review"
  );
  const assetRow = await requireData<AssetLibraryAssetRow>(
    getSupabaseAdminClient().from("asset_library_assets").update(patch).eq("id", asset.id).select("*").single(),
    "Update asset library review status"
  );
  return { asset: rowToAsset(assetRow), review: rowToReview(reviewRow) };
}

export async function updateAssetLibraryAssetTags(input: {
  assetId: string;
  tags?: string[];
  intendedUses?: string[];
}) {
  const asset = await getAssetLibraryAsset(input.assetId);
  if (!asset) throw new Error("Asset library asset not found.");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.tags) {
    const tags = cleanTokenList(input.tags);
    assertProtectedPolicyTagsUnchanged(asset.tags, tags);
    patch.tags = tags;
  }
  if (input.intendedUses) patch.intended_uses = cleanTokenList(input.intendedUses);
  const row = await requireData<AssetLibraryAssetRow>(
    getSupabaseAdminClient().from("asset_library_assets").update(patch).eq("id", input.assetId).select("*").single(),
    "Update asset library tags"
  );
  return rowToAsset(row);
}

export async function backfillAssetLibraryTaxonomy(input: {
  manifest: AssetLibraryManifest;
  status?: AssetLibraryStatus;
  dryRun?: boolean;
  limit?: number;
}) {
  const promptById = new Map(input.manifest.prompts.map((prompt) => [prompt.id, prompt]));
  let query = getSupabaseAdminClient()
    .from("asset_library_assets")
    .select("*")
    .like("id", `asset_${input.manifest.name}_%`)
    .limit(Math.min(Math.max(input.limit ?? 1000, 1), 1000));
  if (input.status) query = query.eq("status", input.status);
  const rows = await requireData<AssetLibraryAssetRow[]>(query, "List asset library rows for taxonomy backfill");
  const matched = rows.map(rowToAsset).filter((asset) => promptById.has(asset.promptId));
  const changed: AssetLibraryAsset[] = [];
  const skipped: string[] = [];
  for (const asset of matched) {
    const prompt = promptById.get(asset.promptId);
    if (!prompt) {
      skipped.push(asset.id);
      continue;
    }
    const nextTags = mergeBackfilledAssetLibraryTags(asset.tags, prompt);
    const tagsChanged = tokenListSignature(asset.tags) !== tokenListSignature(nextTags);
    const promptChanged = stableJson(asset.promptMetadata) !== stableJson(prompt);
    const intendedUsesChanged = tokenListSignature(asset.intendedUses) !== tokenListSignature(prompt.intendedUses);
    const categoryChanged = asset.category !== prompt.category;
    if (!tagsChanged && !promptChanged && !intendedUsesChanged && !categoryChanged) {
      skipped.push(asset.id);
      continue;
    }
    if (input.dryRun) {
      changed.push({ ...asset, promptMetadata: prompt, tags: nextTags, category: prompt.category, intendedUses: prompt.intendedUses });
      continue;
    }
    const row = await requireData<AssetLibraryAssetRow>(
      getSupabaseAdminClient()
        .from("asset_library_assets")
        .update({
          prompt_metadata: prompt,
          category: prompt.category,
          intended_uses: prompt.intendedUses,
          tags: nextTags,
          updated_at: new Date().toISOString()
        })
        .eq("id", asset.id)
        .select("*")
        .single(),
      "Backfill asset library taxonomy"
    );
    changed.push(rowToAsset(row));
  }
  return {
    manifest: input.manifest.name,
    status: input.status,
    dryRun: Boolean(input.dryRun),
    scanned: rows.length,
    matched: matched.length,
    changed: changed.length,
    skipped: skipped.length,
    assetIds: changed.map((asset) => asset.id)
  };
}

export async function deriveApprovedAssetLibraryAsset(assetId: string) {
  const asset = await getAssetLibraryAsset(assetId);
  if (!asset) throw new Error("Asset library asset not found.");
  if (asset.status !== "approved") throw new Error("Only approved asset-library assets can receive public derivatives.");
  const policy = assessAssetLibraryPolicy(asset);
  if (!policy.siteSelectable) {
    throw new Error(`Only policy-selectable asset-library assets can receive public derivatives: ${policy.hardFailReasons.join("; ")}`);
  }
  const { data, error } = await getSupabaseAdminClient().storage.from(ASSET_LIBRARY_BUCKET_NAME).download(asset.rawStoragePath);
  if (error || !data) throw new Error(`Download raw asset failed: ${error?.message ?? "missing file"}`);
  const sourceBytes = Buffer.from(await data.arrayBuffer());
  const sourceMetadata = imageMetadata(sourceBytes, asset.mimeType);
  const sourceWidth = sourceMetadata.width ?? asset.width;
  if (asset.intendedUses.includes("hero") && (!sourceWidth || sourceWidth < ASSET_LIBRARY_HERO_DERIVATIVE_MIN_WIDTH)) {
    throw new Error(
      `Hero derivative blocked: source image width ${sourceWidth ?? "unknown"} is below the ${ASSET_LIBRARY_HERO_DERIVATIVE_MIN_WIDTH}px floor.`
    );
  }
  const originalPath = approvedAssetLibraryPath(asset.vertical, asset.id, "original.jpg");
  await uploadAssetLibraryBytes(originalPath, sourceBytes, "image/jpeg", "public, max-age=31536000, immutable");

  const variants = await createWebpVariants(sourceBytes, [
    { name: "hero-1600.webp", width: 1600, quality: 0.86 },
    { name: "card-900.webp", width: 900, quality: 0.84 },
    { name: "thumb-320.webp", width: 320, quality: 0.8 }
  ]);
  const approvedStoragePaths: AssetLibraryAsset["approvedStoragePaths"] = { original: originalPath };
  for (const variant of variants) {
    const path = approvedAssetLibraryPath(asset.vertical, asset.id, variant.name);
    await uploadAssetLibraryBytes(path, variant.bytes, "image/webp", "public, max-age=31536000, immutable");
    approvedStoragePaths[variant.name] = path;
  }
  const publicUrl = publicAssetLibraryUrl(asset.id, "hero-1600.webp");
  const row = await requireData<AssetLibraryAssetRow>(
    getSupabaseAdminClient()
      .from("asset_library_assets")
      .update({
        approved_storage_paths: approvedStoragePaths,
        public_url: publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq("id", asset.id)
      .select("*")
      .single(),
    "Update approved asset derivatives"
  );
  return rowToAsset(row);
}

export async function approvedAssetLibraryAssetsForVertical(vertical: Vertical): Promise<ApprovedAssetLibraryAsset[]> {
  return approvedAssetLibraryAssetsForVerticals([vertical]);
}

export async function approvedAssetLibraryAssetsForVerticals(verticals: Vertical[]): Promise<ApprovedAssetLibraryAsset[]> {
  const cleanVerticals = Array.from(new Set(verticals));
  const rows = await requireData<AssetLibraryAssetRow[]>(
    getSupabaseAdminClient()
      .from("asset_library_assets")
      .select("*")
      .in("vertical", cleanVerticals)
      .eq("status", "approved")
      .not("public_url", "is", null)
      .order("approved_at", { ascending: false }),
    "List approved asset library assets"
  );
  return rows.map(rowToAsset).map(toApprovedAsset);
}

export async function retagApprovedAssetLibraryCloseupHeroes(input: {
  vertical?: Vertical;
  dryRun?: boolean;
  limit?: number;
  minimumEnvironmentHeroes?: number;
} = {}) {
  const vertical = input.vertical ?? "auto_services";
  const rows = await requireData<AssetLibraryAssetRow[]>(
    getSupabaseAdminClient()
      .from("asset_library_assets")
      .select("*")
      .eq("vertical", vertical)
      .eq("status", "approved")
      .not("public_url", "is", null)
      .limit(1000),
    "List approved asset library rows for close-up hero retag"
  );
  const approved = rows.map(rowToAsset);
  const approvedPublic = approved.map(toApprovedAsset);
  const environmentHeroCount = approvedPublic.filter(
    (asset) =>
      asset.intendedUses.includes("hero") &&
      isEnvironmentAssetLibraryAsset(asset) &&
      assessAssetLibraryPolicy(asset).siteSelectable
  ).length;
  const minimumEnvironmentHeroes = input.minimumEnvironmentHeroes ?? 1;
  const targets = approved
    .filter(
      (asset) =>
        asset.publicUrl &&
        asset.intendedUses.includes("hero") &&
        !isEnvironmentAssetLibraryAsset(asset) &&
        assessAssetLibraryPolicy(asset).siteSelectable
    )
    .slice(0, Math.min(Math.max(input.limit ?? approved.length, 1), approved.length));
  if (!input.dryRun && environmentHeroCount < minimumEnvironmentHeroes) {
    throw new Error(
      `Close-up hero retag refused: found ${environmentHeroCount} approved environment hero asset(s), below required minimum ${minimumEnvironmentHeroes}.`
    );
  }
  const changes = targets.map((asset) => ({
    id: asset.id,
    from: asset.intendedUses,
    to: cleanTokenList([...asset.intendedUses.filter((use) => use !== "hero"), "section", "card", "gallery"])
  }));
  if (!input.dryRun) {
    for (const change of changes) {
      await requireData<AssetLibraryAssetRow>(
        getSupabaseAdminClient()
          .from("asset_library_assets")
          .update({ intended_uses: change.to, updated_at: new Date().toISOString() })
          .eq("id", change.id)
          .select("*")
          .single(),
        "Retag approved close-up hero asset"
      );
    }
  }
  return {
    vertical,
    dryRun: Boolean(input.dryRun),
    scanned: approved.length,
    environmentHeroCount,
    minimumEnvironmentHeroes,
    changed: changes.length,
    changes
  };
}

export function selectApprovedAssetLibraryMedia(input: {
  business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services" | "siteId">;
  assets: ApprovedAssetLibraryAsset[];
  intendedUse: string;
  category?: string;
  usedAssetIds?: Set<string>;
}): { asset?: ApprovedAssetLibraryAsset; fallbackLevel: 1 | 2 | 3 | 4; notes: string[] } {
  const approved = input.assets.filter((asset) => asset.publicUrl && assessAssetLibraryPolicy(asset).siteSelectable && isAssetLibraryAssetAllowedForBusiness(asset, input.business));
  const unused = approved.filter((asset) => !input.usedAssetIds?.has(asset.id));
  const pool = unused.length ? unused : approved;
  const terms = serviceTerms(input.business);
  const catalogSlugs = businessCatalogServiceSlugs(input.business);
  const category = input.category?.toLowerCase();
  const intendedUse = input.intendedUse.toLowerCase();

  const levelOne = rankLibraryAssets(
    pool.filter((asset) => {
      const matchesUse = asset.intendedUses.includes(intendedUse);
      const matchesCategory = Boolean(category && asset.category === category);
      const matchesService = assetMatchesTerms(asset, terms, catalogSlugs);
      return matchesUse && (matchesCategory || matchesService);
    }),
    terms,
    catalogSlugs
  )[0];
  if (levelOne) return { asset: levelOne, fallbackLevel: 1, notes: ["Selected approved library asset by vertical, intended use, and category/service match."] };

  const levelTwo = rankLibraryAssets(pool.filter((asset) => asset.intendedUses.includes(intendedUse)), terms, catalogSlugs)[0];
  if (levelTwo) return { asset: levelTwo, fallbackLevel: 2, notes: ["Selected approved library asset by vertical and intended use."] };

  const levelThree = rankLibraryAssets(pool, terms, catalogSlugs)[0];
  if (levelThree) return { asset: levelThree, fallbackLevel: 3, notes: ["Selected approved library asset by vertical fallback."] };

  return { fallbackLevel: 4, notes: ["No approved asset-library image matched this vertical; use existing non-library fallback."] };
}

export function publicAssetLibraryUrl(assetId: string, variant: AssetLibraryApprovedVariant = "hero-1600.webp") {
  return `/api/asset-library/public/${encodeURIComponent(assetId)}/${variant}`;
}

export function assessAssetLibraryPolicy(asset: Pick<AssetLibraryAsset, "tags" | "intendedUses" | "promptMetadata">): AssetLibraryPolicyAssessment {
  const tags = cleanTokenList([...(asset.tags ?? []), ...(asset.promptMetadata?.tags ?? [])]);
  const subjectClassifications = assetLibrarySafeClassificationTags(tags);
  const modifiers = tags.filter((tag) => (ASSET_LIBRARY_POLICY_MODIFIER_TAGS as readonly string[]).includes(tag));
  const policyFailTags = tags.filter(isAssetLibraryPolicyFailTag);
  const hardFailReasons: string[] = [...policyFailTags];

  if (subjectClassifications.length === 0) {
    hardFailReasons.push("missing_safe_subject_classification");
  } else if (subjectClassifications.length > 1) {
    hardFailReasons.push("multiple_safe_subject_classifications");
  }
  if (tags.includes("no_location_context") && subjectClassifications.length !== 1) {
    hardFailReasons.push("no_location_context_without_subject_classification");
  }

  const softWarnings: string[] = [];
  for (const warningTag of ["vehicle_lift", "vehicle-lift", "service_bay", "service-bay", "technician", "wide"]) {
    if (tags.includes(warningTag)) softWarnings.push(`review_${warningTag.replace(/-/g, "_")}`);
  }

  const siteSelectable = hardFailReasons.length === 0;
  return {
    siteSelectable,
    recommendedDecision: siteSelectable ? "approved" : "rejected",
    allowedUses: siteSelectable ? cleanTokenList(asset.intendedUses ?? []) : [],
    subjectClassifications,
    modifiers,
    hardFailReasons,
    softWarnings
  };
}

export function isAssetLibraryProtectedPolicyTag(tag: string) {
  return (
    (ASSET_LIBRARY_SAFE_CLASSIFICATION_TAGS as readonly string[]).includes(tag) ||
    (ASSET_LIBRARY_POLICY_MODIFIER_TAGS as readonly string[]).includes(tag) ||
    isAssetLibraryPolicyFailTag(tag) ||
    isAssetLibraryDerivedTaxonomyTag(tag)
  );
}

export function isAssetLibraryPolicyFailTag(tag: string): tag is AssetLibraryPolicyFailTag {
  return (ASSET_LIBRARY_POLICY_FAIL_TAGS as readonly string[]).includes(tag);
}

export function isAssetLibraryDerivedTaxonomyTag(tag: string) {
  return ASSET_LIBRARY_DERIVED_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix));
}

export function derivedAssetLibraryTaxonomyTags(prompt: AssetLibraryPromptRecord) {
  return cleanTokenList([
    `family_${prompt.imageFamily}`,
    ...prompt.imageSubjects.map((subject) => `subject_${subject}`),
    ...prompt.serviceHints.map((hint) => `hint_${hint}`),
    ...prompt.catalogServiceSlugs.map((slug) => `catalog_${slug}`),
    prompt.sceneFamily ? `scene_${prompt.sceneFamily}` : undefined,
    prompt.heroClearSide ? `clear_${prompt.heroClearSide}` : undefined
  ].filter((value): value is string => Boolean(value)));
}

export function isEnvironmentAssetLibraryAsset(
  asset: Pick<ApprovedAssetLibraryAsset, "category" | "tags" | "promptMetadata">
) {
  return Boolean(
    asset.category === "shop_environment" ||
      asset.tags.includes("shop_environment") ||
      asset.promptMetadata?.tags?.includes("shop_environment") ||
      asset.promptMetadata?.imageFamily === "shop_environment" ||
      asset.promptMetadata?.compositionTemplate === "wide_environment" ||
      asset.promptMetadata?.compositionTemplate === "soft_blur_background"
  );
}

function isEnvironmentAssetLibraryPrompt(prompt: AssetLibraryPromptRecord) {
  return Boolean(
    prompt.tags.includes("shop_environment") ||
      prompt.imageFamily === "shop_environment" ||
      prompt.compositionTemplate === "wide_environment" ||
      prompt.compositionTemplate === "soft_blur_background"
  );
}

function parseImageSize(size: string) {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function promptRequiresHeroDerivativeFloor(prompt: AssetLibraryPromptRecord) {
  return prompt.intendedUses.includes("hero");
}

function environmentPromptMetadataComplete(prompt: AssetLibraryPromptRecord) {
  if (!isEnvironmentAssetLibraryPrompt(prompt)) return true;
  return Boolean(prompt.sceneFamily && prompt.heroClearSide);
}

function stripDerivedTagPrefix(tag: string) {
  return tag.replace(/^(family|subject|hint|catalog|scene|clear)_/, "");
}

function sourceCanProduceHeroDerivative(width?: number) {
  return Boolean(width && width >= ASSET_LIBRARY_HERO_DERIVATIVE_MIN_WIDTH);
}

function promptMetadataComplete(prompt: AssetLibraryPromptRecord) {
  return Boolean(
    prompt.id &&
      prompt.category &&
      prompt.intendedUses.length &&
      prompt.tags.length &&
      prompt.imageFamily &&
      prompt.imageSubjects.length &&
      prompt.serviceHints.length &&
      prompt.compositionTemplate &&
      environmentPromptMetadataComplete(prompt)
  );
}

function requiredConstraintsForPrompt(prompt: AssetLibraryPromptRecord) {
  return isEnvironmentAssetLibraryPrompt(prompt)
    ? ASSET_LIBRARY_ENVIRONMENT_REQUIRED_NEGATIVE_CONSTRAINTS
    : ASSET_LIBRARY_V2_REQUIRED_NEGATIVE_CONSTRAINTS;
}

function promptHasRequiredNegativeConstraints(prompt: AssetLibraryPromptRecord) {
  const normalized = prompt.negativeConstraints.map((item) => item.toLowerCase());
  return requiredConstraintsForPrompt(prompt).every((constraint) => normalized.includes(constraint.toLowerCase()));
}

function heroDerivativeFloorCheckDetail(width?: number) {
  return width ? `${width}px source width.` : "Source width unavailable.";
}

function heroDerivativeFloorCheckOk(prompt: AssetLibraryPromptRecord, width?: number) {
  return !promptRequiresHeroDerivativeFloor(prompt) || sourceCanProduceHeroDerivative(width);
}

function environmentAspectRatioOk(width?: number, height?: number) {
  if (!width || !height) return false;
  return Math.abs(width / height - 2) <= 0.1;
}

function environmentAspectRatioDetail(width?: number, height?: number) {
  return width && height ? `${width}x${height}` : "Source dimensions unavailable.";
}

function environmentAspectRatioCheckOk(prompt: AssetLibraryPromptRecord, width?: number, height?: number) {
  if (!isEnvironmentAssetLibraryPrompt(prompt)) return true;
  return environmentAspectRatioOk(width, height);
}

function environmentAspectRatioCheckDetail(prompt: AssetLibraryPromptRecord, width?: number, height?: number) {
  if (!isEnvironmentAssetLibraryPrompt(prompt)) return "Not an environment prompt.";
  return environmentAspectRatioDetail(width, height);
}

function heroDerivativeFloorApplies(prompt: AssetLibraryPromptRecord) {
  return promptRequiresHeroDerivativeFloor(prompt);
}

function environmentAspectRatioApplies(prompt: AssetLibraryPromptRecord) {
  return isEnvironmentAssetLibraryPrompt(prompt);
}

function maybeCheckDetail(applies: boolean, passDetail: string, skippedDetail: string) {
  return applies ? passDetail : skippedDetail;
}

function maybeCheckOk(applies: boolean, ok: boolean) {
  return applies ? ok : true;
}

function cleanOptionalTokenList(values: Array<string | undefined>) {
  return cleanTokenList(values.filter((value): value is string => Boolean(value)));
}

function promptTaxonomyTerms(prompt: AssetLibraryPromptRecord) {
  return cleanOptionalTokenList([
    prompt.imageFamily,
    ...prompt.imageSubjects,
    ...prompt.serviceHints,
    ...prompt.catalogServiceSlugs,
    prompt.compositionTemplate,
    prompt.sceneFamily,
    prompt.heroClearSide
  ]);
}

export function assetLibraryStoredTagsForPrompt(prompt: AssetLibraryPromptRecord) {
  return cleanTokenList([...prompt.tags, ...derivedAssetLibraryTaxonomyTags(prompt)]);
}

export function selectAssetLibraryManifestPrompts(
  manifest: Pick<AssetLibraryManifest, "prompts">,
  selection: AssetLibraryPromptSelection = {}
): AssetLibraryResolvedPromptSelection {
  const hasPromptIds = Boolean(selection.promptIds?.length);
  const hasOffset = selection.offset !== undefined;
  if (hasPromptIds && hasOffset) throw new Error("--offset and --prompt-ids cannot be combined.");
  if (selection.offset !== undefined && (!Number.isInteger(selection.offset) || selection.offset < 0)) {
    throw new Error("--offset must be a non-negative integer.");
  }
  if (selection.limit !== undefined) positiveInt(selection.limit, "limit");

  if (hasPromptIds) {
    const requestedIds = cleanTokenList(selection.promptIds ?? []);
    const requestedSet = new Set(requestedIds);
    if (requestedSet.size !== (selection.promptIds ?? []).length) throw new Error("--prompt-ids contains duplicate prompt ids.");
    const prompts = manifest.prompts.filter((prompt) => requestedSet.has(prompt.id));
    const foundIds = new Set(prompts.map((prompt) => prompt.id));
    const missingIds = requestedIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) throw new Error(`Unknown --prompt-ids value(s): ${missingIds.join(", ")}.`);
    return {
      prompts: prompts.slice(0, selection.limit ?? prompts.length),
      selectionMode: "prompt_ids",
      limit: selection.limit,
      promptIds: requestedIds
    };
  }

  const offset = selection.offset ?? 0;
  const prompts = manifest.prompts.slice(offset, selection.limit === undefined ? undefined : offset + selection.limit);
  return {
    prompts,
    selectionMode: hasOffset ? "offset" : "prefix",
    offset: hasOffset ? offset : undefined,
    limit: selection.limit
  };
}

export function rawAssetLibraryPath(vertical: Vertical, batchId: string, assetId: string, mimeType: string) {
  return `raw/${safeSegment(vertical)}/${safeSegment(batchId)}/${safeSegment(assetId)}.${extensionForMime(mimeType)}`;
}

export function approvedAssetLibraryPath(vertical: Vertical, assetId: string, file: string) {
  return `approved/${safeSegment(vertical)}/${safeSegment(assetId)}/${file}`;
}

export function assetLibraryApprovedLicenseNote(assetId: string) {
  return `AI-generated category image (${assetId}) approved for Lodesta preview/published-site use. It is not a photo of this specific business, staff, vehicles, or customer work.`;
}

async function generateOpenAiImageBytes(input: {
  apiKey: string;
  model: string;
  size: string;
  quality: string;
  prompt: AssetLibraryPromptRecord;
}) {
  const body = {
    model: input.model,
    prompt: [
      input.prompt.prompt,
      "",
      `Negative constraints: ${input.prompt.negativeConstraints.join("; ")}.`,
      "Create generic, photorealistic category imagery suitable for Lodesta small-business website layouts."
    ].join("\n"),
    n: 1,
    size: input.size,
    quality: input.quality,
    output_format: "jpeg",
    moderation: "auto"
  };
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: openAiRequestSignal(90_000)
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(openAiErrorMessage(payload) ?? `OpenAI image generation failed with status ${response.status}`);
  const base64 = extractImageBase64(payload);
  if (!base64) throw new Error("OpenAI image generation response did not include b64_json.");
  return Buffer.from(base64, "base64");
}

async function uploadAssetLibraryBytes(path: string, bytes: Buffer, mimeType: string, cacheControl = "private, max-age=0") {
  const { error } = await getSupabaseAdminClient().storage.from(ASSET_LIBRARY_BUCKET_NAME).upload(path, bytes, {
    contentType: mimeType,
    cacheControl,
    upsert: true
  });
  if (error) throw new Error(`Supabase asset-library upload failed: ${error.message}`);
}

function mechanicalQc(input: {
  bytes: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  prompt: AssetLibraryPromptRecord;
  duplicateCount?: number;
}): AssetLibraryMechanicalQc {
  const checks = [
    {
      id: "mime_bytes",
      ok: imageMimeTypeMatchesBytes(input.mimeType, input.bytes),
      detail: `Bytes ${imageMimeTypeMatchesBytes(input.mimeType, input.bytes) ? "match" : "do not match"} ${input.mimeType}.`
    },
    {
      id: "dimensions",
      ok: Boolean(input.width && input.height && input.width >= 320 && input.height >= 240),
      detail: input.width && input.height ? `${input.width}x${input.height}` : "Dimensions unavailable."
    },
    {
      id: "file_size",
      ok: input.bytes.byteLength > 1024 && input.bytes.byteLength <= 20 * 1024 * 1024,
      detail: `${input.bytes.byteLength} bytes.`
    },
    {
      id: "duplicate_checksum",
      ok: (input.duplicateCount ?? 0) === 0,
      detail: (input.duplicateCount ?? 0) === 0 ? "Checksum is new." : `${input.duplicateCount} existing asset(s) share this checksum.`
    },
    {
      id: "negative_constraints",
      ok: promptHasRequiredNegativeConstraints(input.prompt),
      detail: "Required negative constraints are present."
    },
    {
      id: "prompt_metadata",
      ok: promptMetadataComplete(input.prompt),
      detail: "Prompt metadata is complete."
    },
    {
      id: "hero_derivative_floor",
      ok: maybeCheckOk(heroDerivativeFloorApplies(input.prompt), heroDerivativeFloorCheckOk(input.prompt, input.width)),
      detail: maybeCheckDetail(
        heroDerivativeFloorApplies(input.prompt),
        heroDerivativeFloorCheckDetail(input.width),
        "Prompt is not hero-intended."
      )
    },
    {
      id: "environment_aspect_ratio",
      ok: maybeCheckOk(environmentAspectRatioApplies(input.prompt), environmentAspectRatioCheckOk(input.prompt, input.width, input.height)),
      detail: maybeCheckDetail(
        environmentAspectRatioApplies(input.prompt),
        environmentAspectRatioCheckDetail(input.prompt, input.width, input.height),
        "Prompt is not an environment prompt."
      )
    }
  ];
  return { ok: checks.every((check) => check.ok), checks };
}

async function existingChecksumCount(checksum: string) {
  const { count, error } = await getSupabaseAdminClient()
    .from("asset_library_assets")
    .select("id", { count: "exact", head: true })
    .eq("checksum", checksum);
  if (error) throw new Error(`Check asset-library checksum duplicates: ${error.message}`);
  return count ?? 0;
}

function imageMimeTypeMatchesBytes(mimeType: string, bytes: Buffer) {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function imageMetadata(bytes: Buffer, mimeType: string): { width?: number; height?: number } {
  if (mimeType === "image/png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (mimeType === "image/webp") return webpDimensions(bytes);
  return {};
}

function jpegDimensions(bytes: Buffer): { width?: number; height?: number } {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return {};
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < bytes.length) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return {};
}

function webpDimensions(bytes: Buffer): { width?: number; height?: number } {
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    return { width, height };
  }
  return {};
}

async function createWebpVariants(
  sourceBytes: Buffer,
  variants: Array<{ name: AssetLibraryApprovedVariant; width: number; quality: number }>
): Promise<Array<{ name: AssetLibraryApprovedVariant; bytes: Buffer }>> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const dataUrl = `data:image/jpeg;base64,${sourceBytes.toString("base64")}`;
    return await page.evaluate(
      async ({ imageUrl, requestedVariants }) => {
        const image = new Image();
        image.decoding = "async";
        image.src = imageUrl;
        await image.decode();
        return Promise.all(
          requestedVariants.map(async (variant) => {
            const width = Math.min(variant.width, image.naturalWidth || variant.width);
            const height = Math.max(1, Math.round(width * ((image.naturalHeight || width) / (image.naturalWidth || width))));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas unavailable for image derivatives.");
            context.drawImage(image, 0, 0, width, height);
            const data = canvas.toDataURL("image/webp", variant.quality).split(",")[1] ?? "";
            return { name: variant.name, base64: data };
          })
        );
      },
      { imageUrl: dataUrl, requestedVariants: variants }
    ).then((results) => results.map((result) => ({ name: result.name, bytes: Buffer.from(result.base64, "base64") })));
  } finally {
    await browser.close();
  }
}

function rowToBatch(row: AssetLibraryBatchRow): AssetLibraryBatch {
  return {
    id: row.id,
    manifestName: row.manifest_name,
    vertical: row.vertical,
    model: row.model,
    candidatesPerPrompt: row.candidates_per_prompt,
    promptCount: row.prompt_count,
    estimatedImages: row.estimated_images,
    estimatedCostUsd: Number(row.estimated_cost_usd),
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined
  };
}

function rowToAsset(row: AssetLibraryAssetRow): AssetLibraryAsset {
  return {
    id: row.id,
    batchId: row.batch_id ?? undefined,
    parentAssetId: row.parent_asset_id ?? undefined,
    promptId: row.prompt_id,
    promptMetadata: row.prompt_metadata,
    vertical: row.vertical,
    category: row.category,
    intendedUses: row.intended_uses ?? [],
    tags: row.tags ?? [],
    status: row.status,
    rawStoragePath: row.raw_storage_path,
    approvedStoragePaths: row.approved_storage_paths ?? {},
    publicUrl: row.public_url ?? undefined,
    checksum: row.checksum,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    mimeType: row.mime_type,
    model: row.model,
    quality: row.quality,
    size: row.size,
    generationIndex: row.generation_index,
    qc: row.qc_json ?? { ok: false, checks: [] },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at ?? undefined
  };
}

function rowToReview(row: AssetLibraryReviewRow): AssetLibraryReview {
  return {
    id: row.id,
    assetId: row.asset_id,
    decision: row.decision,
    notes: row.notes ?? undefined,
    rejectionReasons: row.rejection_reasons ?? [],
    reviewer: row.reviewer,
    createdAt: row.created_at
  };
}

function toApprovedAsset(asset: AssetLibraryAsset): ApprovedAssetLibraryAsset {
  return {
    id: asset.id,
    vertical: asset.vertical,
    category: asset.category,
    intendedUses: asset.intendedUses,
    tags: asset.tags,
    publicUrl: asset.publicUrl,
    promptMetadata: asset.promptMetadata,
    approvedStoragePaths: asset.approvedStoragePaths
  };
}

function isAllowedReviewTransition(current: AssetLibraryStatus, decision: AssetLibraryReviewDecision) {
  if (current === "candidate") return decision === "approved" || decision === "rejected" || decision === "needs_edit" || decision === "archived";
  if (current === "needs_edit") return decision === "approved" || decision === "rejected" || decision === "archived";
  if (current === "approved") return decision === "archived";
  if (current === "rejected") return decision === "archived";
  return false;
}

function assetLibrarySafeClassificationTags(tags: string[]): AssetLibrarySafeClassificationTag[] {
  return cleanTokenList(tags).filter((tag): tag is AssetLibrarySafeClassificationTag =>
    (ASSET_LIBRARY_SAFE_CLASSIFICATION_TAGS as readonly string[]).includes(tag)
  );
}

function replaceAssetLibraryPolicyFailTags(tags: string[], policyFailureTags: AssetLibraryPolicyFailTag[]) {
  return cleanTokenList([...tags.filter((tag) => !isAssetLibraryPolicyFailTag(tag)), ...policyFailureTags]);
}

function mergeBackfilledAssetLibraryTags(currentTags: string[], prompt: AssetLibraryPromptRecord) {
  return cleanTokenList([
    ...currentTags.filter((tag) => !isAssetLibraryDerivedTaxonomyTag(tag)),
    ...prompt.tags,
    ...derivedAssetLibraryTaxonomyTags(prompt)
  ]);
}

function assertProtectedPolicyTagsUnchanged(currentTags: string[], nextTags: string[]) {
  const currentProtected = protectedPolicyTagSignature(currentTags);
  const nextProtected = protectedPolicyTagSignature(nextTags);
  if (currentProtected !== nextProtected) {
    throw new Error("Asset library policy and derived taxonomy tags can only be changed through review or taxonomy backfill actions.");
  }
}

function protectedPolicyTagSignature(tags: string[]) {
  return tokenListSignature(cleanTokenList(tags).filter(isAssetLibraryProtectedPolicyTag));
}

function tokenListSignature(values: string[]) {
  return cleanTokenList(values)
    .sort()
    .join(",");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cleanTokenList(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => safeSegment(value))
        .filter(Boolean)
        .slice(0, 24)
    )
  );
}

function rankLibraryAssets(assets: ApprovedAssetLibraryAsset[], terms: Set<string>, catalogSlugs: Set<string>) {
  return assets
    .map((asset, index) => ({
      asset,
      index,
      score: assetMatchesTerms(asset, terms, catalogSlugs) ? libraryAssetTermScore(asset, terms, catalogSlugs) : 0
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.asset);
}

function assetMatchesTerms(asset: ApprovedAssetLibraryAsset, terms: Set<string>, catalogSlugs: Set<string>) {
  return libraryAssetTermScore(asset, terms, catalogSlugs) > 0;
}

function libraryAssetTermScore(asset: ApprovedAssetLibraryAsset, terms: Set<string>, catalogSlugs: Set<string>) {
  const taxonomy = assetLibraryTaxonomyTerms(asset).join(" ");
  const haystack = `${asset.category} ${asset.tags.join(" ")} ${asset.promptMetadata.title} ${asset.promptMetadata.notes} ${taxonomy}`.toLowerCase();
  let score = 0;
  for (const slug of catalogSlugs) {
    if (assetCatalogSlugs(asset).has(slug)) score += 12;
  }
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length >= 5 ? 4 : 2;
  }
  return score;
}

export function isAssetLibraryAssetAllowedForBusiness(
  asset: ApprovedAssetLibraryAsset,
  business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">
) {
  const family = assetImageFamily(asset);
  if (!family) return false;
  if (business.vertical === "auto_services") {
    if (asset.vertical !== "auto_services") return false;
    if (family === "collision_body" || family === "paint_refinish") return false;
    if (isGlassOnlyAutoServicesBusiness(business)) return family === "auto_glass" || family === "detail_texture";
    return true;
  }
  if (business.vertical === "auto_body") {
    if (asset.promptMetadata?.compositionTemplate === "wide_environment") return false;
    if (asset.vertical === "auto_body") {
      if (family === "detail_texture" || family === "collision_body" || family === "paint_refinish") return true;
      return family === "auto_glass" && businessHasGlassFitV1(business);
    }
    if (asset.vertical === "auto_services") {
      if (family === "detail_texture") return true;
      return family === "auto_glass" && businessHasGlassFitV1(business);
    }
    return false;
  }
  return asset.vertical === business.vertical;
}

function businessHasGlassFitV1(business: Pick<BusinessProfile, "name" | "categories" | "services">) {
  return /\b(glass|windshield|window)\b/i.test([business.name, ...business.categories, ...business.services].join(" "));
}

function assetImageFamily(asset: ApprovedAssetLibraryAsset): string | undefined {
  const metadataFamily = asset.promptMetadata?.imageFamily;
  if (metadataFamily) return metadataFamily;
  const familyTag = asset.tags.find((tag) => tag.startsWith("family_"));
  if (familyTag) return familyTag.replace(/^family_/, "");
  return legacyImageFamilyForCategory(asset.category);
}

function legacyImageFamilyForCategory(category: string): AssetLibraryImageFamily | undefined {
  switch (category) {
    case "tires":
      return "tires_wheels";
    case "brakes":
      return "brakes";
    case "oil_change":
      return "oil_maintenance";
    case "diagnostics":
      return "battery_diagnostics";
    case "alignment":
      return "alignment_suspension";
    case "auto_glass":
      return "auto_glass";
    case "detail_texture":
      return "detail_texture";
    case "shop_environment":
    case "general_repair":
      return "shop_environment";
    default:
      return undefined;
  }
}

function assetCatalogSlugs(asset: ApprovedAssetLibraryAsset) {
  return new Set([
    ...(asset.promptMetadata?.catalogServiceSlugs ?? []),
    ...asset.tags.filter((tag) => tag.startsWith("catalog_")).map((tag) => tag.replace(/^catalog_/, ""))
  ]);
}

function assetLibraryTaxonomyTerms(asset: ApprovedAssetLibraryAsset) {
  return cleanTokenList([
    asset.promptMetadata?.imageFamily,
    ...(asset.promptMetadata?.imageSubjects ?? []),
    ...(asset.promptMetadata?.serviceHints ?? []),
    ...(asset.promptMetadata?.catalogServiceSlugs ?? []),
    asset.promptMetadata?.compositionTemplate,
    asset.promptMetadata?.sceneFamily,
    asset.promptMetadata?.heroClearSide,
    ...asset.tags
      .filter(isAssetLibraryDerivedTaxonomyTag)
      .map(stripDerivedTagPrefix)
  ].filter((value): value is string => Boolean(value)));
}

function businessCatalogServiceSlugs(business: Pick<BusinessProfile, "vertical" | "categories" | "services">) {
  const slugs = new Set<string>();
  for (const value of [...business.categories, ...business.services]) {
    const definition = matchServiceDefinition(business.vertical, value);
    if (definition) slugs.add(definition.slug);
  }
  return slugs;
}

function isGlassOnlyAutoServicesBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">) {
  if (business.vertical !== "auto_services") return false;
  const terms = serviceTerms(business);
  const hasGlass = ["glass", "windshield", "chip", "window"].some((term) => terms.has(term));
  if (!hasGlass) return false;
  const hasMechanical = ["tire", "wheel", "brake", "oil", "align", "alignment", "battery", "tpms", "mechanic", "repair"].some((term) => terms.has(term));
  return !hasMechanical;
}

function serviceTerms(business: Pick<BusinessProfile, "name" | "categories" | "services">) {
  const stopTerms = new Set(["auto", "service", "services", "shop", "repair", "local", "business", "and", "the"]);
  return new Set(
    [business.name, ...business.categories, ...business.services]
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
      .map((term) => (term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term))
      .filter((term) => term.length >= 3 && !stopTerms.has(term))
  );
}

function assetLibraryPricePerImageUsd() {
  const value = Number(process.env.LODESTA_ASSET_LIBRARY_IMAGE_ESTIMATE_USD);
  return Number.isFinite(value) && value > 0 ? value : 0.08;
}

function positiveInt(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120) || "asset"
  );
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function extractImageBase64(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const first = payload.data.find(isRecord);
  return first && typeof first.b64_json === "string" ? first.b64_json : undefined;
}

function openAiErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  return typeof payload.error.message === "string" ? payload.error.message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function requireData<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  context: string
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${context}: ${error.message}`);
  if (data === null) throw new Error(`${context}: no data returned`);
  return data;
}

async function requireMaybe<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  context: string
): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}

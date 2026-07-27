import { z } from "zod";
import { configuredAppOrigin } from "./app-origin";
import { isSupportedSiteAgentModel, siteAgentModelPricing } from "@/packages/site-agent/run-policy";
import { isEstablishedOpenRouterAuthoringRoute } from "@/packages/site-agent/provider-routes";

export type ModelCatalogProvider = "openai" | "openrouter";
export type SiteAgentModelAvailability = "selectable" | "pricing_unconfigured" | "capabilities_missing";

export type ModelCatalogOption = {
  id: string;
  name: string;
  ownedBy?: string;
  createdAt?: string;
  contextLength?: number;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  siteAgentAvailability: SiteAgentModelAvailability;
};

export type ModelCatalog = {
  provider: ModelCatalogProvider;
  models: ModelCatalogOption[];
  fetchedAt: string;
};

const cacheTtlMs = 5 * 60_000;
const modelIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._~:/-]+$/);
const openAiCatalogSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    created: z.number().finite().optional(),
    owned_by: z.string().optional()
  }).passthrough())
}).passthrough();
const openRouterCatalogSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    created: z.number().finite().optional(),
    context_length: z.number().int().positive().optional().nullable(),
    pricing: z.object({
      prompt: z.string().optional(),
      completion: z.string().optional()
    }).passthrough().optional(),
    supported_parameters: z.array(z.string()).optional()
  }).passthrough())
}).passthrough();

const modelCatalogCache = globalThis as typeof globalThis & {
  __lodestaModelCatalogs?: Partial<Record<ModelCatalogProvider, { value: ModelCatalog; cachedAt: number }>>;
};

export class ModelCatalogConfigurationError extends Error {
  constructor(public readonly provider: ModelCatalogProvider) {
    super(`${provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"} is not configured.`);
    this.name = "ModelCatalogConfigurationError";
  }
}

export async function getModelCatalog(
  provider: ModelCatalogProvider,
  options: { bypassCache?: boolean } = {}
): Promise<ModelCatalog> {
  const cached = modelCatalogCache.__lodestaModelCatalogs?.[provider];
  if (!options.bypassCache && cached && Date.now() - cached.cachedAt <= cacheTtlMs) return cached.value;

  const apiKey = (provider === "openai" ? process.env.OPENAI_API_KEY : process.env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) throw new ModelCatalogConfigurationError(provider);

  const response = await fetch(modelCatalogUrl(provider), {
    cache: "no-store",
    headers: modelCatalogHeaders(provider, apiKey),
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    throw new Error(`${provider}_model_catalog_request_failed:${response.status}`);
  }

  const payload = await response.json();
  const models = provider === "openai"
    ? normalizeOpenAiModelCatalog(payload)
    : normalizeOpenRouterModelCatalog(payload);
  const value = { provider, models, fetchedAt: new Date().toISOString() };
  modelCatalogCache.__lodestaModelCatalogs = {
    ...(modelCatalogCache.__lodestaModelCatalogs ?? {}),
    [provider]: { value, cachedAt: Date.now() }
  };
  return value;
}

export function normalizeOpenAiModelCatalog(payload: unknown): ModelCatalogOption[] {
  const parsed = openAiCatalogSchema.parse(payload);
  return parsed.data.flatMap((model) => {
    const id = modelIdSchema.safeParse(model.id);
    if (!id.success) return [];
    const pricing = isSupportedSiteAgentModel(id.data) ? siteAgentModelPricing[id.data] : undefined;
    const siteAgentAvailability: SiteAgentModelAvailability = pricing ? "selectable" : "pricing_unconfigured";
    return [{
      id: id.data,
      name: id.data,
      ownedBy: model.owned_by,
      createdAt: unixTimestamp(model.created),
      inputUsdPerMillion: pricing?.inputUsdPerMillion,
      outputUsdPerMillion: pricing?.outputUsdPerMillion,
      siteAgentAvailability
    }];
  }).sort(compareModels);
}

export function normalizeOpenRouterModelCatalog(payload: unknown): ModelCatalogOption[] {
  const parsed = openRouterCatalogSchema.parse(payload);
  return parsed.data.flatMap((model) => {
    const id = modelIdSchema.safeParse(model.id);
    if (!id.success) return [];
    const supportedParameters = new Set(model.supported_parameters ?? []);
    const siteAgentAvailability: SiteAgentModelAvailability = isEstablishedOpenRouterAuthoringRoute(id.data)
      && ["tools", "tool_choice", "reasoning", "structured_outputs"]
        .every((parameter) => supportedParameters.has(parameter))
      ? "selectable"
      : "capabilities_missing";
    return [{
      id: id.data,
      name: model.name?.trim() || id.data,
      createdAt: unixTimestamp(model.created),
      contextLength: model.context_length ?? undefined,
      inputUsdPerMillion: perMillion(model.pricing?.prompt),
      outputUsdPerMillion: perMillion(model.pricing?.completion),
      siteAgentAvailability
    }];
  }).sort(compareModels);
}

function modelCatalogUrl(provider: ModelCatalogProvider) {
  return provider === "openai"
    ? "https://api.openai.com/v1/models"
    : "https://openrouter.ai/api/v1/models/user?output_modalities=text";
}

function modelCatalogHeaders(provider: ModelCatalogProvider, apiKey: string) {
  if (provider === "openai") return { Authorization: `Bearer ${apiKey}` };
  const origin = configuredAppOrigin();
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(origin ? { "HTTP-Referer": origin } : {}),
    "X-OpenRouter-Title": "Lodesta"
  };
}

function unixTimestamp(value: number | undefined) {
  if (value === undefined) return undefined;
  const timestamp = new Date(value * 1000);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function perMillion(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : undefined;
}

function compareModels(left: ModelCatalogOption, right: ModelCatalogOption) {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    || left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: "base" });
}

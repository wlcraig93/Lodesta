import {
  getModelCatalog,
  type ModelCatalogOption
} from "@/lib/model-catalog";
import {
  isSiteCreationModelId,
  SITE_CREATION_API_PROVIDER,
  type SiteCreationModelCatalog,
  type SiteCreationModelOption
} from "@/lib/site-creation-models";

export async function getSiteCreationModelCatalog(): Promise<SiteCreationModelCatalog> {
  const catalog = await getModelCatalog(SITE_CREATION_API_PROVIDER);
  return {
    provider: SITE_CREATION_API_PROVIDER,
    models: catalog.models
      .filter((model) =>
        model.siteAgentAvailability === "selectable"
        && isSiteCreationModelId(model.id)
        && !model.id.startsWith("openrouter/")
      )
      .map(publicModelOption),
    fetchedAt: catalog.fetchedAt
  };
}

export async function isSelectableSiteCreationModel(modelId: string) {
  const catalog = await getSiteCreationModelCatalog();
  return catalog.models.some((model) => model.id === modelId);
}

function publicModelOption(model: ModelCatalogOption): SiteCreationModelOption {
  return {
    id: model.id,
    name: model.name,
    contextLength: model.contextLength,
    inputUsdPerMillion: model.inputUsdPerMillion,
    outputUsdPerMillion: model.outputUsdPerMillion
  };
}

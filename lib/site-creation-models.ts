export const SITE_CREATION_API_PROVIDER = "openrouter" as const;

export type SiteCreationModelOption = {
  id: string;
  name: string;
  contextLength?: number;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
};

export type SiteCreationModelCatalog = {
  provider: typeof SITE_CREATION_API_PROVIDER;
  models: SiteCreationModelOption[];
  fetchedAt: string;
};

const openRouterModelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._~-]*\/[A-Za-z0-9._~:/-]+$/;

export function isSiteCreationModelId(value: string): boolean {
  return value.length >= 3
    && value.length <= 120
    && openRouterModelIdPattern.test(value);
}

export function siteCreationModelLabel(value: string) {
  return value;
}

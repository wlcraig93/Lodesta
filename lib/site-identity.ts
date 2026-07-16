import type { SiteBundle } from "./models";

export function makeUniqueSlug(baseSlug: string, existingSlugs: Iterable<string>) {
  const cleanBase = normalizeSlug(baseSlug) || `site-${Date.now()}`;
  const existing = new Set(Array.from(existingSlugs).map(normalizeSlug));
  if (!existing.has(cleanBase)) return cleanBase;

  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${cleanBase.slice(0, 80 - suffixText.length)}${suffixText}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${cleanBase}-${crypto.randomUUID().slice(0, 8)}`;
}

export function applySiteIdentity(bundle: SiteBundle, slug: string) {
  const normalizedSlug = normalizeSlug(slug) || `site-${crypto.randomUUID().slice(0, 8)}`;
  const previousSiteId = bundle.businessProfile.siteId;
  const siteId = `site_${normalizedSlug}`;
  const identityKey = normalizeSlug(siteId) || normalizedSlug;

  bundle.businessProfile.siteId = siteId;
  bundle.businessProfile.id = `bp_${identityKey}`;
  bundle.businessProfile.photos = bundle.businessProfile.photos.map((asset, index) => ({
    ...asset,
    id: scopedId(siteId, rewriteSiteToken(asset.id, previousSiteId, siteId), `photo_${index + 1}`)
  }));
  if (bundle.businessProfile.logo) {
    bundle.businessProfile.logo = {
      ...bundle.businessProfile.logo,
      id: scopedId(siteId, rewriteSiteToken(bundle.businessProfile.logo.id, previousSiteId, siteId), "logo")
    };
  }
  bundle.siteModel.id = siteId;
  bundle.siteModel.slug = normalizedSlug;
  bundle.presenceAssessment.siteId = siteId;
  if (bundle.presenceAssessment.standardEvaluation) {
    bundle.presenceAssessment.standardEvaluation.siteId = siteId;
  }
  if (bundle.presenceAssessment.renderInspection) {
    bundle.presenceAssessment.renderInspection.siteId = siteId;
  }
  bundle.presenceAssessment.publicPresenceSignals = bundle.presenceAssessment.publicPresenceSignals?.map((signal) => ({
    ...signal,
    siteId
  }));
  bundle.presenceAssessment.assetInventory = bundle.presenceAssessment.assetInventory?.map((asset, index) => ({
    ...asset,
    id: scopedId(siteId, rewriteSiteToken(asset.id, previousSiteId, siteId), `${asset.kind}_${index + 1}`),
    siteId,
    metadata: rewriteAssetMetadata(asset.metadata, previousSiteId, siteId)
  }));

  bundle.siteModel.versions = bundle.siteModel.versions.map((version, index) => ({
    ...version,
    id: `version_${identityKey}_${version.status}_${index + 1}`
  }));

  bundle.extensionModel.forms = bundle.extensionModel.forms.map((form) => ({
    ...form,
    siteId
  }));

  bundle.experiments = bundle.experiments.map((experiment) => ({
    ...experiment,
    id: experiment.id.includes(previousSiteId)
      ? experiment.id.replace(previousSiteId, siteId)
      : `${experiment.id}_${siteId}`
  }));

  return bundle;
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function scopedId(siteId: string, id: string | undefined, fallbackSuffix: string) {
  const suffix = normalizeIdentifier(id || fallbackSuffix) || normalizeIdentifier(fallbackSuffix) || crypto.randomUUID().slice(0, 8);
  if (suffix === siteId || suffix.startsWith(`${siteId}_`)) return suffix;
  return `${siteId}_${suffix}`;
}

function rewriteSiteToken(value: string, previousSiteId: string, nextSiteId: string) {
  return value.includes(previousSiteId) ? value.replaceAll(previousSiteId, nextSiteId) : value;
}

function rewriteAssetMetadata(
  metadata: Record<string, unknown> | undefined,
  previousSiteId: string,
  nextSiteId: string
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  return {
    ...metadata,
    referenceAssetId: typeof metadata.referenceAssetId === "string"
      ? rewriteSiteToken(metadata.referenceAssetId, previousSiteId, nextSiteId)
      : metadata.referenceAssetId
  };
}

function normalizeIdentifier(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

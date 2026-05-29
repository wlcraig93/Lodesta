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

  bundle.businessProfile.siteId = siteId;
  bundle.businessProfile.id = `bp_${normalizedSlug}`;
  bundle.siteModel.id = siteId;
  bundle.siteModel.slug = normalizedSlug;
  bundle.presenceAssessment.siteId = siteId;
  if (bundle.presenceAssessment.standardEvaluation) {
    bundle.presenceAssessment.standardEvaluation.siteId = siteId;
  }

  bundle.siteModel.versions = bundle.siteModel.versions.map((version, index) => ({
    ...version,
    id: `version_${normalizedSlug}_${version.status}_${index + 1}`
  }));

  bundle.extensionModel.forms = bundle.extensionModel.forms.map((form) => ({
    ...form,
    siteId
  }));

  bundle.optimizationFindings = bundle.optimizationFindings.map((finding) => ({
    ...finding,
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

import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import type { PageCompositionV3, SiteBundle, SiteModel, SiteVersion, SiteVersionV3 } from "./models";

export type PageV3 = PageCompositionV3["pages"][number];

export function isSiteVersionV3(version: SiteVersion | undefined | null): version is SiteVersionV3 {
  return Boolean(version && version.rendererVersion === "layout-v3" && "pageComposition" in version);
}

// Soft check for admin surfaces: returns a human-readable schema issue, or
// null when the stored version is valid layout-v3. Stale rows predating a
// schema change should surface as a "regenerate this candidate" notice in
// operator UI instead of a crashed page; boundary-sensitive surfaces keep
// the throwing assert below.
export function siteVersionV3Issue(version: SiteVersion | undefined | null): string | null {
  if (!version) return "version is missing";
  if (!isSiteVersionV3(version)) {
    return `rendererVersion is ${version.rendererVersion ?? "missing"}; expected layout-v3`;
  }
  if ("pages" in version) return "legacy SiteVersionV3.pages projection is still present";
  return null;
}

export function assertSiteVersionV3(version: SiteVersion | undefined | null, context = "site version"): SiteVersionV3 {
  const issue = siteVersionV3Issue(version);
  if (issue) throw new Error(`${context}: ${issue}.`);
  return version as SiteVersionV3;
}

export function assertBundleVersionsV3(bundle: SiteBundle, context = "site bundle"): SiteBundle {
  for (const version of bundle.siteModel.versions) {
    assertSiteVersionV3(version, `${context} version ${version.id}`);
  }
  return bundle;
}

export function activeSiteVersionV3(siteModel: SiteModel, context = "site model"): SiteVersionV3 {
  return assertSiteVersionV3(siteModel.versions[0], `${context} active version`);
}

export function draftSiteVersionV3(siteModel: SiteModel, context = "site model"): SiteVersionV3 | undefined {
  const draft = siteModel.versions.find((version) => version.status === "draft");
  return draft ? assertSiteVersionV3(draft, `${context} draft version`) : undefined;
}

export function pagesForVersionV3(version: SiteVersionV3): PageV3[] {
  return version.pageComposition.pages;
}

export function findPageBySlugV3(version: SiteVersionV3, slug = ""): PageV3 | undefined {
  const normalized = slug.replace(/^\/+|\/+$/g, "");
  return version.pageComposition.pages.find((page) => page.slug === normalized);
}

export function findPageByIdV3(version: SiteVersionV3, pageId: string): PageV3 | undefined {
  return version.pageComposition.pages.find((page) => page.id === pageId);
}

export function pageCountForVersionV3(version: SiteVersionV3): number {
  return version.pageComposition.pages.length;
}

export function firstPageTitleForVersionV3(version: SiteVersionV3): string {
  const page = version.pageComposition.pages[0];
  return page?.seo.title ?? page?.title ?? "Untitled";
}

export function validateVisualSectionsForVersionV3(version: SiteVersionV3): string[] {
  const issues: string[] = [];
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      if (!getVisualSectionV3(section.props)) issues.push(`${page.id}:${section.id}`);
    }
  }
  return issues;
}

export function assertVisualSectionsForVersionV3(version: SiteVersionV3): SiteVersionV3 {
  const missing = validateVisualSectionsForVersionV3(version);
  if (missing.length) {
    throw new Error(`layout-v3 version ${version.id} has sections without visualSectionV3: ${missing.join(", ")}`);
  }
  return version;
}

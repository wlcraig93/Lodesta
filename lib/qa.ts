import type { QACheck, SiteBundle } from "./models";
import { getPublishedVersion } from "./sample-data";
import { evaluateSiteAgainstStandard } from "./standard-evaluation";

export function runSiteQa(bundle: SiteBundle, options: { versionId?: string; versionStatus?: "draft" | "published" } = {}) {
  const version =
    options.versionId
      ? bundle.siteModel.versions.find((item) => item.id === options.versionId) ?? getPublishedVersion(bundle.siteModel)
      : options.versionStatus === "draft"
      ? bundle.siteModel.versions.find((item) => item.status === "draft") ?? getPublishedVersion(bundle.siteModel)
      : getPublishedVersion(bundle.siteModel);
  const checks: QACheck[] = [];
  const targetIds = targetIdsForVersion(version);
  const allCtas: Array<{ pageId: string; sectionId: string; key: string; label?: string; href?: string }> = [];
  const activeTheme = version.theme ?? bundle.siteModel.theme;

  for (const page of version.pages) {
    addCheck(checks, {
      id: `meta_title_${page.id}`,
      siteId: bundle.businessProfile.siteId,
      category: "seo",
      severity: page.seo.title.length >= 25 ? "pass" : "fail",
      title: `SEO title on ${page.title}`,
      detail: page.seo.title.length >= 25 ? "Title has enough context for search snippets." : "Title is too short for a useful search snippet.",
      pageId: page.id
    });

    addCheck(checks, {
      id: `meta_description_${page.id}`,
      siteId: bundle.businessProfile.siteId,
      category: "seo",
      severity: page.seo.description.length >= 80 ? "pass" : "warning",
      title: `Meta description on ${page.title}`,
      detail: page.seo.description.length >= 80 ? "Description is descriptive enough for the launch baseline." : "Description should be expanded before publish.",
      pageId: page.id
    });

    addCheck(checks, {
      id: `thin_content_${page.id}`,
      siteId: bundle.businessProfile.siteId,
      category: "content",
      severity: pageHasEnoughContent(page) ? "pass" : "warning",
      title: `Content depth on ${page.title}`,
      detail: pageHasEnoughContent(page)
        ? "Page has enough structured text and sections for the launch baseline."
        : "Page is thin; add owner-verified service, proof, or FAQ detail before relying on it for SEO.",
      pageId: page.id
    });

    for (const section of page.sections) {
      for (const [key, value] of Object.entries(section.props)) {
        if (key.toLowerCase().includes("cta")) {
          const cta = value as { label?: string; href?: string };
          allCtas.push({ pageId: page.id, sectionId: section.id, key, label: cta?.label, href: cta?.href });
          const hrefValidation = validateHref(cta?.href, targetIds);
          addCheck(checks, {
            id: `cta_${page.id}_${section.id}_${key}`,
            siteId: bundle.businessProfile.siteId,
            category: "conversion",
            severity: cta?.label?.trim() && cta?.href?.trim() && hrefValidation.ok ? "pass" : "fail",
            title: `CTA ${key} in ${section.type}`,
            detail:
              cta?.label?.trim() && cta?.href?.trim() && hrefValidation.ok
                ? "CTA has visible text and a valid destination."
                : hrefValidation.reason ?? "CTA is missing visible text or destination.",
            pageId: page.id,
            sectionId: section.id
          });
        }
      }

      for (const link of collectLinks(section.props)) {
        const hrefValidation = validateHref(link.href, targetIds);
        addCheck(checks, {
          id: `link_${page.id}_${section.id}_${slugId(link.path)}`,
          siteId: bundle.businessProfile.siteId,
          category: "technical",
          severity: hrefValidation.ok ? "pass" : "fail",
          title: `Link ${link.path} in ${section.type}`,
          detail: hrefValidation.ok
            ? "Link has a valid destination."
            : hrefValidation.reason ?? "Link destination is invalid.",
          pageId: page.id,
          sectionId: section.id
        });
      }
    }
  }

  const duplicateSlugs = duplicateValues(version.pages.map((page) => page.slug));
  addCheck(checks, {
    id: "unique_page_slugs",
    siteId: bundle.businessProfile.siteId,
    category: "seo",
    severity: duplicateSlugs.length === 0 ? "pass" : "fail",
    title: "Unique page slugs",
    detail: duplicateSlugs.length === 0 ? "All page slugs are unique." : `Duplicate slugs detected: ${duplicateSlugs.join(", ")}.`
  });

  const homePage = version.pages.find((page) => page.slug === "") ?? version.pages[0];
  const homeHero = homePage?.sections.find((section) => section.type === "hero");
  const heroPrimaryCta = ctaLike(homeHero?.props.primaryCta);
  const heroPrimaryCtaHref = validateHref(heroPrimaryCta.href, targetIds);
  const heroPrimaryCtaValid = Boolean(heroPrimaryCta.label?.trim() && heroPrimaryCta.href?.trim() && heroPrimaryCtaHref.ok);
  addCheck(checks, {
    id: "primary_cta_guardrail",
    siteId: bundle.businessProfile.siteId,
    category: "conversion",
    severity: heroPrimaryCtaValid ? "pass" : "fail",
    title: "Primary CTA guardrail",
    detail: heroPrimaryCtaValid
      ? "The home hero keeps a primary CTA above the fold."
      : heroPrimaryCtaHref.reason ?? "The home hero is missing a valid primary CTA; this blocks publish.",
    pageId: homePage?.id,
    sectionId: homeHero?.id
  });

  addCheck(checks, {
    id: "cta_presence",
    siteId: bundle.businessProfile.siteId,
    category: "conversion",
    severity: allCtas.length > 0 ? "pass" : "fail",
    title: "At least one conversion action",
    detail: allCtas.length > 0 ? `${allCtas.length} CTA slots exist.` : "No CTA slots exist in the structured site model."
  });

  const hasContactSection = version.pages.some((page) => page.sections.some((section) => section.type === "contact"));
  addCheck(checks, {
    id: "contact_path",
    siteId: bundle.businessProfile.siteId,
    category: "conversion",
    severity: hasContactSection ? "pass" : "fail",
    title: "Contact path",
    detail: hasContactSection ? "At least one contact section exists." : "No contact section exists.",
  });

  const hasForm = bundle.extensionModel.forms.length > 0;
  addCheck(checks, {
    id: "lead_form",
    siteId: bundle.businessProfile.siteId,
    category: "forms",
    severity: hasForm ? "pass" : "warning",
    title: "Lead form configured",
    detail: hasForm ? "At least one lead form is configured." : "No lead forms are configured.",
  });

  const hasPhonePath = Boolean(bundle.businessProfile.phone);
  addCheck(checks, {
    id: "phone_path",
    siteId: bundle.businessProfile.siteId,
    category: "conversion",
    severity: hasPhonePath ? "pass" : "fail",
    title: "Phone path",
    detail: hasPhonePath ? "Business phone is available for click-to-call surfaces." : "Business phone is missing.",
  });

  const hasLocation = Boolean(
    bundle.businessProfile.address?.street ||
      bundle.businessProfile.address?.city ||
      bundle.businessProfile.serviceAreas.some((area) => !/^local area$/i.test(area))
  );
  addCheck(checks, {
    id: "local_nap_location",
    siteId: bundle.businessProfile.siteId,
    category: "seo",
    severity: bundle.businessProfile.name && hasPhonePath && hasLocation ? "pass" : "fail",
    title: "Name, phone, and location signal",
    detail:
      bundle.businessProfile.name && hasPhonePath && hasLocation
        ? "Business name, phone, and address or service area are present."
        : "Missing name, phone, or address/service-area signal."
  });

  const hasHours = Boolean(bundle.businessProfile.hours && Object.keys(bundle.businessProfile.hours).length > 0);
  addCheck(checks, {
    id: "hours_guardrail",
    siteId: bundle.businessProfile.siteId,
    category: "trust",
    severity: hasHours ? "pass" : "warning",
    title: "Hours are available",
    detail: hasHours ? "Business hours are available for visitors and schema." : "Hours are missing or unverified."
  });

  const hasMapOrAreaSection = version.pages.some((page) => page.sections.some((section) => section.type === "map"));
  addCheck(checks, {
    id: "map_or_service_area",
    siteId: bundle.businessProfile.siteId,
    category: "conversion",
    severity: hasMapOrAreaSection || hasLocation ? "pass" : "warning",
    title: "Map or service-area clarity",
    detail: hasMapOrAreaSection || hasLocation
      ? "Location or service-area clarity is present."
      : "Add a map or service-area section so local visitors know whether the business serves them."
  });

  for (const link of businessLinks(bundle)) {
    const hrefValidation = validateHref(link.href, targetIds);
    addCheck(checks, {
      id: `business_link_${slugId(link.path)}`,
      siteId: bundle.businessProfile.siteId,
      category: "technical",
      severity: hrefValidation.ok ? "pass" : "fail",
      title: `Business profile link ${link.path}`,
      detail: hrefValidation.ok ? "Business profile link has a valid destination." : hrefValidation.reason ?? "Link destination is invalid."
    });
  }

  const referenceAssetUse = referenceOnlyAssetUrlsUsedInSiteModel(bundle, version);
  addCheck(checks, {
    id: "preclaim_reference_asset_usage",
    siteId: bundle.businessProfile.siteId,
    category: "trust",
    severity: referenceAssetUse.length === 0 ? "pass" : "fail",
    title: "Reference-only assets stay out of rendered site",
    detail: referenceAssetUse.length === 0
      ? "Rendered sections use generated, licensed, placeholder, or owner-approved assets."
      : `Reference-only website assets are used in rendered sections: ${referenceAssetUse.join(", ")}.`
  });

  addCheck(checks, contrastCheck(bundle, "theme_text_contrast", "Text contrast", activeTheme.colors.text, activeTheme.colors.background));
  addCheck(
    checks,
    contrastCheck(
      bundle,
      "theme_surface_text_contrast",
      "Surface text contrast",
      activeTheme.colors.text,
      activeTheme.colors.surface
    )
  );
  addCheck(
    checks,
    contrastCheck(
      bundle,
      "theme_primary_button_contrast",
      "Primary button contrast",
      activeTheme.colors.primaryText,
      activeTheme.colors.primary
    )
  );

  for (const check of evaluateSiteAgainstStandard(bundle, {
    versionId: options.versionId,
    versionStatus: options.versionStatus
  }).checks) {
    addCheck(checks, {
      id: `standard_${slugId(check.criterionId)}`,
      siteId: bundle.businessProfile.siteId,
      standardCriterionId: check.criterionId,
      category: qaCategoryForStandard(check.criterionId, check.layer),
      severity: check.severity,
      title: `Standard: ${check.title}`,
      detail: check.passed ? check.evidence : `${check.evidence} ${check.businessConsequence}`
    });
  }

  return {
    siteId: bundle.businessProfile.siteId,
    versionId: version.id,
    passed: checks.every((check) => check.severity !== "fail"),
    checks
  };
}

function addCheck(checks: QACheck[], check: QACheck) {
  checks.push(check);
}

function qaCategoryForStandard(
  criterionId: string,
  layer: ReturnType<typeof evaluateSiteAgainstStandard>["checks"][number]["layer"]
): QACheck["category"] {
  if (criterionId.startsWith("seo.")) return "seo";
  if (criterionId.startsWith("accessibility.")) return "accessibility";
  if (layer === "conversion") return "conversion";
  if (layer === "trust") return "trust";
  if (layer === "content_structure") return "content";
  return "technical";
}

function targetIdsForVersion(version: SiteBundle["siteModel"]["versions"][number]) {
  const ids = new Set(["contact"]);
  for (const page of version.pages) {
    ids.add(page.id);
    for (const section of page.sections) {
      ids.add(section.id);
      if (section.type === "contact") ids.add("contact");
    }
  }
  return ids;
}

function validateHref(href: string | undefined, targetIds: Set<string>) {
  const value = href?.trim();
  if (!value) return { ok: false, reason: "CTA is missing a destination." };
  if (value.startsWith("#")) {
    const target = value.slice(1);
    return target && targetIds.has(target)
      ? { ok: true }
      : { ok: false, reason: `CTA points to missing in-page target ${value}.` };
  }
  if (/^(tel|mailto):/i.test(value)) return { ok: value.length > value.indexOf(":") + 1, reason: "CTA protocol link is blank." };
  if (value.startsWith("/")) return { ok: true };
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? { ok: true }
      : { ok: false, reason: `Unsupported CTA protocol ${url.protocol}.` };
  } catch {
    return { ok: false, reason: `CTA destination is not a valid URL or route: ${value}.` };
  }
}

function collectLinks(value: unknown, path: string[] = []): Array<{ path: string; href: string | undefined }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectLinks(item, [...path, String(index + 1)]));
  }
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const links: Array<{ path: string; href: string | undefined }> = [];
  if ("href" in record) {
    links.push({
      path: humanPath(path.length ? path : ["href"]),
      href: typeof record.href === "string" ? record.href : undefined
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === "href") continue;
    links.push(...collectLinks(child, [...path, key]));
  }
  return links;
}

function businessLinks(bundle: SiteBundle) {
  const links: Array<{ path: string; href: string }> = [];
  for (const [group, values] of [
    ["social", bundle.businessProfile.socialLinks],
    ["booking", bundle.businessProfile.bookingLinks],
    ["ordering", bundle.businessProfile.orderingLinks],
    ["press", bundle.businessProfile.pressLinks]
  ] as const) {
    values.forEach((href, index) => links.push({ path: `${group} ${index + 1}`, href }));
  }
  return links;
}

function referenceOnlyAssetUrlsUsedInSiteModel(
  bundle: SiteBundle,
  version: SiteBundle["siteModel"]["versions"][number]
) {
  const allowedUrls = new Set<string>();
  const referenceUrls = new Set<string>();

  for (const asset of bundle.presenceAssessment.assetInventory ?? []) {
    if (!asset.url) continue;
    const publicUsage = asset.usageScope === "published_site" || asset.usageScope === "preclaim_preview";
    if (publicUsage && (asset.ownerApproved || asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe")) {
      allowedUrls.add(asset.url);
    }
    if (
      asset.source === "website_reference" ||
      asset.rightsStatus === "reference_only" ||
      asset.usageScope === "reference_only" ||
      asset.usageScope === "internal_planning"
    ) {
      referenceUrls.add(asset.url);
    }
  }

  for (const asset of [...bundle.businessProfile.photos, bundle.businessProfile.logo].filter(Boolean)) {
    if (!asset?.url) continue;
    if (asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe") allowedUrls.add(asset.url);
    if (asset.source === "website_reference" || asset.rightsStatus === "reference_only") referenceUrls.add(asset.url);
  }

  const forbidden = new Set([...referenceUrls].filter((url) => !allowedUrls.has(url)));
  if (forbidden.size === 0) return [];

  const used = new Set<string>();
  for (const page of version.pages) {
    for (const section of page.sections) {
      for (const url of collectUrlStrings(section.props)) {
        if (forbidden.has(url)) used.add(url);
      }
    }
  }
  return [...used].sort();
}

function collectUrlStrings(value: unknown): string[] {
  if (typeof value === "string") return /^https?:\/\//i.test(value) || value.startsWith("/api/assets/") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectUrlStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectUrlStrings);
  return [];
}

function humanPath(path: string[]) {
  return path
    .map((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "))
    .join(" ")
    .trim();
}

function slugId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "link";
}

function ctaLike(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return {
    label: "label" in value ? String(value.label ?? "") : undefined,
    href: "href" in value ? String(value.href ?? "") : undefined
  };
}

function pageHasEnoughContent(page: SiteBundle["siteModel"]["versions"][number]["pages"][number]) {
  if (page.sections.length < 2) return false;
  if (!page.slug.startsWith("services/") && !page.slug.startsWith("areas/")) return true;
  return pageText(page).length >= 240 && page.sections.length >= 3;
}

function pageText(page: SiteBundle["siteModel"]["versions"][number]["pages"][number]) {
  return page.sections
    .flatMap((section) => textValues(section.props))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(textValues);
  return [];
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value || "/");
    seen.add(value);
  }
  return Array.from(duplicates);
}

function contrastCheck(bundle: SiteBundle, id: string, title: string, foreground: string, background: string): QACheck {
  const ratio = contrastRatio(foreground, background);
  const ratioLabel = ratio ? ratio.toFixed(2) : "unknown";
  return {
    id,
    siteId: bundle.businessProfile.siteId,
    category: "accessibility",
    severity: ratio && ratio >= 4.5 ? "pass" : "fail",
    title,
    detail: ratio
      ? `Contrast ratio is ${ratioLabel}:1. Launch guardrail requires at least 4.5:1.`
      : `Could not parse theme colors ${foreground} on ${background}.`
  };
}

function contrastRatio(foreground: string, background: string) {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return undefined;
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHexColor(value: string) {
  const match = value.trim().match(/^#([a-f0-9]{3}|[a-f0-9]{6})$/i);
  if (!match) return undefined;
  const hex = match[1].length === 3
    ? match[1].split("").map((character) => `${character}${character}`).join("")
    : match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255
  };
}

function relativeLuminance(color: { r: number; g: number; b: number }) {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

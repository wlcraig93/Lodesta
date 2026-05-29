import type { QACheck, SiteBundle } from "./models";
import { getPublishedVersion } from "./sample-data";

export function runSiteQa(bundle: SiteBundle, options: { versionStatus?: "draft" | "published" } = {}) {
  const version =
    options.versionStatus === "draft"
      ? bundle.siteModel.versions.find((item) => item.status === "draft") ?? getPublishedVersion(bundle.siteModel)
      : getPublishedVersion(bundle.siteModel);
  const checks: QACheck[] = [];

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

    for (const section of page.sections) {
      for (const [key, value] of Object.entries(section.props)) {
        if (key.toLowerCase().includes("cta")) {
          const cta = value as { label?: string; href?: string };
          addCheck(checks, {
            id: `cta_${page.id}_${section.id}_${key}`,
            siteId: bundle.businessProfile.siteId,
            category: "conversion",
            severity: cta?.label && cta?.href ? "pass" : "fail",
            title: `CTA ${key} in ${section.type}`,
            detail: cta?.label && cta?.href ? "CTA has visible text and a destination." : "CTA is missing visible text or destination.",
            pageId: page.id,
            sectionId: section.id
          });
        }
      }
    }
  }

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

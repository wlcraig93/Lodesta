import type { AnalyticsSummary, OptimizationFinding, SiteBundle } from "./models";
import { primaryCtaForBusiness } from "./optimization";

export function recommendFromAnalytics(bundle: SiteBundle, summary: AnalyticsSummary): OptimizationFinding[] {
  const findings: OptimizationFinding[] = [];
  const homePage = bundle.siteModel.versions
    .find((version) => version.status === "published")
    ?.pages.find((page) => page.slug === "");
  const homePageId = homePage?.id ?? "page_home";
  const primaryCta = primaryCtaForBusiness(bundle.businessProfile);

  if (summary.sessions < 1) return findings;

  if (summary.sessions >= 1 && summary.primaryActions === 0 && summary.avgScrollDepth >= 50) {
    findings.push({
      id: "analytics_engaged_no_action",
      siteId: bundle.businessProfile.siteId,
      category: "conversion",
      severity: "recommended",
      title: "Visitors are reading without taking action",
      rationale: `Recent sessions reached an average scroll depth of ${summary.avgScrollDepth}% but produced no tracked primary actions.`,
      recommendedAction: "Add a stronger CTA band after the first proof section so engaged visitors get a clear next step.",
      status: "open",
      applyMode: "one_click",
      expectedOutcomeMetric: "calls",
      suggestedEditPayload: {
        action: "add_cta_section",
        pageId: homePageId,
        insertAfterSectionId: homePage?.sections[0]?.id,
        heading: actionHeading(primaryCta.role),
        body: "Visitors who have seen the offer should get a direct next step without scrolling back to the top.",
        primaryCta
      }
    });
  }

  if (summary.pageviews >= 3 && summary.actionRate < 0.05 && primaryCta.role === "tel") {
    findings.push({
      id: "analytics_call_cta_prominence",
      siteId: bundle.businessProfile.siteId,
      standardCriterionId: "conversion.primary_action_above_fold",
      category: "conversion",
      severity: "recommended",
      title: "Call action rate is low",
      rationale: `${summary.pageviews} tracked pageviews produced a ${Math.round(summary.actionRate * 100)}% primary action rate.`,
      recommendedAction: "Make the primary call CTA more explicit in the hero.",
      status: "open",
      applyMode: "one_click",
      expectedOutcomeMetric: "calls",
      suggestedEditPayload: {
        action: "set_hero_cta",
        pageId: homePageId,
        sectionId: homePage?.sections.find((section) => section.type === "hero")?.id ?? "hero_home",
        cta: {
          ...primaryCta,
          label: "Call Now"
        }
      }
    });
  }

  if (summary.formStarts > 0 && summary.formSubmits === 0) {
    findings.push({
      id: "analytics_form_abandonment",
      siteId: bundle.businessProfile.siteId,
      category: "conversion",
      severity: "recommended",
      title: "Visitors start the form but do not submit",
      rationale: `${summary.formStarts} form starts were tracked with no completed submissions.`,
      recommendedAction: "Add reassurance near the contact section and review the number of required fields.",
      status: "open",
      applyMode: "one_click",
      expectedOutcomeMetric: "forms",
      suggestedEditPayload: {
        action: "add_trust_section",
        pageId: homePageId,
        items: ["Fast response expected", "Owner-verified details", "No pressure next step"]
      }
    });
  }

  return findings;
}

export function mergeFindings(staticFindings: OptimizationFinding[], analyticsFindings: OptimizationFinding[]) {
  const merged = new Map<string, OptimizationFinding>();
  for (const finding of [...staticFindings, ...analyticsFindings]) {
    merged.set(finding.id, finding);
  }
  return Array.from(merged.values());
}

function actionHeading(role: string) {
  if (role === "tel") return "Ready to talk now?";
  if (role === "booking") return "Ready to book?";
  if (role === "ordering") return "Ready to order?";
  return "Ready for the next step?";
}

import type {
  GeneratedSiteCompilerDecisionV3,
  GeneratedSiteMediaReuseDecisionV3,
  SectionInstanceV3,
  SiteArtDirectionNavPlanV3
} from "./models";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";

export type ReconciledNavTargetRecordV3 = {
  label: string;
  target?: string;
  reason: string;
  kind: "item" | "child" | "primary_cta";
};

export type RewrittenNavTargetRecordV3 = {
  label: string;
  from: string;
  to: string;
  reason: string;
  kind: "item" | "child" | "primary_cta";
};

export type NavReconciliationResultV3 = {
  navPlan?: SiteArtDirectionNavPlanV3;
  droppedTargets: ReconciledNavTargetRecordV3[];
  rewrittenTargets: RewrittenNavTargetRecordV3[];
  ctaRewrite?: RewrittenNavTargetRecordV3;
};

export type GeneratedSiteQualitySignalsV3 = {
  navReconciliation?: NavReconciliationResultV3;
  compilerDecisions?: GeneratedSiteCompilerDecisionV3[];
  mediaReuseDecisions?: GeneratedSiteMediaReuseDecisionV3[];
};

export type NavReconciliationPageV3 = {
  slug: string;
};

export type NavReconciliationInputV3 = {
  navPlan?: SiteArtDirectionNavPlanV3;
  pages: readonly NavReconciliationPageV3[];
  homeAnchors: ReadonlySet<string> | readonly string[];
};

type ResolveResult =
  | { status: "valid"; target: string }
  | { status: "rewritten"; target: string; reason: string }
  | { status: "dropped"; reason: string };

export function homeAnchorsFromSectionsV3(sections: readonly SectionInstanceV3[]) {
  const anchors = new Set<string>(["hero"]);
  for (const section of sections) {
    const visual = getVisualSectionV3(section.props);
    const anchor = visual?.anchorId ?? section.id;
    if (anchor) anchors.add(normalizeAnchorName(anchor));
  }
  return anchors;
}

export function reconcileNavPlanV3(input: NavReconciliationInputV3): NavReconciliationResultV3 {
  const navPlan = input.navPlan;
  if (!navPlan) return { droppedTargets: [], rewrittenTargets: [] };

  const pageTargets = pageTargetSet(input.pages);
  const homeAnchors = normalizeAnchorSet(input.homeAnchors);
  const droppedTargets: ReconciledNavTargetRecordV3[] = [];
  const rewrittenTargets: RewrittenNavTargetRecordV3[] = [];

  const resolve = (label: string, target: string | undefined): ResolveResult => {
    if (!target?.trim()) return { status: "dropped", reason: "missing_target" };
    const trimmed = target.trim();
    if (/^(tel|mailto):/i.test(trimmed)) return { status: "valid", target: trimmed };
    if (/^https?:\/\//i.test(trimmed)) return { status: "dropped", reason: "external_targets_not_supported" };
    if (trimmed.startsWith("#")) {
      const anchor = normalizeAnchorName(trimmed.slice(1));
      if (homeAnchors.has(anchor)) return { status: "valid", target: `#${anchor}` };
      return { status: "dropped", reason: "anchor_missing" };
    }

    const pageTarget = normalizePathTarget(trimmed);
    if (pageTargets.has(pageTarget)) return { status: "valid", target: pageTarget };

    const anchor = anchorForIntent(label, pageTarget, homeAnchors);
    if (anchor) {
      return { status: "rewritten", target: `#${anchor}`, reason: `page_missing_rewritten_to_${anchor}` };
    }
    return { status: "dropped", reason: "page_missing" };
  };

  const nextItems: SiteArtDirectionNavPlanV3["items"] = [];
  for (const item of navPlan.items) {
    if (item.kind === "dropdown") {
      const children: Array<{ label: string; target: string }> = [];
      for (const child of item.children ?? []) {
        if (isPseudoServiceNavTarget(child.label, child.target)) {
          droppedTargets.push({ label: child.label, target: child.target, reason: "pseudo_service_target", kind: "child" });
          continue;
        }
        const childResult = resolve(child.label, child.target);
        if (childResult.status === "valid") children.push({ label: child.label, target: childResult.target });
        else if (childResult.status === "rewritten") {
          children.push({ label: child.label, target: childResult.target });
          rewrittenTargets.push({ label: child.label, from: child.target, to: childResult.target, reason: childResult.reason, kind: "child" });
        } else {
          droppedTargets.push({ label: child.label, target: child.target, reason: childResult.reason, kind: "child" });
        }
      }
      if (children.length > 1) {
        nextItems.push({ label: item.label, kind: "dropdown", ...(item.target ? { target: item.target } : {}), children });
      } else if (children.length === 1) {
        const onlyChild = children[0];
        if (!onlyChild) continue;
        nextItems.push({ label: onlyChild.label, kind: targetKind(onlyChild.target), target: onlyChild.target });
        rewrittenTargets.push({
          label: item.label,
          from: item.target ?? item.label,
          to: onlyChild.target,
          reason: "single_child_dropdown_collapsed",
          kind: "item"
        });
      } else {
        const fallback = resolve(item.label, item.target ?? `#${normalizeAnchorName(item.label)}`);
        if (fallback.status === "valid") nextItems.push({ label: item.label, kind: targetKind(fallback.target), target: fallback.target });
        else if (fallback.status === "rewritten") {
          nextItems.push({ label: item.label, kind: targetKind(fallback.target), target: fallback.target });
          rewrittenTargets.push({ label: item.label, from: item.target ?? item.label, to: fallback.target, reason: fallback.reason, kind: "item" });
        } else {
          droppedTargets.push({ label: item.label, target: item.target, reason: "dropdown_empty_after_reconciliation", kind: "item" });
        }
      }
      continue;
    }

    const result = resolve(item.label, item.target);
    if (result.status === "valid") nextItems.push({ label: item.label, kind: targetKind(result.target), target: result.target });
    else if (result.status === "rewritten") {
      nextItems.push({ label: item.label, kind: targetKind(result.target), target: result.target });
      rewrittenTargets.push({ label: item.label, from: item.target ?? "", to: result.target, reason: result.reason, kind: "item" });
    } else {
      droppedTargets.push({ label: item.label, target: item.target, reason: result.reason, kind: "item" });
    }
  }

  const ctaResult = resolve(navPlan.primaryCta.label, navPlan.primaryCta.target);
  let primaryCta = navPlan.primaryCta;
  let ctaRewrite: RewrittenNavTargetRecordV3 | undefined;
  if (ctaResult.status === "valid" && !isPseudoServiceNavTarget(navPlan.primaryCta.label, navPlan.primaryCta.target)) {
    primaryCta = { label: navPlan.primaryCta.label, target: ctaResult.target };
  } else {
    const fallback = homeAnchors.has("contact") ? "#contact" : pageTargets.has("/") ? "/" : undefined;
    if (fallback) {
      ctaRewrite = {
        label: navPlan.primaryCta.label,
        from: navPlan.primaryCta.target,
        to: fallback,
        reason: ctaResult.status === "dropped" ? ctaResult.reason : "primary_cta_pseudo_service_fallback",
        kind: "primary_cta"
      };
      primaryCta = { label: navPlan.primaryCta.label, target: fallback };
      rewrittenTargets.push(ctaRewrite);
    } else {
      droppedTargets.push({ label: navPlan.primaryCta.label, target: navPlan.primaryCta.target, reason: "primary_cta_unresolved", kind: "primary_cta" });
    }
  }

  return {
    navPlan: { source: navPlan.source, items: nextItems, primaryCta },
    droppedTargets,
    rewrittenTargets,
    ctaRewrite
  };
}

function pageTargetSet(pages: readonly NavReconciliationPageV3[]) {
  const targets = new Set<string>(["/"]);
  for (const page of pages) targets.add(normalizePathTarget(page.slug));
  return targets;
}

function normalizeAnchorSet(anchors: ReadonlySet<string> | readonly string[]) {
  return new Set(Array.from(anchors).map(normalizeAnchorName).filter(Boolean));
}

function normalizeAnchorName(anchor: string) {
  return anchor.replace(/^#/, "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizePathTarget(target: string) {
  const withoutHash = target.split("#")[0] ?? target;
  const withoutQuery = withoutHash.split("?")[0] ?? withoutHash;
  const normalized = withoutQuery.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `/${normalized}` : "/";
}

function targetKind(target: string): "anchor" | "page" {
  return target.startsWith("#") ? "anchor" : "page";
}

function isPseudoServiceNavTarget(label: string, target: string | undefined) {
  const text = `${label} ${target ?? ""}`;
  return /\b(free\s+)?(repair\s+)?quote|estimate|appointment|contact\s+us|get\s+a\s+free/i.test(text);
}

function anchorForIntent(label: string, target: string, anchors: ReadonlySet<string>) {
  const text = `${label} ${target}`.toLowerCase();
  const candidates: string[] = [];
  if (/\b(contact|quote|estimate|appointment|get-a-free|free-repair)\b/.test(text)) candidates.push("contact");
  if (/\b(faq|questions?)\b/.test(text)) candidates.push("faq");
  if (/\b(locations?|hours?|directions?)\b/.test(text)) candidates.push("location");
  if (/\b(gallery|case-studies|case studies|proof|work|portfolio)\b/.test(text)) candidates.push("proof", "gallery");
  if (/\b(services?)\b/.test(text)) candidates.push("services");
  return candidates.find((anchor) => anchors.has(anchor));
}

import type { QACheck, SiteBundle } from "./models";
import { applyBusinessProfileUpdate, type BusinessProfileUpdateInput } from "./business-profile-update";
import { runSiteQa } from "./qa";
import { applyV3SectionUpdate } from "./v3-editor";
import { assertSiteVersionV3 } from "./site-version-v3";

type SectionUpdateInput = {
  siteId: string;
  pageId: string;
  sectionId: string;
  props: Record<string, unknown>;
};

export type EditorGuardrailIssue = {
  id: string;
  severity: "block" | "warning";
  title: string;
  detail: string;
  field?: string;
  pageId?: string;
  sectionId?: string;
  checkId?: string;
  key?: string;
};

export type EditorGuardrailResult =
  | {
      ok: true;
      warnings: EditorGuardrailIssue[];
      qa?: ReturnType<typeof runSiteQa>;
    }
  | {
      ok: false;
      reason: string;
      issues: EditorGuardrailIssue[];
      qa?: ReturnType<typeof runSiteQa>;
    };

const blockingClaimPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "licensed/certified credential", pattern: /\b(licensed|certified|board[-\s]?certified|accredited)\b/i },
  { label: "insurance or bonding claim", pattern: /\b(insured|bonded)\b/i },
  { label: "guarantee", pattern: /\b(guaranteed|guarantee|risk[-\s]?free)\b/i },
  { label: "regulated approval", pattern: /\b(fda[-\s]?approved|hipaa[-\s]?compliant|irs[-\s]?certified)\b/i },
  { label: "regulated advice", pattern: /\b(medical advice|legal advice|financial advice|tax advice)\b/i },
  { label: "medical outcome", pattern: /\b(cure|diagnose|treats? disease|pain[-\s]?free)\b/i }
];

const warningClaimPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "best or #1 claim", pattern: /\b(best|#\s?1|number\s?one)\b/i },
  { label: "top-rated claim", pattern: /\b(top[-\s]?rated|highest[-\s]?rated|5[-\s]?star|five[-\s]?star)\b/i },
  { label: "award claim", pattern: /\b(award[-\s]?winning|voted)\b/i },
  { label: "market leadership claim", pattern: /\b(leading|most trusted|premier)\b/i }
];

export function validateSectionUpdate(bundle: SiteBundle, input: SectionUpdateInput): EditorGuardrailResult {
  const draftBundle = structuredClone(bundle);
  const draft = assertSiteVersionV3(clonePublishedAsDraft(draftBundle), "guardrail draft");
  const page = draft.pageComposition.pages.find((candidate) => candidate.id === input.pageId);
  const section = page?.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) {
    return block("Unknown site, page, or section", [
      {
        id: "unknown_section",
        severity: "block",
        title: "Unknown section",
        detail: "The requested editable section could not be found.",
        pageId: input.pageId,
        sectionId: input.sectionId
      }
    ]);
  }

  const issues: EditorGuardrailIssue[] = [];
  for (const [key, value] of Object.entries(input.props)) {
    issues.push(
      ...scanSensitiveClaims(value, {
        field: key,
        path: humanizeField(key),
        pageId: input.pageId,
        sectionId: input.sectionId
      })
    );
  }
  if ("primaryCta" in input.props && !isUsablePrimaryCta(input.props.primaryCta)) {
    issues.push({
      id: "qa_blocking_regression",
      severity: "block",
      title: "Primary CTA guardrail",
      detail: "The primary CTA must keep visible text and a valid destination.",
      field: "primaryCta",
      pageId: input.pageId,
      sectionId: input.sectionId,
      checkId: "primary_cta_guardrail",
      key: `qa:primary_cta_guardrail:${input.pageId}:${input.sectionId}`
    });
    return resultFromIssues(issues);
  }
  const applied = applyV3SectionUpdate(draftBundle, input);
  if (!applied.ok) {
    return block(applied.reason, [
      {
        id: "field_not_owner_editable",
        severity: "block",
        title: "Field is locked",
        detail: applied.reason,
        pageId: input.pageId,
        sectionId: input.sectionId
      }
    ]);
  }

  issues.push(...qaRegressionIssues(bundle, draftBundle));
  return resultFromIssues(issues, runSiteQa(draftBundle, { versionStatus: "draft" }));
}

export function validateBusinessProfileUpdate(bundle: SiteBundle, input: BusinessProfileUpdateInput): EditorGuardrailResult {
  const draftBundle = structuredClone(bundle);
  const issues: EditorGuardrailIssue[] = [];

  if (input.services) {
    issues.push(
      ...scanSensitiveClaims(input.services, {
        field: "services",
        path: "Services"
      })
    );
  }

  applyBusinessProfileUpdate(draftBundle, input);
  issues.push(...qaRegressionIssues(bundle, draftBundle));
  return resultFromIssues(issues, runSiteQa(draftBundle, { versionStatus: "draft" }));
}

export function validateAiEditOutcome(beforeBundle: SiteBundle, afterBundle: SiteBundle): EditorGuardrailResult {
  const beforeSensitiveKeys = new Set(sensitiveClaimsFromBundle(beforeBundle).map((issue) => issue.key ?? issue.detail));
  const newSensitiveIssues = sensitiveClaimsFromBundle(afterBundle).filter(
    (issue) => !beforeSensitiveKeys.has(issue.key ?? issue.detail)
  );
  const issues = [...newSensitiveIssues, ...qaRegressionIssues(beforeBundle, afterBundle)];
  return resultFromIssues(issues, runSiteQa(afterBundle, { versionStatus: "draft" }));
}

export function guardrailIssueMessages(issues: EditorGuardrailIssue[]) {
  return issues.map((issue) => `${issue.title}: ${issue.detail}`);
}

export function scanSensitiveClaims(
  value: unknown,
  context: { field?: string; path: string; pageId?: string; sectionId?: string }
): EditorGuardrailIssue[] {
  if (typeof value === "string") return sensitiveClaimIssuesForText(value, context);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      scanSensitiveClaims(item, {
        ...context,
        path: `${context.path} ${index + 1}`
      })
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      scanSensitiveClaims(child, {
        field: context.field ?? key,
        path: `${context.path} ${humanizeField(key)}`,
        pageId: context.pageId,
        sectionId: context.sectionId
      })
    );
  }
  return [];
}

function sensitiveClaimsFromBundle(bundle: SiteBundle) {
  const issues: EditorGuardrailIssue[] = [];
  issues.push(
    ...scanSensitiveClaims(bundle.businessProfile.services, {
      field: "services",
      path: "Services"
    })
  );

  for (const version of bundle.siteModel.versions) {
    const v3 = assertSiteVersionV3(version, "guardrail sensitive scan version");
    for (const page of v3.pageComposition.pages) {
      for (const section of page.sections) {
        issues.push(
          ...scanSensitiveClaims(section.props, {
            path: page.title,
            pageId: page.id,
            sectionId: section.id
          })
        );
      }
    }
  }

  return issues;
}

function sensitiveClaimIssuesForText(
  text: string,
  context: { field?: string; path: string; pageId?: string; sectionId?: string }
): EditorGuardrailIssue[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const issues: EditorGuardrailIssue[] = [];
  for (const claim of blockingClaimPatterns) {
    if (!claim.pattern.test(normalized)) continue;
    issues.push({
      id: "unverified_sensitive_claim",
      severity: "block",
      title: "Unverified sensitive claim",
      detail: `${context.path} includes a ${claim.label}. Add verified provenance before publishing this claim.`,
      field: context.field,
      pageId: context.pageId,
      sectionId: context.sectionId,
      key: `block:${context.pageId ?? "business"}:${context.sectionId ?? ""}:${context.field ?? context.path}:${claim.label}`
    });
  }

  for (const claim of warningClaimPatterns) {
    if (!claim.pattern.test(normalized)) continue;
    issues.push({
      id: "unverified_marketing_claim",
      severity: "warning",
      title: "Marketing claim needs proof",
      detail: `${context.path} includes a ${claim.label}. Keep it only if the owner can verify it.`,
      field: context.field,
      pageId: context.pageId,
      sectionId: context.sectionId,
      key: `warning:${context.pageId ?? "business"}:${context.sectionId ?? ""}:${context.field ?? context.path}:${claim.label}`
    });
  }

  return issues;
}

function qaRegressionIssues(beforeBundle: SiteBundle, afterBundle: SiteBundle) {
  const beforeQa = runSiteQa(beforeBundle, { versionStatus: "draft" });
  const afterQa = runSiteQa(afterBundle, { versionStatus: "draft" });
  const beforeById = new Map(beforeQa.checks.map((check) => [check.id, check]));
  return afterQa.checks
    .filter((check) => severityRank(check.severity) > severityRank(beforeById.get(check.id)?.severity ?? "pass"))
    .map((check) => issueFromQaCheck(check));
}

function issueFromQaCheck(check: QACheck): EditorGuardrailIssue {
  return {
    id: check.severity === "fail" ? "qa_blocking_regression" : "qa_warning_regression",
    severity: check.severity === "fail" ? "block" : "warning",
    title: check.title,
    detail: check.detail,
    pageId: check.pageId,
    sectionId: check.sectionId,
    checkId: check.id,
    key: `qa:${check.id}:${check.severity}`
  };
}

function severityRank(severity: QACheck["severity"] | undefined) {
  if (severity === "fail") return 2;
  if (severity === "warning") return 1;
  return 0;
}

function isUsablePrimaryCta(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const cta = value as { label?: unknown; href?: unknown };
  return typeof cta.label === "string" && Boolean(cta.label.trim()) && typeof cta.href === "string" && Boolean(cta.href.trim());
}

function resultFromIssues(issues: EditorGuardrailIssue[], qa?: ReturnType<typeof runSiteQa>): EditorGuardrailResult {
  const blocking = dedupeIssues(issues.filter((issue) => issue.severity === "block"));
  if (blocking.length) {
    return {
      ok: false,
      reason: blocking[0].detail,
      issues: blocking,
      qa
    };
  }
  return {
    ok: true,
    warnings: dedupeIssues(issues.filter((issue) => issue.severity === "warning")),
    qa
  };
}

function block(reason: string, issues: EditorGuardrailIssue[]): EditorGuardrailResult {
  return {
    ok: false,
    reason,
    issues
  };
}

function dedupeIssues(issues: EditorGuardrailIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issue.key ?? `${issue.id}:${issue.field ?? ""}:${issue.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clonePublishedAsDraft(bundle: SiteBundle) {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) return existingDraft;
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(published);
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  draft.theme ??= structuredClone(bundle.siteModel.theme);
  bundle.siteModel.versions.unshift(draft);
  return draft;
}

function humanizeField(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

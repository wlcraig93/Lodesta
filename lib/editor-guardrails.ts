import type { SiteBundle } from "./models";
import { applyBusinessProfileUpdate, type BusinessProfileUpdateInput } from "./business-profile-update";
import { applyV3SectionUpdate } from "./v3-editor";
import { assertSiteVersionV3 } from "./site-version-v3";
import { scanSensitiveClaimText } from "./content-safety-scanners";

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
    }
  | {
      ok: false;
      reason: string;
      issues: EditorGuardrailIssue[];
    };

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

  return resultFromIssues(issues);
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
  return resultFromIssues(issues);
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

function sensitiveClaimIssuesForText(
  text: string,
  context: { field?: string; path: string; pageId?: string; sectionId?: string }
): EditorGuardrailIssue[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const issues: EditorGuardrailIssue[] = [];
  for (const claim of scanSensitiveClaimText(normalized)) {
    const severity = claim.severity === "block" ? "block" : "warning";
    issues.push({
      id: severity === "block" ? "unverified_sensitive_claim" : "unverified_marketing_claim",
      severity,
      title: severity === "block" ? "Unverified sensitive claim" : "Marketing claim needs proof",
      detail:
        severity === "block"
          ? `${context.path} includes a ${claim.label}. Add verified provenance before publishing this claim.`
          : `${context.path} includes a ${claim.label}. Keep it only if the owner can verify it.`,
      field: context.field,
      pageId: context.pageId,
      sectionId: context.sectionId,
      key: `${severity}:${context.pageId ?? "business"}:${context.sectionId ?? ""}:${context.field ?? context.path}:${claim.label}`
    });
  }

  return issues;
}

function isUsablePrimaryCta(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const cta = value as { label?: unknown; href?: unknown };
  return typeof cta.label === "string" && Boolean(cta.label.trim()) && typeof cta.href === "string" && Boolean(cta.href.trim());
}

function resultFromIssues(issues: EditorGuardrailIssue[]): EditorGuardrailResult {
  const blocking = dedupeIssues(issues.filter((issue) => issue.severity === "block"));
  if (blocking.length) {
    return {
      ok: false,
      reason: blocking[0].detail,
      issues: blocking
    };
  }
  return {
    ok: true,
    warnings: dedupeIssues(issues.filter((issue) => issue.severity === "warning"))
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

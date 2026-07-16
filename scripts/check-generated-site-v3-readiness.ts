/**
 * Dry-run audit for existing ready generated-site V3 candidates after stricter
 * readiness rules. This intentionally does not mutate stored rows; operators
 * should manually regenerate reported candidates.
 *
 *   npm run check:generated-site-v3-readiness -- --check
 */
import { existsSync } from "node:fs";
import { normalize, resolve } from "node:path";

import type { SiteBundle, SiteVersionV3 } from "../lib/models";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { homeAnchorsFromSectionsV3, reconcileNavPlanV3 } from "../lib/generated-site-v3-nav";

const PAGE_SIZE = 100;

type Counts = {
  scannedReady: number;
  notGeneratedV3: number;
  clean: number;
  withFindings: number;
  navDelta: number;
  invalidCta: number;
  missingPlatformAssets: number;
  missingHoursRows: number;
  failedRows: number;
};

type CandidateFinding = {
  id: string;
  severity: "hard_block" | "review";
  detail: string;
};

async function main() {
  const check = process.argv.includes("--check");
  const counts: Counts = {
    scannedReady: 0,
    notGeneratedV3: 0,
    clean: 0,
    withFindings: 0,
    navDelta: 0,
    invalidCta: 0,
    missingPlatformAssets: 0,
    missingHoursRows: 0,
    failedRows: 0
  };

  const client = getSupabaseAdminClient();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_candidates")
      .select("id, business_name, bundle_json")
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List ready site_candidates: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      counts.scannedReady += 1;
      try {
        const bundle = row.bundle_json as SiteBundle;
        const version = latestGeneratedV3Version(bundle);
        if (!version) {
          counts.notGeneratedV3 += 1;
          continue;
        }
        const findings = auditCandidate(bundle, version);
        if (!findings.length) {
          counts.clean += 1;
          continue;
        }
        counts.withFindings += 1;
        if (findings.some((finding) => finding.id === "nav_delta")) counts.navDelta += 1;
        if (findings.some((finding) => finding.id === "invalid_cta")) counts.invalidCta += 1;
        if (findings.some((finding) => finding.id === "missing_platform_asset")) counts.missingPlatformAssets += 1;
        if (findings.some((finding) => finding.id === "missing_hours_row")) counts.missingHoursRows += 1;
        console.log(`${row.id} (${row.business_name})`);
        for (const finding of findings) {
          console.log(`  - ${finding.severity}: ${finding.id}: ${finding.detail}`);
        }
        console.log("  recommendation: manually regenerate; regeneration may rerun model generation and is not idempotent.");
      } catch (error) {
        counts.failedRows += 1;
        console.error(`${row.id} (${row.business_name}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (data.length < PAGE_SIZE) break;
  }

  console.log(
    JSON.stringify(
      {
        mode: check ? "check" : "report",
        mutation: "none",
        regeneration: "manual_non_idempotent",
        counts
      },
      null,
      2
    )
  );
  if (counts.failedRows || counts.invalidCta || counts.missingPlatformAssets || counts.missingHoursRows) {
    process.exitCode = 1;
  }
}

function latestGeneratedV3Version(bundle: SiteBundle): SiteVersionV3 | undefined {
  return bundle.siteModel?.versions?.find((version): version is SiteVersionV3 => version.rendererVersion === "layout-v3");
}

function auditCandidate(bundle: SiteBundle, version: SiteVersionV3): CandidateFinding[] {
  const findings: CandidateFinding[] = [];
  const home = version.pageComposition.pages.find((page) => page.slug === "") ?? version.pageComposition.pages[0];
  const nav = reconcileNavPlanV3({
    navPlan: version.artDirection.navPlan,
    pages: version.pageComposition.pages,
    homeAnchors: home ? homeAnchorsFromSectionsV3(home.sections) : ["hero", "services", "location", "contact"]
  });
  const deltaCount = nav.droppedTargets.length + nav.rewrittenTargets.length;
  if (deltaCount >= 4) {
    findings.push({
      id: "nav_delta",
      severity: "review",
      detail: `${deltaCount} nav target(s) require reconciliation (${nav.droppedTargets.length} dropped, ${nav.rewrittenTargets.length} rewritten).`
    });
  }
  if (nav.droppedTargets.some((target) => target.kind === "primary_cta")) {
    findings.push({
      id: "invalid_cta",
      severity: "hard_block",
      detail: "Primary CTA target remains unresolved after reconciliation."
    });
  }
  const missingAssets = missingPlatformAssetUrls(version);
  if (missingAssets.length) {
    findings.push({
      id: "missing_platform_asset",
      severity: "hard_block",
      detail: `${missingAssets.length} platform/local asset URL(s) are missing: ${missingAssets.slice(0, 5).join(", ")}`
    });
  }
  const missingDays = missingKnownHourDays(bundle, version);
  if (missingDays.length) {
    findings.push({
      id: "missing_hours_row",
      severity: "hard_block",
      detail: `Known source hours missing from location data: ${missingDays.join(", ")}.`
    });
  }
  return findings;
}

function missingPlatformAssetUrls(version: SiteVersionV3) {
  return [...collectStringValues(version)]
    .filter((value) => isPlatformAssetUrl(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter((url) => !platformAssetExists(url));
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  return Object.values(value as Record<string, unknown>).flatMap(collectStringValues);
}

function isPlatformAssetUrl(value: string) {
  return value.startsWith("/generated-site-assets/") || /^\/api\/assets\/[^/]+\/[^/]+$/i.test(value);
}

function platformAssetExists(url: string) {
  const pathOnly = url.split("#")[0]?.split("?")[0] ?? url;
  if (pathOnly.startsWith("/generated-site-assets/")) {
    const normalizedPath = normalize(pathOnly).replace(/^(\.\.[/\\])+/, "");
    const publicRoot = resolve(process.cwd(), "public");
    const filePath = resolve(publicRoot, normalizedPath.replace(/^\/+/, ""));
    return filePath.startsWith(`${publicRoot}/`) && existsSync(filePath);
  }
  const assetMatch = pathOnly.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/i);
  if (!assetMatch) return true;
  const storagePath = `${decodeURIComponent(assetMatch[1] ?? "")}/${decodeURIComponent(assetMatch[2] ?? "")}`;
  if (!/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*\.(png|jpg|jpeg|webp)$/i.test(storagePath)) return false;
  const assetRoot = resolve(process.cwd(), ".data", "assets");
  const filePath = resolve(assetRoot, storagePath);
  return filePath.startsWith(`${assetRoot}/`) && existsSync(filePath);
}

function missingKnownHourDays(bundle: SiteBundle, version: SiteVersionV3) {
  const sourceDays = Object.entries(bundle.businessProfile.hours ?? {})
    .filter(([, value]) => value && !/closed/i.test(value))
    .map(([day]) => normalizedWeekday(day))
    .filter((day): day is QaWeekday => Boolean(day));
  if (!sourceDays.length) return [];
  const renderedLabels = collectLocationHourLabels(version);
  return [...new Set(sourceDays)].filter((day) => !renderedLabels.some((label) => hoursLabelIncludesDay(label, day)));
}

function collectLocationHourLabels(version: SiteVersionV3) {
  const labels: string[] = [];
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = (section.props as { visualSectionV3?: unknown }).visualSectionV3;
      if (!visual || typeof visual !== "object") continue;
      const locations = (visual as { slots?: { locations?: { locations?: Array<{ hours?: Array<{ label?: string }> }> } } }).slots?.locations?.locations ?? [];
      for (const location of locations) {
        for (const entry of location.hours ?? []) {
          if (entry.label) labels.push(entry.label);
        }
      }
    }
  }
  return labels;
}

const qaWeekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type QaWeekday = (typeof qaWeekdays)[number];

function normalizedWeekday(value: string) {
  const normalized = value.trim().toLowerCase();
  return qaWeekdays.find((day) => day === normalized || day.startsWith(normalized.slice(0, 3)));
}

function hoursLabelIncludesDay(label: string, day: QaWeekday) {
  const normalized = label.trim().toLowerCase();
  if (normalizedWeekday(normalized) === day) return true;
  if (!/[–—-]/.test(normalized)) return false;
  const [startRaw, endRaw] = normalized.split(/[–—-]/).map((part) => part.trim());
  const start = normalizedWeekday(startRaw ?? "");
  const end = normalizedWeekday(endRaw ?? "");
  const startIndex = start ? qaWeekdays.indexOf(start) : -1;
  const endIndex = end ? qaWeekdays.indexOf(end) : -1;
  const targetIndex = qaWeekdays.indexOf(day);
  if (startIndex < 0 || endIndex < 0 || targetIndex < 0) return false;
  if (startIndex <= endIndex) return targetIndex >= startIndex && targetIndex <= endIndex;
  return targetIndex >= startIndex || targetIndex <= endIndex;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

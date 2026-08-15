import { sha256, stableJson } from "@/packages/business-data";
import { normalizeSiteRedirectPath } from "@/packages/platform-operations";
import {
  siteSourceCoverageReportSchema,
  siteVersionRedirectSchema,
  websiteSourceSnapshotPayloadSchema,
  type CandidateRedirect,
  type RetiredSourcePath,
  type SiteBuildArtifact,
  type SiteSourceCoverageReport,
  type SiteVersionRedirect,
  type SourceSnapshot,
  type SourceSnapshotPage
} from "@/packages/site-contracts";

export function deriveCandidateSourceCoverage(input: {
  siteId: string;
  versionId: string;
  artifact: SiteBuildArtifact;
  snapshots: SourceSnapshot[];
  pages: SourceSnapshotPage[];
  redirects: CandidateRedirect[];
  retiredSourcePaths: RetiredSourcePath[];
  generatedAt?: string;
}): { report?: SiteSourceCoverageReport; redirects: SiteVersionRedirect[] } {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const source = input.snapshots
    .flatMap((snapshot) => {
      const payload = websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload);
      return payload.success ? [{ snapshot, payload: payload.data }] : [];
    })
    .sort((left, right) => right.snapshot.capturedAt.localeCompare(left.snapshot.capturedAt))[0];
  const liveRoutes = new Set(input.artifact.routes.map((route) => normalizeSiteRedirectPath(route.path)));
  const dispositions = validateCandidateSourceDispositions({
    redirects: input.redirects,
    retiredSourcePaths: input.retiredSourcePaths,
    liveRoutes
  });
  const candidateRedirects = dispositions.redirects.map((redirect) => siteVersionRedirectSchema.parse({
    schemaVersion: 1,
    id: deterministicId("version_redirect", { versionId: input.versionId, sourcePath: redirect.sourcePath }),
    siteId: input.siteId,
    versionId: input.versionId,
    sourcePath: redirect.sourcePath,
    destinationPath: redirect.destinationPath,
    reason: redirect.reason,
    createdAt: generatedAt
  }));
  if (!source) return { redirects: candidateRedirects };

  const redirectBySource = new Map(candidateRedirects.map((redirect) => [redirect.sourcePath, redirect]));
  const retiredBySource = new Map(dispositions.retiredSourcePaths.map((entry) => [entry.sourcePath, entry]));
  const sourcePages = input.pages.filter((page) => page.sourceSnapshotId === source.snapshot.id);
  const sourcePaths = new Set(sourcePages.map((page) => normalizedSourcePath(page.path)));
  const entries: SiteSourceCoverageReport["entries"] = sourcePages.map((page) => {
    const sourcePath = normalizedSourcePath(page.path);
    const redirect = redirectBySource.get(sourcePath);
    const retired = retiredBySource.get(sourcePath);
    const canonicalPath = canonicalSourcePath(page.canonical, source.payload.sourceUrl);
    if (liveRoutes.has(sourcePath)) return coverageEntry(page, sourcePath, "preserved");
    if (redirect) return coverageEntry(page, sourcePath, "redirected", redirect.destinationPath, redirect.reason);
    if (page.exactDuplicateOf || canonicalPath && canonicalPath !== sourcePath && (liveRoutes.has(canonicalPath) || redirectBySource.has(canonicalPath))) {
      return coverageEntry(page, sourcePath, "canonical_duplicate", canonicalPath);
    }
    if (retired) return coverageEntry(page, sourcePath, "retired", undefined, retired.reason);
    return coverageEntry(page, sourcePath, "unaccounted");
  });
  const newRoutes = [...liveRoutes].filter((route) => !sourcePaths.has(route)).sort();
  const count = (disposition: SiteSourceCoverageReport["entries"][number]["disposition"]) => entries.filter((entry) => entry.disposition === disposition).length;
  const report = siteSourceCoverageReportSchema.parse({
    schemaVersion: 1,
    id: deterministicId("source_coverage", {
      versionId: input.versionId,
      sourceSnapshotId: source.snapshot.id,
      artifactHash: input.artifact.artifactHash,
      entries,
      newRoutes
    }),
    siteId: input.siteId,
    versionId: input.versionId,
    sourceSnapshotId: source.snapshot.id,
    sourceContentHash: source.snapshot.contentHash,
    artifactHash: input.artifact.artifactHash,
    generatedAt,
    counts: {
      sourcePages: entries.length,
      preserved: count("preserved"),
      redirected: count("redirected"),
      canonicalDuplicates: count("canonical_duplicate"),
      retired: count("retired"),
      unaccounted: count("unaccounted"),
      newRoutes: newRoutes.length
    },
    entries,
    newRoutes
  });
  return { report, redirects: candidateRedirects };
}

export function validateCandidateSourceDispositions(input: {
  redirects: CandidateRedirect[];
  retiredSourcePaths: RetiredSourcePath[];
  liveRoutes?: Iterable<string>;
}) {
  const normalizedRedirects = input.redirects.map((redirect) => ({
    sourcePath: normalizeSiteRedirectPath(redirect.sourcePath),
    destinationPath: normalizeSiteRedirectPath(redirect.destinationPath),
    reason: redirect.reason
  }));
  const normalizedRetirements = input.retiredSourcePaths.map((entry) => ({
    sourcePath: normalizeRetiredSourcePath(entry.sourcePath),
    reason: entry.reason
  }));
  const liveRoutes = input.liveRoutes
    ? new Set([...input.liveRoutes].map(normalizeSiteRedirectPath))
    : undefined;
  const sources = new Set<string>();
  for (const redirect of normalizedRedirects) {
    if (redirect.sourcePath === "/") throw new Error("candidate_redirect_homepage_source");
    if (sources.has(redirect.sourcePath)) throw new Error("candidate_redirect_source_duplicated");
    if (redirect.sourcePath === redirect.destinationPath) throw new Error("candidate_redirect_self_reference");
    if (liveRoutes?.has(redirect.sourcePath)) throw new Error("candidate_redirect_source_is_live_route");
    if (liveRoutes && !liveRoutes.has(redirect.destinationPath)) throw new Error("candidate_redirect_destination_missing");
    sources.add(redirect.sourcePath);
  }
  if (normalizedRedirects.some((redirect) => sources.has(redirect.destinationPath))) throw new Error("candidate_redirect_chain_or_cycle");
  const retiredSources = new Set<string>();
  for (const retirement of normalizedRetirements) {
    if (retirement.sourcePath === "/") throw new Error("candidate_retirement_homepage_source");
    if (retiredSources.has(retirement.sourcePath)) throw new Error("candidate_retirement_source_duplicated");
    if (sources.has(retirement.sourcePath)) throw new Error("candidate_source_disposition_conflict");
    if (liveRoutes?.has(retirement.sourcePath)) throw new Error("candidate_retirement_source_is_live_route");
    retiredSources.add(retirement.sourcePath);
  }
  return { redirects: normalizedRedirects, retiredSourcePaths: normalizedRetirements };
}

function normalizeRetiredSourcePath(input: string) {
  const value = input.trim();
  if (
    !value.startsWith("/")
    || value.length > 512
    || value.includes("?")
    || value.includes("#")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Retired source paths must be bounded plain pathnames.");
  }
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}

function coverageEntry(
  page: SourceSnapshotPage,
  sourcePath: string,
  disposition: SiteSourceCoverageReport["entries"][number]["disposition"],
  destinationPath?: string,
  reason?: string
) {
  return {
    sourcePageId: page.id,
    sourceUrl: page.requestedUrl,
    sourcePath,
    indexability: page.indexability,
    disposition,
    destinationPath,
    reason
  };
}

function normalizedSourcePath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  try {
    return normalizeSiteRedirectPath(pathname);
  } catch {
    return pathname.startsWith("/") ? pathname : `/${pathname}`;
  }
}

function canonicalSourcePath(value: string | undefined, sourceUrl: string) {
  if (!value) return undefined;
  try {
    const canonical = new URL(value);
    if (canonical.hostname.replace(/^www\./, "") !== new URL(sourceUrl).hostname.replace(/^www\./, "")) return undefined;
    return normalizedSourcePath(canonical.pathname);
  } catch {
    return undefined;
  }
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice(7, 31)}`;
}

/**
 * No-model-spend preflight for benchmark vector targets.
 *
 *   npm run benchmark:vector:preflight -- --targets-file config/benchmark-targets/weekly-us-local.txt
 *   npm run benchmark:vector:preflight -- --report .data/benchmarks/vector-preflight.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { crawlUrl, type CrawlAssessment } from "../lib/crawler";
import { inferVertical } from "../lib/vertical-classification";
import { validateLaunchMarket } from "../lib/launch-market";
import { assertPublicFetchUrl } from "../lib/url-safety";
import type { Vertical } from "../lib/models";

type ParsedArgs = {
  targets: BenchmarkTarget[];
  targetsFile?: string;
  reportPath?: string;
  allowMultiLocation: boolean;
  expectedVertical?: Vertical;
};

type BenchmarkTarget = {
  url: string;
  expectedVertical?: Vertical;
};

type PreflightTargetResult = {
  url: string;
  finalUrl?: string;
  host?: string;
  expectedVertical?: Vertical;
  inferredVertical?: Vertical;
  ok: boolean;
  reasons: Array<{
    code: string;
    severity: "blocking" | "warning";
    message: string;
  }>;
  facts: {
    name?: string;
    phone?: string;
    hasAddress: boolean;
    serviceCount: number;
    country?: string;
  };
  crawl: {
    fetched: boolean;
    status?: number;
    pages: number;
    hasLocalBusinessSchema: boolean;
    hasTelLink: boolean;
  };
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { targets: [], allowMultiLocation: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--targets-file") {
      const targetsFile = argv[index + 1];
      if (!targetsFile) throw new Error("--targets-file requires a path.");
      parsed.targetsFile = targetsFile;
      index += 1;
      continue;
    }
    if (arg === "--report") {
      const reportPath = argv[index + 1];
      if (!reportPath) throw new Error("--report requires a path.");
      parsed.reportPath = reportPath;
      index += 1;
      continue;
    }
    if (arg === "--expected-vertical") {
      parsed.expectedVertical = parseVertical(argv[index + 1], arg);
      index += 1;
      continue;
    }
    if (arg === "--allow-multi-location") {
      parsed.allowMultiLocation = true;
      continue;
    }
    if (arg.startsWith("http")) {
      parsed.targets.push({ url: arg });
      continue;
    }
    throw new Error(`Unknown preflight argument: ${arg}`);
  }
  return parsed;
}

function parseUrlList(raw: string): string[] {
  return (raw.match(/https?:\/\/[^\s"',)]+/g) ?? []).map((url) => url.replace(/[.;]+$/, ""));
}

function targetList(parsed: ParsedArgs): BenchmarkTarget[] {
  if (parsed.targets.length) return uniqueTargets(parsed.targets.map((target) => ({ ...target, expectedVertical: target.expectedVertical ?? parsed.expectedVertical })));
  const targetsFile = parsed.targetsFile ?? process.env.LODESTA_BENCHMARK_TARGETS_FILE;
  if (!targetsFile) throw new Error("Provide --targets-file, explicit URLs, or LODESTA_BENCHMARK_TARGETS_FILE.");
  const targets = uniqueTargets(parseTargetFile(readFileSync(targetsFile, "utf8")).map((target) => ({
    ...target,
    expectedVertical: target.expectedVertical ?? parsed.expectedVertical
  })));
  if (!targets.length) throw new Error(`No http(s) URLs found in target file: ${targetsFile}`);
  return targets;
}

function parseTargetFile(raw: string): BenchmarkTarget[] {
  const targets: BenchmarkTarget[] = [];
  let expectedVertical: Vertical | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const comment = line.match(/^\s*#\s*(.+?)\s*$/)?.[1];
    if (comment) {
      expectedVertical = expectedVerticalFromComment(comment) ?? expectedVertical;
      continue;
    }
    for (const url of parseUrlList(line)) targets.push({ url, expectedVertical });
  }
  return targets;
}

function uniqueTargets(targets: BenchmarkTarget[]): BenchmarkTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.url)) return false;
    seen.add(target.url);
    return true;
  });
}

async function preflightTarget(target: BenchmarkTarget, options: { allowMultiLocation: boolean }): Promise<PreflightTargetResult> {
  const url = target.url;
  const reasons: PreflightTargetResult["reasons"] = [];
  let safeUrl: string | undefined;
  try {
    safeUrl = await assertPublicFetchUrl(url);
  } catch (error) {
    reasons.push({
      code: "invalid_or_unsafe_url",
      severity: "blocking",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const initialMarket = validateLaunchMarket({ url: safeUrl ?? url });
  if (!initialMarket.ok) {
    reasons.push({ code: "non_us_market", severity: "blocking", message: initialMarket.reason });
  }

  const crawl = safeUrl ? await crawlUrl(safeUrl, { maxInternalPages: 4 }) : emptyCrawl(url);
  if (!crawl.fetched || crawl.error || (crawl.status && crawl.status >= 400)) {
    reasons.push({
      code: "non_crawlable",
      severity: "blocking",
      message: crawl.error ?? `Crawler returned HTTP ${crawl.status ?? "unknown"}.`
    });
  }

  const postCrawlMarket = validateLaunchMarket({ url: safeUrl ?? url, crawl, facts: crawl.extractedFacts });
  if (!postCrawlMarket.ok) {
    reasons.push({ code: "non_us_market", severity: "blocking", message: postCrawlMarket.reason });
  }

  if (looksLikeDemoOrTemplate(crawl)) {
    reasons.push({
      code: "demo_or_template_target",
      severity: "blocking",
      message: "Target looks like a demo, template, showcase, preview, or platform sample rather than a real business site."
    });
  }

  if (!options.allowMultiLocation && multiLocationRisk(crawl)) {
    reasons.push({
      code: "multi_location_risk",
      severity: "blocking",
      message: "Crawler saw location-directory signals. Benchmark targets should be single-location unless an operator explicitly overrides."
    });
  }

  const facts = crawl.extractedFacts;
  const inferredVertical = inferVertical({
    url: safeUrl ?? url,
    title: crawl.title,
    description: crawl.metaDescription,
    name: facts.name,
    categories: facts.categories,
    services: facts.services
  });
  if (target.expectedVertical && inferredVertical !== target.expectedVertical) {
    reasons.push({
      code: "vertical_mismatch",
      severity: "blocking",
      message: `Target inferred as ${inferredVertical}, expected ${target.expectedVertical}.`
    });
  }
  if (!facts.name) {
    reasons.push({ code: "missing_name", severity: "blocking", message: "Crawler did not extract a business name." });
  }
  if (!facts.phone && !crawl.hasTelLink) {
    reasons.push({ code: "missing_phone", severity: "blocking", message: "Crawler did not extract a phone or tel: link." });
  }
  if (!facts.address) {
    reasons.push({ code: "missing_address", severity: "blocking", message: "Crawler did not extract a source-backed address." });
  }
  if (!facts.services.length && !facts.categories.length) {
    reasons.push({
      code: "missing_services",
      severity: "blocking",
      message: "Crawler did not extract service/category evidence."
    });
  }

  const host = hostFromUrl(crawl.finalUrl ?? safeUrl ?? url);
  return {
    url,
    finalUrl: crawl.finalUrl,
    host,
    expectedVertical: target.expectedVertical,
    inferredVertical,
    ok: !reasons.some((reason) => reason.severity === "blocking"),
    reasons,
    facts: {
      name: facts.name,
      phone: facts.phone,
      hasAddress: Boolean(facts.address),
      serviceCount: facts.services.length || facts.categories.length,
      country: facts.address?.country
    },
    crawl: {
      fetched: crawl.fetched,
      status: crawl.status,
      pages: crawl.pageSummaries.length,
      hasLocalBusinessSchema: crawl.hasLocalBusinessSchema,
      hasTelLink: crawl.hasTelLink
    }
  };
}

function looksLikeDemoOrTemplate(crawl: CrawlAssessment) {
  const host = hostFromUrl(crawl.finalUrl ?? crawl.url) ?? "";
  if (/\b(framer\.website|webflow\.io|wixsite\.com|squarespace\.com|hugedomains\.com)\b/i.test(host)) return true;
  const text = [
    crawl.url,
    crawl.finalUrl,
    crawl.title,
    crawl.metaDescription,
    ...crawl.pageSummaries.map((page) => `${page.url} ${page.title ?? ""} ${page.metaDescription ?? ""}`)
  ].join(" ").toLowerCase();
  return /\b(template|theme|showcase|preview site|demo site|cloneable|domain for sale|buy this domain)\b/.test(text);
}

function multiLocationRisk(crawl: CrawlAssessment) {
  const explicitLocationPaths = new Set(
    [...crawl.pageSummaries.map((page) => page.url), ...crawl.linkReferences.map((link) => link.href)]
      .map(pathnameForUrl)
      .map((path) => path?.match(/^\/locations?\/([^/]+)\/?$/i)?.[1].toLowerCase())
      .filter((slug): slug is string => Boolean(slug))
  );
  return explicitLocationPaths.size > 1;
}

function pathnameForUrl(value: string) {
  try {
    return new URL(value).pathname.replace(/\/{2,}/g, "/");
  } catch {
    return undefined;
  }
}

function emptyCrawl(url: string): CrawlAssessment {
  return {
    url,
    fetched: false,
    hasViewportMeta: false,
    hasLocalBusinessSchema: false,
    hasTelLink: false,
    robotsFound: false,
    sitemapFound: false,
    formCount: 0,
    imageCount: 0,
    imagesWithoutAlt: 0,
    internalLinkCount: 0,
    externalLinkCount: 0,
    jsonLdTypes: [],
    extractedFacts: {
      categories: [],
      services: [],
      serviceAreas: [],
      socialLinks: [],
      bookingLinks: [],
      orderingLinks: [],
      pressLinks: []
    },
    formReferences: [],
    linkReferences: [],
    assetReferences: [],
    sampledInternalPages: [],
    pageSummaries: [],
    score: { overall: 0, max: 0, percent: 0, grade: "poor", checks: [] },
    findings: []
  };
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const targets = targetList(parsed);
  const checkedAt = new Date().toISOString();
  const results: PreflightTargetResult[] = [];
  for (const target of targets) {
    const result = await preflightTarget(target, { allowMultiLocation: parsed.allowMultiLocation });
    results.push(result);
    console.log(JSON.stringify({ kind: "benchmark_preflight_target", checkedAt, ...result }));
  }
  const summary = {
    kind: "benchmark_preflight_summary",
    checkedAt,
    targetCount: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    inferredVerticals: verticalCounts(results),
    blockingReasons: reasonCounts(results, "blocking"),
    warningReasons: reasonCounts(results, "warning")
  };
  console.log(JSON.stringify(summary));

  const report = { summary, targets: results };
  if (parsed.reportPath) {
    mkdirSync(dirname(parsed.reportPath), { recursive: true });
    writeFileSync(parsed.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (summary.failed > 0) process.exitCode = 1;
}

function reasonCounts(results: PreflightTargetResult[], severity: "blocking" | "warning") {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const reason of result.reasons) {
      if (reason.severity !== severity) continue;
      counts[reason.code] = (counts[reason.code] ?? 0) + 1;
    }
  }
  return counts;
}

function verticalCounts(results: PreflightTargetResult[]) {
  const counts: Record<string, number> = {};
  for (const result of results) {
    const vertical = result.inferredVertical ?? "unknown";
    counts[vertical] = (counts[vertical] ?? 0) + 1;
  }
  return counts;
}

function expectedVerticalFromComment(comment: string): Vertical | undefined {
  const normalized = comment.toLowerCase();
  if (/\brestaurant|cafe|dining\b/.test(normalized)) return "restaurant";
  if (/\bdental|dentist\b/.test(normalized)) return "dental";
  if (/\bbarber|salon|hair|beauty\b/.test(normalized)) return "beauty_salon";
  if (/\bauto[_\s-]?services|automotive|tire|mechanic\b/.test(normalized)) return "auto_services";
  if (/\bauto[_\s-]?body|collision\b/.test(normalized)) return "auto_body";
  if (/\bhome services\b/.test(normalized)) return "home_services";
  return undefined;
}

function parseVertical(value: string | undefined, flag: string): Vertical {
  if (!value) throw new Error(`${flag} requires a value.`);
  const known: Vertical[] = [
    "general_local",
    "restaurant",
    "med_spa",
    "landscaping",
    "veterinary",
    "dental",
    "home_services",
    "auto_services",
    "auto_body",
    "beauty_salon",
    "law_firm",
    "fitness",
    "real_estate",
    "creative_studio"
  ];
  if (known.some((vertical) => vertical === value)) return value as Vertical;
  throw new Error(`${flag} must be one of: ${known.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

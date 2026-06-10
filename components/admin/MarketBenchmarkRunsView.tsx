import type { CSSProperties } from "react";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";

import styles from "./MarketBenchmarkRunsView.module.css";

export type MarketBenchmarkRunsViewProps = {
  searchParams: Promise<{ runId?: string }>;
  basePath?: string;
  screenshotPath?: string;
};

type CandidateStatus = "accepted" | "rejected" | "needs_review";

type Candidate = {
  id: string;
  name: string;
  status: CandidateStatus;
  normalizedWebsiteUrl?: string;
  rootDomain?: string;
  query?: string;
  types?: string[];
  reasons?: string[];
};

type CandidateFile = {
  accepted?: Candidate[];
  rejected?: Candidate[];
  needsReview?: Candidate[];
};

type DimensionKey =
  | "technicalHealth"
  | "mobileUsability"
  | "conversionClarity"
  | "localTrust"
  | "autoSpecificProof"
  | "visualSectionQuality";

type ScoresFile = {
  dimensions?: Record<DimensionKey, { score: number; checks?: Array<{ id: string; label: string; points: number; max: number; evidence: string }> }>;
  composites?: {
    defaultComposite?: number;
  };
};

type SectionsFile = {
  adapter?: string;
  notes?: string[];
  sections?: Array<{
    index: number;
    type: string;
    confidence: number;
    heading?: string;
    textSample?: string;
    ctaCount?: number;
    imageCount?: number;
    formCount?: number;
    linkCount?: number;
  }>;
};

type CrawlFile = {
  fetched?: boolean;
  status?: number;
  finalUrl?: string;
  title?: string;
  hasViewportMeta?: boolean;
  hasLocalBusinessSchema?: boolean;
  hasTelLink?: boolean;
  formCount?: number;
  imageCount?: number;
  imagesWithoutAlt?: number;
  extractedFacts?: {
    name?: string;
    phone?: string;
    address?: {
      street?: string;
      city?: string;
      region?: string;
      postalCode?: string;
    };
    services?: string[];
    reviewsSummary?: {
      rating?: number;
      count?: number;
    };
  };
};

type RenderFile = {
  adapter?: string;
  unavailableReason?: string;
  screenshots?: Array<{ viewport: string; path?: string; bytes?: number }>;
  metrics?: {
    bodyTextChars?: number;
    ctaCount?: number;
    formCount?: number;
    telLinkCount?: number;
    imageCount?: number;
    loadedImageCount?: number;
    horizontalOverflowPx?: number;
    minReadableTextFontSizePx?: number;
    minTextContrastRatio?: number;
  };
};

type RunSummary = {
  runId: string;
  path: string;
  updatedAt: string;
  hasReport: boolean;
  accepted: number;
  rejected: number;
  needsReview: number;
  scored: number;
};

type SiteSummary = {
  id: string;
  candidate?: Candidate;
  scores?: ScoresFile;
  sections?: SectionsFile;
  crawl?: CrawlFile;
  render?: RenderFile;
};

const benchmarkRoot = join(process.cwd(), ".data", "market-benchmarks", "austin-auto");
const dimensionLabels: Record<DimensionKey, string> = {
  technicalHealth: "Technical",
  mobileUsability: "Mobile",
  conversionClarity: "Conversion",
  localTrust: "Trust",
  autoSpecificProof: "Auto proof",
  visualSectionQuality: "Visual"
};
const dimensionOrder = Object.keys(dimensionLabels) as DimensionKey[];

export async function MarketBenchmarkRunsView({
  searchParams,
  basePath = "/admin/benchmark-sites",
  screenshotPath = "/admin/benchmark-sites/screenshot"
}: MarketBenchmarkRunsViewProps) {
  const params = await searchParams;
  const runs = await listRuns();
  const defaultRun = runs.find((run) => !run.runId.startsWith("fixture-") && run.scored > 0) ?? runs[0];
  const selectedRun = runs.find((run) => run.runId === params.runId) ?? defaultRun;
  const runDetails = selectedRun ? await readRunDetails(selectedRun) : undefined;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Evaluation snapshots</p>
          <h1>Evaluations</h1>
        </div>
        <div className={styles.headerMeta}>
          <span>{runs.length} saved snapshots</span>
          <span>{selectedRun?.scored ?? 0} scored sites</span>
        </div>
      </header>

      <section className={styles.layout} aria-label="Benchmark runs">
        <aside className={styles.sidebar}>
          <div className={styles.sidebarIntro}>
            <h2>Saved snapshots</h2>
            <p>Each snapshot is one crawl and scoring pass. Fixtures are test data; dated snapshots are real website captures.</p>
          </div>
          <div className={styles.runList}>
            {runs.map((run) => (
              <Link
                key={run.runId}
                href={`${basePath}?runId=${encodeURIComponent(run.runId)}`}
                className={run.runId === selectedRun?.runId ? styles.activeRun : undefined}
              >
                <strong>{run.runId}</strong>
                <span>{run.scored} scored / {run.accepted} accepted</span>
                <small className={isFixtureRun(run) ? styles.fixtureRun : styles.realRun}>{isFixtureRun(run) ? "Fixture" : "Real crawl"}</small>
              </Link>
            ))}
          </div>
        </aside>

        <div className={styles.content}>
          {selectedRun && runDetails ? (
            <>
              <RunOverview run={selectedRun} siteCount={runDetails.sites.length} />
              <RankedSites run={selectedRun} sites={runDetails.sites} screenshotPath={screenshotPath} />
            </>
          ) : (
            <section className={styles.empty}>
              <h2>No benchmark runs found</h2>
              <p>{benchmarkRoot}</p>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

function RunOverview({ run, siteCount }: { run: RunSummary; siteCount: number }) {
  return (
    <section className={styles.overview}>
      <div>
        <p>Selected snapshot</p>
        <h2>{run.runId}</h2>
        <span>{run.path}</span>
      </div>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{isFixtureRun(run) ? "Fixture" : "Real"}</dd>
        </div>
        <div>
          <dt>Accepted</dt>
          <dd>{run.accepted}</dd>
        </div>
        <div>
          <dt>Rejected</dt>
          <dd>{run.rejected}</dd>
        </div>
        <div>
          <dt>Needs Review</dt>
          <dd>{run.needsReview}</dd>
        </div>
        <div>
          <dt>Artifacts</dt>
          <dd>{siteCount}</dd>
        </div>
      </dl>
    </section>
  );
}

function RankedSites({ run, sites, screenshotPath }: { run: RunSummary; sites: SiteSummary[]; screenshotPath: string }) {
  const ranked = [...sites].sort((left, right) => composite(right) - composite(left));

  return (
    <section className={styles.sites}>
      <div className={styles.sectionHeader}>
        <div>
          <p>Ranked evidence</p>
          <h2>Reference sites</h2>
        </div>
        <span>{ranked.length} sites</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Preview</th>
              <th>Business</th>
              <th>Composite</th>
              {dimensionOrder.map((dimension) => (
                <th key={dimension}>{dimensionLabels[dimension]}</th>
              ))}
              <th>Sections</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((site, index) => (
              <tr key={site.id}>
                <td>{index + 1}</td>
                <td>
                  <SitePreview run={run} site={site} screenshotPath={screenshotPath} />
                </td>
                <td>
                  <strong>{site.candidate?.name ?? site.id}</strong>
                  {site.candidate?.normalizedWebsiteUrl ? (
                    <a href={site.candidate.normalizedWebsiteUrl} target="_blank" rel="noreferrer">
                      {hostLabel(site.candidate.normalizedWebsiteUrl)}
                    </a>
                  ) : null}
                  <small>{site.candidate?.query ?? site.id}</small>
                </td>
                <td>
                  <ScorePill value={composite(site)} />
                </td>
                {dimensionOrder.map((dimension) => (
                  <td key={dimension}>
                    <ScoreBar value={scoreFor(site, dimension)} />
                  </td>
                ))}
                <td>
                  <SectionChips sections={site.sections} />
                </td>
                <td>
                  <EvidenceSummary site={site} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.siteDetails}>
        {ranked.map((site) => (
          <SiteEvidence key={site.id} site={site} />
        ))}
      </div>
    </section>
  );
}

function SiteEvidence({ site }: { site: SiteSummary }) {
  const failedChecks = dimensionOrder
    .flatMap((dimension) =>
      (site.scores?.dimensions?.[dimension]?.checks ?? [])
        .filter((check) => check.points < check.max)
        .slice(0, 1)
        .map((check) => ({
          dimension,
          check
        }))
    )
    .slice(0, 5);

  return (
    <article id={evidenceAnchorId(site)} className={styles.evidencePanel}>
      <div className={styles.evidenceHeading}>
        <div>
          <p>{site.candidate?.rootDomain ?? site.id}</p>
          <h3>{site.candidate?.name ?? site.id}</h3>
        </div>
        <ScorePill value={composite(site)} />
      </div>

      <div className={styles.evidenceGrid}>
        <div>
          <h4>Crawl</h4>
          <dl className={styles.factList}>
            <div><dt>Status</dt><dd>{site.crawl?.status ?? "unknown"}</dd></div>
            <div><dt>Forms</dt><dd>{site.crawl?.formCount ?? 0}</dd></div>
            <div><dt>Images</dt><dd>{site.crawl?.imageCount ?? 0}</dd></div>
            <div><dt>Tel Link</dt><dd>{site.crawl?.hasTelLink ? "yes" : "no"}</dd></div>
            <div><dt>Schema</dt><dd>{site.crawl?.hasLocalBusinessSchema ? "yes" : "no"}</dd></div>
          </dl>
        </div>

        <div>
          <h4>Render</h4>
          <dl className={styles.factList}>
            <div><dt>Adapter</dt><dd>{site.render?.adapter ?? "none"}</dd></div>
            <div><dt>Text</dt><dd>{site.render?.metrics?.bodyTextChars ?? 0}</dd></div>
            <div><dt>CTAs</dt><dd>{site.render?.metrics?.ctaCount ?? 0}</dd></div>
            <div><dt>Overflow</dt><dd>{site.render?.metrics?.horizontalOverflowPx ?? "unknown"}</dd></div>
            <div><dt>Screens</dt><dd>{site.render?.screenshots?.length ?? 0}</dd></div>
          </dl>
        </div>

        <div>
          <h4>Sections</h4>
          <ol className={styles.sectionList}>
            {(site.sections?.sections ?? []).slice(0, 8).map((section) => (
              <li key={`${site.id}-${section.index}`}>
                <span>{section.type}</span>
                <strong>{Math.round((section.confidence ?? 0) * 100)}%</strong>
                <small>{section.heading || section.textSample || "No visible label"}</small>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h4>Review Focus</h4>
          <ul className={styles.checkList}>
            {failedChecks.length ? (
              failedChecks.map(({ dimension, check }) => (
                <li key={`${site.id}-${dimension}-${check.id}`}>
                  <span>{dimensionLabels[dimension]}</span>
                  <strong>{check.label}</strong>
                  <small>{check.evidence}</small>
                </li>
              ))
            ) : (
              <li>
                <span>Checks</span>
                <strong>No major automated gaps.</strong>
                <small>Human review should still confirm screenshots and source-site context.</small>
              </li>
            )}
          </ul>
        </div>
      </div>
    </article>
  );
}

function SitePreview({ run, site, screenshotPath }: { run: RunSummary; site: SiteSummary; screenshotPath: string }) {
  const screenshot = preferredScreenshot(site);
  const sourceUrl = site.candidate?.normalizedWebsiteUrl;

  return (
    <div className={styles.sitePreview}>
      {sourceUrl ? (
        <a className={styles.previewFrame} href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${site.candidate?.name ?? site.id}`}>
          {screenshot ? (
            <img
              className={styles.previewImage}
              src={screenshotUrl(run, site, screenshot.viewport, screenshotPath)}
              alt={`${site.candidate?.name ?? site.id} ${screenshot.viewport} screenshot`}
              loading="lazy"
            />
          ) : (
            <span className={styles.previewFallback}>
              <span className={styles.previewChrome} />
              <strong>{hostLabel(sourceUrl)}</strong>
              <small>No screenshot in this snapshot</small>
            </span>
          )}
        </a>
      ) : (
        <span className={styles.previewFrame}>
          <span className={styles.previewFallback}>
            <span className={styles.previewChrome} />
            <strong>{site.id}</strong>
            <small>No source URL</small>
          </span>
        </span>
      )}
      <div className={styles.previewActions}>
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Open site
          </a>
        ) : null}
        <a href={`#${evidenceAnchorId(site)}`}>Evidence</a>
      </div>
    </div>
  );
}

function ScorePill({ value }: { value: number }) {
  return <span className={scoreClass(value)}>{value}</span>;
}

function ScoreBar({ value }: { value: number }) {
  return (
    <span className={styles.scoreBar} style={{ "--score": value } as CSSProperties}>
      <span />
      <strong>{value}</strong>
    </span>
  );
}

function SectionChips({ sections }: { sections?: SectionsFile }) {
  const counts = new Map<string, number>();
  for (const section of sections?.sections ?? []) {
    counts.set(section.type, (counts.get(section.type) ?? 0) + 1);
  }
  const entries = Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (!entries.length) return <span className={styles.muted}>none</span>;
  return (
    <div className={styles.chips}>
      {entries.slice(0, 5).map(([type, count]) => (
        <span key={type}>{type.replace(/_/g, " ")} {count}</span>
      ))}
    </div>
  );
}

function EvidenceSummary({ site }: { site: SiteSummary }) {
  return (
    <div className={styles.evidenceMini}>
      <span>{site.crawl?.fetched ? "fetched" : "not fetched"}</span>
      <span>{site.sections?.adapter ?? "no sections"}</span>
      <span>{site.render?.screenshots?.length ?? 0} screenshots</span>
      <a href={`#${evidenceAnchorId(site)}`}>View evidence</a>
    </div>
  );
}

async function listRuns(): Promise<RunSummary[]> {
  const entries = await readdir(benchmarkRoot, { withFileTypes: true }).catch(() => []);
  const runs: RunSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const runPath = join(benchmarkRoot, runId);
    const candidates = await readJson<CandidateFile>(join(runPath, "candidates.json"));
    const runStat = await stat(runPath).catch(() => undefined);
    const scored = await countScoredSites(runPath);
    runs.push({
      runId,
      path: runPath,
      updatedAt: runStat?.mtime.toISOString() ?? runId,
      hasReport: Boolean(await stat(join(runPath, "report.md")).catch(() => undefined)),
      accepted: candidates?.accepted?.length ?? 0,
      rejected: candidates?.rejected?.length ?? 0,
      needsReview: candidates?.needsReview?.length ?? 0,
      scored
    });
  }
  return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function readRunDetails(run: RunSummary) {
  const candidates = await readJson<CandidateFile>(join(run.path, "candidates.json"));
  const candidateById = new Map((candidates?.accepted ?? []).map((candidate) => [candidate.id, candidate]));
  const siteRoot = join(run.path, "sites");
  const entries = await readdir(siteRoot, { withFileTypes: true }).catch(() => []);
  const sites: SiteSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sitePath = join(siteRoot, entry.name);
    sites.push({
      id: entry.name,
      candidate: candidateById.get(entry.name),
      scores: await readJson<ScoresFile>(join(sitePath, "scores.json")),
      sections: await readJson<SectionsFile>(join(sitePath, "sections.json")),
      crawl: await readJson<CrawlFile>(join(sitePath, "crawl.json")),
      render: await readJson<RenderFile>(join(sitePath, "render.json"))
    });
  }
  return { candidates, sites };
}

async function countScoredSites(runPath: string) {
  const siteRoot = join(runPath, "sites");
  const entries = await readdir(siteRoot, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await stat(join(siteRoot, entry.name, "scores.json")).catch(() => undefined)) count += 1;
  }
  return count;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function composite(site: SiteSummary) {
  return Math.round(site.scores?.composites?.defaultComposite ?? 0);
}

function scoreFor(site: SiteSummary, dimension: DimensionKey) {
  return Math.round(site.scores?.dimensions?.[dimension]?.score ?? 0);
}

function scoreClass(value: number) {
  if (value >= 80) return `${styles.scorePill} ${styles.scoreHigh}`;
  if (value >= 55) return `${styles.scorePill} ${styles.scoreMid}`;
  return `${styles.scorePill} ${styles.scoreLow}`;
}

function isFixtureRun(run: RunSummary) {
  return run.runId.startsWith("fixture-");
}

function preferredScreenshot(site: SiteSummary) {
  const screenshots = site.render?.screenshots ?? [];
  return (
    screenshots.find((screenshot) => screenshot.viewport === "desktop" && screenshot.path) ??
    screenshots.find((screenshot) => screenshot.path)
  );
}

function screenshotUrl(run: RunSummary, site: SiteSummary, viewport: string, screenshotPath = "/admin/benchmark-sites/screenshot") {
  const params = new URLSearchParams({
    runId: run.runId,
    siteId: site.id,
    viewport
  });
  return `${screenshotPath}?${params.toString()}`;
}

function evidenceAnchorId(site: SiteSummary) {
  return `site-evidence-${site.id.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function hostLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

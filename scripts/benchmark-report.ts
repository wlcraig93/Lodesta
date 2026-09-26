import "./load-env";

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ownerNotificationRepository } from "../packages/owner-notifications/repository";
import { sitePlatformRepository } from "../packages/platform-data";
import { siteMonitorRepository } from "../packages/site-monitoring/repository";

/*
 * One report per release for the development benchmark: CI suites, the
 * release, the latest owner-journey canary, recent authoring outcomes
 * (failed and abandoned runs included), monitoring and notification delivery,
 * against the recorded baseline of known failures. Read-only; it informs
 * engineering and never gates a publish.
 *
 *   LODESTA_REPOSITORY=supabase node --env-file=.env.local --import tsx scripts/benchmark-report.ts [--sha=<commit>] [--days=7]
 */
const run = promisify(execFile);
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const days = Number(argument("days") ?? 7);
const since = new Date(Date.now() - days * 24 * 60 * 60_000);

const gh = async <T>(path: string) => JSON.parse((await run("gh", ["api", path], { maxBuffer: 20_000_000 })).stdout) as T;
type WorkflowRun = { id: number; name: string; head_sha: string; status: string; conclusion: string | null; created_at: string; updated_at: string; html_url: string };
type Job = { name: string; conclusion: string | null; started_at: string; completed_at: string | null; steps?: Array<{ name: string; conclusion: string | null }> };

const releases = (await gh<{ workflow_runs: WorkflowRun[] }>("repos/{owner}/{repo}/actions/runs?per_page=50")).workflow_runs;
const release = argument("sha")
  ? releases.find((item) => item.name === "Production release" && item.head_sha.startsWith(argument("sha")!))
  : releases.find((item) => item.name === "Production release" && item.conclusion === "success");
const sha = argument("sha") ?? release?.head_sha;
if (!sha) throw new Error("No release found; pass --sha=<commit>.");
const ci = releases.find((item) => item.name === "Continuous integration" && item.head_sha.startsWith(sha));
const ciJobs = ci ? (await gh<{ jobs: Job[] }>(`repos/{owner}/{repo}/actions/runs/${ci.id}/jobs`)).jobs : [];
const suites = ciJobs.flatMap((job) => (job.steps ?? [])
  .filter((step) => /npm run|verify/.test(step.name))
  .map((step) => ({ job: job.name, suite: step.name.replace(/^Run /, ""), result: step.conclusion ?? "pending" })));

// Authoring outcomes: every run in the window counts, not only successes.
const runs = (await sitePlatformRepository.listRecentAgentRuns({ limit: 500 })).filter((item) => Date.parse(item.startedAt) >= since.getTime());
const byStatus: Record<string, number> = {};
const failures: Record<string, number> = {};
let cost = 0;
for (const item of runs) {
  byStatus[`${item.kind}:${item.status}`] = (byStatus[`${item.kind}:${item.status}`] ?? 0) + 1;
  if (item.status === "failed" || item.status === "cancelled") {
    const code = (item as { failureCode?: string }).failureCode ?? item.status;
    failures[code] = (failures[code] ?? 0) + 1;
  }
  cost += (item as { usage?: { costUsd?: number } }).usage?.costUsd ?? 0;
}

// Monitoring and email delivery on published sites.
const published = (await sitePlatformRepository.listSites()).filter((site) => site.publishedVersionId && (site.status === "active" || site.status === "offline"));
const monitoring = await Promise.all(published.map(async (site) => {
  const checks = [...await siteMonitorRepository.recent(site.id, "site", 300), ...await siteMonitorRepository.recent(site.id, "form", 100)]
    .filter((check) => Date.parse(check.checkedAt) >= since.getTime());
  return { slug: site.slug, checks: checks.length, failed: checks.filter((check) => !check.ok).length };
}));
const notifications = (await ownerNotificationRepository.list({ limit: 500 })).filter((item) => Date.parse(item.createdAt) >= since.getTime());
const delivery: Record<string, number> = {};
for (const item of notifications) {
  const key = item.status === "suppressed" ? `suppressed:${item.suppressedReason ?? "unknown"}` : item.status;
  delivery[key] = (delivery[key] ?? 0) + 1;
}

// The newest owner-journey canary on disk, if any.
const canaryRoot = join(".data", "owner-journey");
const canaryIds = (await readdir(canaryRoot).catch(() => [] as string[])).sort().reverse();
const canary = canaryIds[0]
  ? await readFile(join(canaryRoot, canaryIds[0], "result.json"), "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => undefined)
  : undefined;

const baseline = JSON.parse(await readFile(join("scripts", "benchmark", "baseline.json"), "utf8")) as { known: Array<{ id: string; phase: number; description: string }> };

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  release: { sha, workflow: release?.html_url, conclusion: release?.conclusion ?? "not released", deployedAt: release?.updated_at },
  ci: { run: ci?.html_url, conclusion: ci?.conclusion ?? "missing", suites },
  window: { days, since: since.toISOString() },
  authoring: { runs: runs.length, byStatus, failures, costUsd: Number(cost.toFixed(2)) },
  monitoring,
  notifications: delivery,
  canary: canary ? { id: canaryIds[0], status: canary.status, startedAt: canary.startedAt, origin: canary.origin, durationMs: canary.durationMs } : undefined,
  knownFailures: baseline.known
};

const directory = join(".data", "benchmark", sha.slice(0, 8));
await mkdir(directory, { recursive: true });
await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(directory, "report.md"), markdown(report));
console.log(JSON.stringify({ ok: true, report: join(directory, "report.md"), ci: report.ci.conclusion, runs: runs.length, knownFailures: baseline.known.length }));

function markdown(value: typeof report) {
  const lines = [
    `# Benchmark report: ${value.release.sha.slice(0, 8)}`,
    "",
    `Generated ${value.generatedAt}. Release: ${value.release.conclusion}${value.release.deployedAt ? ` (${value.release.deployedAt})` : ""}. CI: ${value.ci.conclusion}.`,
    "",
    "## CI suites",
    "",
    "| Job | Suite | Result |",
    "| --- | --- | --- |",
    ...value.ci.suites.map((suite) => `| ${suite.job} | ${suite.suite} | ${suite.result} |`),
    "",
    `## Authoring, last ${value.window.days} days`,
    "",
    `${value.authoring.runs} runs, $${value.authoring.costUsd}. By kind and status: ${Object.entries(value.authoring.byStatus).map(([key, count]) => `${key} ${count}`).join(", ") || "none"}.`,
    `Failures: ${Object.entries(value.authoring.failures).map(([key, count]) => `${key} ${count}`).join(", ") || "none"}.`,
    "",
    "## Monitoring",
    "",
    ...(value.monitoring.length ? value.monitoring.map((site) => `- ${site.slug}: ${site.checks} checks, ${site.failed} failed`) : ["- No published sites."]),
    "",
    "## Notifications",
    "",
    Object.entries(value.notifications).map(([key, count]) => `${key} ${count}`).join(", ") || "None.",
    "",
    "## Owner journey canary",
    "",
    value.canary ? `${value.canary.id}: ${String(value.canary.status)} against ${String(value.canary.origin)}` : "No canary run on disk.",
    "",
    "## Known failures (baseline)",
    "",
    ...value.knownFailures.map((item) => `- Phase ${item.phase}, ${item.id}: ${item.description}`),
    ""
  ];
  return lines.join("\n");
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasValidRecoveryWatchdogToken } from "../lib/auth-policy";
import { processProspectReportJobs } from "../lib/prospect-report-jobs";
import { automaticRecoveryLimit } from "../lib/recovery-watchdog";
import { shouldScheduleStartupRecovery, triggerStartupRecovery } from "../instrumentation";
import type { ProspectPresenceReportResult, ProspectReportJobV1, ProspectReportRecord } from "../packages/platform-operations";
import { siteAgentRecoveryStaleAfterMs } from "../packages/site-platform";
import { triggerRecoveryWatchdog } from "../workers/recovery-watchdog/src/index";

async function main() {
  assert.equal(automaticRecoveryLimit, 4, "automatic recovery batch limit drifted");
  assert.equal(siteAgentRecoveryStaleAfterMs, 45 * 60_000, "production stale threshold drifted");
  assert.equal(shouldScheduleStartupRecovery({
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
    NEXT_PHASE: "phase-production-build"
  }), false, "startup recovery can run during next build");
  assert.equal(shouldScheduleStartupRecovery({
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
    NEXT_PHASE: "phase-production-server"
  }), true, "production Node startup recovery is disabled");
  assert.equal(shouldScheduleStartupRecovery({ NEXT_RUNTIME: "edge", NODE_ENV: "production" }), false, "Edge startup scheduled Node recovery");
  assert.equal(shouldScheduleStartupRecovery({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development" }), false, "development startup duplicated the local worker");
  let startupRequest: { url: string; init?: RequestInit } | undefined;
  await triggerStartupRecovery({
    NODE_ENV: "production",
    LODESTA_APP_ORIGIN: "https://lodesta.example",
    LODESTA_RECOVERY_WATCHDOG_TOKEN: "watchdog-test-token"
  }, (async (input: RequestInfo | URL, init?: RequestInit) => {
    startupRequest = { url: String(input), init };
    return new Response(null, { status: 202 });
  }) as typeof fetch);
  assert.equal(startupRequest?.url, "https://lodesta.example/api/site-agent/maintenance");
  assert.equal(new Headers(startupRequest?.init?.headers).get("authorization"), "Bearer watchdog-test-token");
  assert.equal(new Headers(startupRequest?.init?.headers).get("x-lodesta-recovery-trigger"), "startup");
  assert.equal(startupRequest?.init?.body, undefined, "startup recovery sent a machine request body");

  const priorToken = process.env.LODESTA_RECOVERY_WATCHDOG_TOKEN;
  process.env.LODESTA_RECOVERY_WATCHDOG_TOKEN = "watchdog-test-token";
  assert.equal(hasValidRecoveryWatchdogToken(new Headers({ authorization: "Bearer watchdog-test-token" })), true);
  assert.equal(hasValidRecoveryWatchdogToken(new Headers({ authorization: "Bearer wrong-token" })), false);
  delete process.env.LODESTA_RECOVERY_WATCHDOG_TOKEN;
  assert.equal(hasValidRecoveryWatchdogToken(new Headers({ authorization: "Bearer watchdog-test-token" })), false, "unset token authorized a machine caller");
  if (priorToken === undefined) delete process.env.LODESTA_RECOVERY_WATCHDOG_TOKEN;
  else process.env.LODESTA_RECOVERY_WATCHDOG_TOKEN = priorToken;

  let watchdogRequest: { url: string; init?: RequestInit } | undefined;
  const status = await triggerRecoveryWatchdog({
    LODESTA_RECOVERY_WATCHDOG_URL: "https://lodesta.example/api/site-agent/maintenance",
    LODESTA_RECOVERY_WATCHDOG_TOKEN: "watchdog-test-token"
  }, (async (input: RequestInfo | URL, init?: RequestInit) => {
    watchdogRequest = { url: String(input), init };
    return new Response(null, { status: 202 });
  }) as typeof fetch);
  assert.equal(status, 202);
  assert.equal(watchdogRequest?.url, "https://lodesta.example/api/site-agent/maintenance");
  assert.equal(watchdogRequest?.init?.method, "POST");
  assert.equal(new Headers(watchdogRequest?.init?.headers).get("authorization"), "Bearer watchdog-test-token");
  assert.equal(new Headers(watchdogRequest?.init?.headers).get("x-lodesta-recovery-trigger"), "cloudflare_cron");
  assert.equal(watchdogRequest?.init?.body, undefined, "scheduled watchdog sent a machine request body");
  await assert.rejects(() => triggerRecoveryWatchdog({
    LODESTA_RECOVERY_WATCHDOG_URL: "https://lodesta.example/api/site-agent/maintenance",
    LODESTA_RECOVERY_WATCHDOG_TOKEN: "watchdog-test-token"
  }, (async () => new Response(null, { status: 401 })) as typeof fetch), /status 401/);

  const reports = new Map<string, ProspectReportRecord>();
  const jobs: ProspectReportJobV1[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const reportId = `prospect_report_${index}`;
    const now = new Date().toISOString();
    reports.set(reportId, {
      id: reportId,
      placeId: `place_${index}`,
      status: "queued",
      websiteKind: "no_website",
      createdAt: now,
      updatedAt: now
    });
    jobs.push({
      id: `prospect_job_${index}`,
      reportId,
      status: "queued",
      attempts: 1,
      maxAttempts: 2,
      runAfter: now,
      createdAt: now,
      updatedAt: now
    });
  }
  const completed: string[] = [];
  const results = await processProspectReportJobs({
    limit: 20,
    repository: {
      async claimNextProspectReportJob(workerId) {
        const job = jobs.find((candidate) => candidate.status === "queued") ?? null;
        if (job) {
          job.status = "running";
          job.lockedBy = workerId;
        }
        return job;
      },
      async getProspectReport(reportId) { return reports.get(reportId) ?? null; },
      async updateProspectReport(input) {
        const report = reports.get(input.reportId);
        if (!report) return null;
        Object.assign(report, input, { updatedAt: new Date().toISOString() });
        return report;
      },
      async completeProspectReportJob(jobId) {
        const job = jobs.find((candidate) => candidate.id === jobId);
        if (job) job.status = "completed";
        completed.push(jobId);
      },
      async failProspectReportJob() { throw new Error("unexpected prospect failure"); }
    },
    runReport: async () => ({}) as ProspectPresenceReportResult
  });
  assert.equal(results.length, 4, "automatic prospect recovery exceeded its four-job bound");
  assert.equal(completed.length, 4);
  assert.equal(jobs.filter((job) => job.status === "queued").length, 1);

  const runner = readFileSync("workers/runner.ts", "utf8");
  const workflow = readFileSync("packages/site-platform/workflow.ts", "utf8");
  const maintenance = readFileSync("app/api/site-agent/maintenance/route.ts", "utf8");
  assert(runner.includes("localRecoveryStaleAfterMs = 15 * 60_000"), "local worker lost its explicit fifteen-minute threshold");
  assert(workflow.includes("input.staleAfterMs ?? siteAgentRecoveryStaleAfterMs"), "workflow default does not use the conservative threshold");
  assert(maintenance.includes("body.trim() !== \"\"") && maintenance.includes("status: 202"), "machine maintenance path is not strict and asynchronous");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: ["startup_guard", "machine_token", "scheduled_worker", "prospect_batch", "stale_thresholds"]
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

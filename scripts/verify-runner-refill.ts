import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fixture = await mkdtemp(join(tmpdir(), "lodesta-runner-refill-"));
const tsxLoader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;

async function main() {
  try {
    await Promise.all([
      mkdir(join(fixture, "workers"), { recursive: true }),
      mkdir(join(fixture, "scripts"), { recursive: true }),
      mkdir(join(fixture, "packages/site-platform"), { recursive: true }),
      mkdir(join(fixture, "packages/platform-data"), { recursive: true }),
      mkdir(join(fixture, "packages/website-assessment"), { recursive: true })
    ]);
    await copyFile("workers/runner.ts", join(fixture, "workers/runner.ts"));
    await Promise.all([
      writeFile(join(fixture, "scripts/load-env.ts"), "// test fixture\n"),
      writeFile(join(fixture, "packages/platform-data/index.ts"), repositoryStub),
      writeFile(join(fixture, "packages/site-platform/workflow.ts"), workflowStub),
      writeFile(join(fixture, "packages/website-assessment/jobs.ts"), assessmentStub)
    ]);

    const late = await run("late");
    assert.equal(late.code, 0, late.stderr);
    assert.match(late.stdout, /B_STARTED_AFTER_A=false/);
    assertOutcomes(late.stdout, ["A", "B"]);

    const transientClaim = await run("claim-transient");
    assert.equal(transientClaim.code, 0, transientClaim.stderr);
    assert.match(transientClaim.stderr, /worker_claim_transient_failure/);
    assert.match(transientClaim.stdout, /CLAIM_TRANSIENT[\s\S]*B_STARTED_AFTER_A=false/);
    assertOutcomes(transientClaim.stdout, ["A", "B"]);
    const claimTimes = [...transientClaim.stdout.matchAll(/CLAIM:(\d+):(\d+)/g)].map((match) => ({ claim: Number(match[1]), ms: Number(match[2]) }));
    const secondClaim = claimTimes.find((entry) => entry.claim === 2)?.ms;
    const thirdClaim = claimTimes.find((entry) => entry.claim === 3)?.ms;
    assert(secondClaim !== undefined && thirdClaim !== undefined && thirdClaim - secondClaim >= 200,
      `transient claim bypassed bounded backoff: ${transientClaim.stdout}`);

    const fatalClaim = await run("claim-fatal");
    assert.equal(fatalClaim.code, 1);
    assert.match(fatalClaim.stderr, /worker_claim_failure/);
    assert.match(fatalClaim.stdout, /CLAIM_FATAL[\s\S]*A_FINISHED/);
    assertOutcomes(fatalClaim.stdout, ["A"]);
    assert.doesNotMatch(fatalClaim.stdout, /START:B/);

    const transientTask = await run("task-transient");
    assert.equal(transientTask.code, 0, transientTask.stderr);
    assert.match(transientTask.stdout, /TASK_TRANSIENT[\s\S]*A_FINISHED/);
    assert.match(transientTask.stderr, /worker_execution_transient_failure/);
    assertOutcomes(transientTask.stdout, ["A"]);

    const fatalTask = await run("task-fatal");
    assert.equal(fatalTask.code, 1);
    assert.match(fatalTask.stdout, /TASK_FATAL[\s\S]*A_FINISHED/);
    assert.match(fatalTask.stderr, /worker_execution_failure/);
    assertOutcomes(fatalTask.stdout, ["A"]);

    const transientAssessment = await run("assessment-transient");
    assert.equal(transientAssessment.code, 0, transientAssessment.stderr);
    assert.match(transientAssessment.stderr, /worker_assessment_transient_failure/);
    const assessmentTimes = [...transientAssessment.stdout.matchAll(/ASSESSMENT:(\d+):(\d+)/g)].map((match) => Number(match[2]));
    assert.equal(assessmentTimes.length, 2);
    assert(assessmentTimes[1]! - assessmentTimes[0]! >= 200, "transient assessment bypassed bounded backoff");

    const fatalAssessment = await run("assessment-fatal");
    assert.equal(fatalAssessment.code, 1);
    assert.match(fatalAssessment.stderr, /worker_assessment_failure/);
    assert.equal((fatalAssessment.stdout.match(/ASSESSMENT/g) ?? []).length, 1);

    const burst = await run("burst");
    assert.equal(burst.code, 0, burst.stderr);
    const active = [...burst.stdout.matchAll(/START:[A-E]:ACTIVE=(\d+)/g)].map((match) => Number(match[1]));
    assert.equal(active.length, 5);
    assert(Math.max(...active) <= 4, `refill exceeded four slots: ${burst.stdout}`);
    assert.match(burst.stdout, /FINISH:A[\s\S]*START:E:ACTIVE=4/);
    assertOutcomes(burst.stdout, ["A", "B", "C", "D", "E"]);

    const activeShutdown = await run("active-shutdown");
    assert.equal(activeShutdown.code, 0, activeShutdown.stderr);
    assert.match(activeShutdown.stdout, /SIGTERM_ACTIVE[\s\S]*A_FINISHED/);
    assert.equal((activeShutdown.stdout.match(/CLAIM:/g) ?? []).length, 2);
    assert.doesNotMatch(activeShutdown.stdout, /ASSESSMENT/);
    assertOutcomes(activeShutdown.stdout, ["A"]);

    const pendingClaim = await run("pending-claim-shutdown");
    assert.equal(pendingClaim.code, 0, pendingClaim.stderr);
    assert.match(pendingClaim.stdout, /SIGTERM_PENDING_CLAIM[\s\S]*CLAIM_AFTER_SIGNAL[\s\S]*START:A[\s\S]*"id":"A","status":"succeeded"/);
    assert.equal((pendingClaim.stdout.match(/CLAIM:/g) ?? []).length, 1);
    assert.doesNotMatch(pendingClaim.stdout, /ASSESSMENT/);

    process.stdout.write("Tracked runner spare-slot refill, fatal drain, backoff, and shutdown behavior verified.\n");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function run(scenario: string) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, "workers/runner.ts", "work", "250", "4"], {
      cwd: fixture,
      env: { NODE_ENV: "test", NODE_NO_WARNINGS: "1", SCRATCH_SCENARIO: scenario },
      stdio: ["ignore", "pipe", "pipe"] as const
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 5_000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error: Error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code: number | null) => {
      clearTimeout(timeout);
      if (timedOut) reject(new Error(`Runner fixture timed out for ${scenario}: ${stdout}\n${stderr}`));
      else resolveResult({ code, stdout, stderr });
    });
  });
}

function assertOutcomes(stdout: string, ids: string[]) {
  for (const id of ids) {
    assert.match(stdout, new RegExp(`\\"id\\":\\"${id}\\",\\"status\\":\\"succeeded\\"`), `missing ${id} outcome`);
  }
}

const repositoryStub = `
const scenario = process.env.SCRATCH_SCENARIO;
let claims = 0;
let bReady = false;
let bClaimed = false;
const started = Date.now();
setTimeout(() => { bReady = true; }, 10);
export const sitePlatformRepository = { async claimNextAgentRun() {
  claims += 1;
  process.stdout.write(\`CLAIM:\${claims}:\${Date.now() - started}\\n\`);
  if (scenario === "pending-claim-shutdown") {
    if (claims !== 1) return undefined;
    setTimeout(() => { process.stdout.write("SIGTERM_PENDING_CLAIM\\n"); process.emit("SIGTERM"); }, 20);
    await new Promise((resolve) => setTimeout(resolve, 80));
    process.stdout.write("CLAIM_AFTER_SIGNAL\\n");
    return { id: "A", status: "running" };
  }
  if (scenario === "assessment-transient" || scenario === "assessment-fatal") return undefined;
  if (scenario === "burst") {
    const id = ["A", "B", "C", "D", "E"][claims - 1];
    return id ? { id, status: "running" } : undefined;
  }
  if (claims === 1) return { id: "A", status: "running" };
  if (scenario === "claim-transient" && claims === 2) {
    process.stdout.write("CLAIM_TRANSIENT\\n");
    throw new Error("ECONNRESET");
  }
  if (scenario === "claim-fatal" && claims === 2) {
    process.stdout.write("CLAIM_FATAL\\n");
    throw new Error("fatal_claim");
  }
  if ((scenario === "task-transient" || scenario === "task-fatal") && claims === 2) return { id: "B", status: "running" };
  if ((scenario === "late" || scenario === "claim-transient") && bReady && !bClaimed && claims >= 3) { bClaimed = true; return { id: "B", status: "running" }; }
  return undefined;
} };
`;

const workflowStub = `
const scenario = process.env.SCRATCH_SCENARIO;
let aDone = false;
let active = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const siteAuthoringWorkflow = { async executeRunAndFinalize(id) {
  active += 1;
  process.stdout.write(\`START:\${id}:ACTIVE=\${active}\\n\`);
  try {
    if (id === "B" && scenario === "task-transient") { process.stdout.write("TASK_TRANSIENT\\n"); throw new Error("ECONNRESET"); }
    if (id === "B" && scenario === "task-fatal") { process.stdout.write("TASK_FATAL\\n"); throw new Error("fatal_task"); }
    if (id === "A" && scenario === "task-transient") setTimeout(() => process.emit("SIGTERM"), 450);
    if (id === "A" && scenario === "active-shutdown") setTimeout(() => { process.stdout.write("SIGTERM_ACTIVE\\n"); process.emit("SIGTERM"); }, 20);
    if (id === "B" && (scenario === "late" || scenario === "claim-transient")) { process.stdout.write(\`B_STARTED_AFTER_A=\${aDone}\\n\`); setTimeout(() => process.emit("SIGTERM"), 0); }
    if (id === "E" && scenario === "burst") setTimeout(() => process.emit("SIGTERM"), 0);
    await delay(scenario === "burst" && id === "A" ? 80 : scenario === "pending-claim-shutdown" ? 80 : 350);
    if (id === "A") { aDone = true; process.stdout.write("A_FINISHED\\n"); }
    process.stdout.write(\`FINISH:\${id}\\n\`);
    return { id, status: "succeeded" };
  } finally { active -= 1; }
} };
`;

const assessmentStub = `
const scenario = process.env.SCRATCH_SCENARIO;
let attempts = 0;
const started = Date.now();
export async function processNextWebsiteAssessmentJob() {
  attempts += 1;
  process.stdout.write(\`ASSESSMENT:\${attempts}:\${Date.now() - started}\\n\`);
  if (scenario === "assessment-transient" && attempts === 1) throw new Error("ECONNRESET");
  if (scenario === "assessment-fatal" && attempts === 1) throw new Error("fatal_assessment");
  if (scenario === "assessment-transient" && attempts === 2) process.emit("SIGTERM");
  return null;
}
`;

await main();

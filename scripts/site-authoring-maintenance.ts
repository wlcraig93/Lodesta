import "./load-env";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "../packages/business-data";
import { sitePlatformRepository } from "../packages/platform-data";

const task = "site_authoring_maintenance";
const leasePath = resolve(process.cwd(), ".data/maintenance/site-authoring-maintenance.json");
const command = process.argv[2];
const minutes = parseMinutes(process.argv.slice(3));
const draining = process.argv.includes("--draining");

if (command === "acquire") {
  if (!draining) await assertDrained();
  const now = new Date();
  const leaseTokenHash = configuredLeaseOwnerHash() ?? sha256(randomBytes(32));
  const leaseUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
  if (!await sitePlatformRepository.acquireMaintenanceLease(task, leaseTokenHash, now.toISOString(), leaseUntil)) {
    throw new Error("The site-authoring maintenance lease is already active.");
  }
  try {
    if (!draining) await assertDrained();
    await mkdir(dirname(leasePath), { recursive: true });
    await writeFile(leasePath, `${JSON.stringify({ schemaVersion: "site-authoring-maintenance", task, leaseTokenHash, leaseUntil }, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    await sitePlatformRepository.releaseMaintenanceLease(task, leaseTokenHash);
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, action: "acquire", task, draining, leaseUntil, leasePath })}\n`);
} else if (command === "wait-active") {
  const lease = await readLease();
  if (!await sitePlatformRepository.isMaintenanceLeaseActive(task, new Date().toISOString())) {
    throw new Error("The site-authoring maintenance lease is not active.");
  }
  const timeoutMinutes = parseTimeoutMinutes(process.argv.slice(3));
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let active = await activeWork();
  while (active.runningRuns.length) {
    if (!await sitePlatformRepository.isMaintenanceLeaseActive(task, new Date().toISOString())) {
      throw new Error("The site-authoring maintenance lease expired while waiting for active work.");
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for active authoring: ${active.runningRuns.length} run(s).`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
    active = await activeWork();
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action: "wait-active",
    task,
    leaseUntil: lease.leaseUntil,
    runningRuns: 0
  })}\n`);
} else if (command === "renew") {
  const lease = await readLease();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
  if (!await sitePlatformRepository.renewMaintenanceLease(task, lease.leaseTokenHash, now.toISOString(), leaseUntil)) {
    throw new Error("The site-authoring maintenance lease could not be renewed; abort the maintenance window.");
  }
  await writeFile(leasePath, `${JSON.stringify({ ...lease, leaseUntil }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, action: "renew", task, leaseUntil })}\n`);
} else if (command === "release") {
  const lease = await readLease();
  if (!await sitePlatformRepository.releaseMaintenanceLease(task, lease.leaseTokenHash)) {
    throw new Error("The site-authoring maintenance lease was not owned or had already expired/replaced; local lease state was retained.");
  }
  await unlink(leasePath);
  process.stdout.write(`${JSON.stringify({ ok: true, action: "release", task })}\n`);
} else if (command === "status") {
  const lease = await readLease().catch(() => undefined);
  const active = await sitePlatformRepository.isMaintenanceLeaseActive(task, new Date().toISOString());
  process.stdout.write(`${JSON.stringify({ ok: active, action: "status", task, active, leaseUntil: lease?.leaseUntil, leasePath })}\n`);
  if (!active) process.exitCode = 2;
} else {
  throw new Error("Usage: maintenance:site-authoring -- <acquire|wait-active|renew|status|release> [--minutes=30] [--draining] [--timeout-minutes=75]");
}

async function assertDrained() {
  const running = await sitePlatformRepository.listRecentAgentRuns({ status: "running", limit: 5 });
  const queued = await sitePlatformRepository.listRecentAgentRuns({ status: "queued", limit: 5 });
  if (running.length || queued.length) {
    throw new Error(`Site-authoring maintenance requires a drained platform; found ${running.length} running and ${queued.length} queued run(s).`);
  }
}

async function activeWork() {
  const runningRuns = await sitePlatformRepository.listRecentAgentRuns({ status: "running", limit: 1000 });
  return { runningRuns };
}

async function readLease() {
  const configured = configuredLeaseOwnerHash();
  if (configured) {
    const retained = await readFile(leasePath, "utf8").then((source) => JSON.parse(source) as Record<string, unknown>).catch(() => undefined);
    return {
      schemaVersion: "site-authoring-maintenance" as const,
      task,
      leaseTokenHash: configured,
      leaseUntil: typeof retained?.leaseUntil === "string" ? retained.leaseUntil : new Date(0).toISOString()
    };
  }
  const value = JSON.parse(await readFile(leasePath, "utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== "site-authoring-maintenance" || value.task !== task
    || typeof value.leaseTokenHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.leaseTokenHash)
    || typeof value.leaseUntil !== "string" || !Number.isFinite(Date.parse(value.leaseUntil))) {
    throw new Error("Local site-authoring maintenance record is invalid.");
  }
  return value as { schemaVersion: "site-authoring-maintenance"; task: string; leaseTokenHash: string; leaseUntil: string };
}

function configuredLeaseOwnerHash() {
  const owner = process.env.LODESTA_MAINTENANCE_LEASE_OWNER?.trim();
  return owner ? sha256(owner) : undefined;
}

function parseMinutes(args: string[]) {
  const value = args.find((arg) => arg.startsWith("--minutes="))?.slice("--minutes=".length) ?? "30";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 120) throw new Error("--minutes must be an integer between 5 and 120.");
  return parsed;
}

function parseTimeoutMinutes(args: string[]) {
  const value = args.find((arg) => arg.startsWith("--timeout-minutes="))?.slice("--timeout-minutes=".length) ?? "75";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) throw new Error("--timeout-minutes must be an integer between 1 and 120.");
  return parsed;
}

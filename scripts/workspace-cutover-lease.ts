import "./load-env";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "../packages/business-data";
import { sitePlatformRepository } from "../packages/platform-data";

const task = "workspace_storage_cutover";
const leasePath = resolve(process.cwd(), ".data/maintenance/workspace-storage-cutover-lease.json");
const command = process.argv[2];
const minutes = parseMinutes(process.argv.slice(3));

if (command === "acquire") {
  await assertDrained();
  const now = new Date();
  const leaseTokenHash = sha256(randomBytes(32));
  const leaseUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
  if (!await sitePlatformRepository.acquireMaintenanceLease(task, leaseTokenHash, now.toISOString(), leaseUntil)) {
    throw new Error("The workspace-storage cutover lease is already active.");
  }
  try {
    await assertDrained();
    await mkdir(dirname(leasePath), { recursive: true });
    await writeFile(leasePath, `${JSON.stringify({ schemaVersion: "workspace-cutover-lease-v1", task, leaseTokenHash, leaseUntil }, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    await sitePlatformRepository.releaseMaintenanceLease(task, leaseTokenHash);
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, action: "acquire", task, leaseUntil, leasePath })}\n`);
} else if (command === "renew") {
  const lease = await readLease();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
  if (!await sitePlatformRepository.renewMaintenanceLease(task, lease.leaseTokenHash, now.toISOString(), leaseUntil)) {
    throw new Error("The workspace-storage cutover lease could not be renewed; abort the maintenance window.");
  }
  await writeFile(leasePath, `${JSON.stringify({ ...lease, leaseUntil }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, action: "renew", task, leaseUntil })}\n`);
} else if (command === "release") {
  const lease = await readLease();
  if (!await sitePlatformRepository.releaseMaintenanceLease(task, lease.leaseTokenHash)) {
    throw new Error("The workspace-storage cutover lease was not owned or had already expired/replaced; local lease state was retained.");
  }
  await unlink(leasePath);
  process.stdout.write(`${JSON.stringify({ ok: true, action: "release", task })}\n`);
} else if (command === "status") {
  const lease = await readLease().catch(() => undefined);
  const active = await sitePlatformRepository.isMaintenanceLeaseActive(task, new Date().toISOString());
  process.stdout.write(`${JSON.stringify({ ok: active, action: "status", task, active, leaseUntil: lease?.leaseUntil, leasePath })}\n`);
  if (!active) process.exitCode = 2;
} else {
  throw new Error("Usage: maintenance:workspace-cutover -- <acquire|renew|status|release> [--minutes=30]");
}

async function assertDrained() {
  const running = await sitePlatformRepository.listRecentAgentRuns({ status: "running", limit: 5 });
  const queued = await sitePlatformRepository.listRecentAgentRuns({ status: "queued", limit: 5 });
  if (running.length || queued.length) {
    throw new Error(`Workspace-storage cutover requires a drained platform; found ${running.length} running and ${queued.length} queued run(s).`);
  }
}

async function readLease() {
  const value = JSON.parse(await readFile(leasePath, "utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== "workspace-cutover-lease-v1" || value.task !== task
    || typeof value.leaseTokenHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.leaseTokenHash)
    || typeof value.leaseUntil !== "string" || !Number.isFinite(Date.parse(value.leaseUntil))) {
    throw new Error("Local workspace cutover lease record is invalid.");
  }
  return value as { schemaVersion: "workspace-cutover-lease-v1"; task: string; leaseTokenHash: string; leaseUntil: string };
}

function parseMinutes(args: string[]) {
  const value = args.find((arg) => arg.startsWith("--minutes="))?.slice("--minutes=".length) ?? "30";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 120) throw new Error("--minutes must be an integer between 5 and 120.");
  return parsed;
}

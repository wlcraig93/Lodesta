import "./load-env";

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { sitePlatformRepository } from "../packages/platform-data";
import {
  siteSandboxControlSchema,
  siteSandboxDeploymentSchema,
  siteSandboxManifestSchema,
  type SiteSandboxControl,
  type SiteSandboxDeployment,
  type SiteSandboxSlot
} from "../packages/site-contracts";
import {
  configuredSiteSandboxRuntimeForDeployment,
  developmentSandboxDeploymentMatchesCheckout,
  readDevelopmentSandboxReceipt
} from "../packages/site-sandbox";

const root = process.cwd();
const deploymentLock = await acquireDevelopmentDeploymentLock(root);
process.once("exit", deploymentLock.release);
const environment = { ...process.env, LODESTA_DEV_SANDBOX: "1" } satisfies NodeJS.ProcessEnv;
const control = await sitePlatformRepository.getSandboxControl();
const activeDeployment = control
  ? await sitePlatformRepository.getSandboxDeployment(control.activeDeploymentId)
  : undefined;

if (control && !activeDeployment) throw new Error("The active nonproduction sandbox deployment is missing.");

if (activeDeployment && await deploymentIsCurrent(activeDeployment)) {
  process.stdout.write(`[dev] ${activeDeployment.slot} sandbox deployment is current\n`);
  process.exit(0);
}

const targetSlot: SiteSandboxSlot = activeDeployment?.slot === "blue" ? "green" : "blue";
await assertSlotAvailable(control, targetSlot);
process.stdout.write(`[dev] refreshing inactive ${targetSlot} sandbox deployment\n`);
await run(process.execPath, [
  "--import", "tsx", "scripts/deploy-site-sandbox-dev.ts", `--slot=${targetSlot}`, "--quiet"
], environment);

const receipt = readDevelopmentSandboxReceipt(targetSlot, root);
const deployment = siteSandboxDeploymentSchema.parse({
  schemaVersion: 1,
  id: deploymentId({
    slot: targetSlot,
    workerVersionId: receipt.workerVersionId,
    releaseSha: receipt.releaseSha,
    imageDigest: receipt.imageDigest,
    manifest: receipt.sandboxManifest
  }),
  slot: targetSlot,
  workerVersionId: receipt.workerVersionId,
  releaseSha: receipt.releaseSha,
  imageDigest: receipt.imageDigest,
  credentialSlot: targetSlot,
  manifest: receipt.sandboxManifest,
  createdAt: receipt.deployedAt
});
await sitePlatformRepository.saveSandboxDeployment(deployment);

if (!control) {
  assert.equal(targetSlot, "blue", "The first nonproduction sandbox deployment must initialize blue.");
  await sitePlatformRepository.saveSandboxControl(siteSandboxControlSchema.parse({
    schemaVersion: 1,
    id: "production",
    blueDeploymentId: deployment.id,
    activeDeploymentId: deployment.id,
    updatedAt: new Date().toISOString()
  }));
} else {
  const assigned = siteSandboxControlSchema.parse({
    ...control,
    ...(targetSlot === "blue"
      ? { blueDeploymentId: deployment.id }
      : { greenDeploymentId: deployment.id }),
    updatedAt: new Date().toISOString()
  });
  await sitePlatformRepository.saveSandboxControl(assigned);
  await assertDeploymentHealth(deployment);
  await sitePlatformRepository.saveSandboxControl(siteSandboxControlSchema.parse({
    ...assigned,
    activeDeploymentId: deployment.id,
    updatedAt: new Date().toISOString()
  }));
}

await assertDeploymentHealth(deployment);
process.stdout.write(`[dev] promoted ${targetSlot} sandbox deployment ${deployment.id}\n`);

async function deploymentIsCurrent(deployment: SiteSandboxDeployment) {
  try {
    if (!await developmentSandboxDeploymentMatchesCheckout(deployment, root)) return false;
    await assertDeploymentHealth(deployment);
    return true;
  } catch {
    return false;
  }
}

async function assertDeploymentHealth(deployment: SiteSandboxDeployment) {
  const runtime = configuredSiteSandboxRuntimeForDeployment(deployment, environment, root);
  const response = await fetch(new URL("/health", runtime.url), {
    headers: { authorization: `Bearer ${runtime.token}` },
    signal: AbortSignal.timeout(15_000)
  });
  assert(response.ok, `${deployment.slot} sandbox health returned ${response.status}.`);
  const payload = await response.json() as { sandboxManifest?: unknown };
  assert.deepEqual(
    siteSandboxManifestSchema.parse(payload.sandboxManifest),
    deployment.manifest,
    `${deployment.slot} sandbox health differs from its immutable deployment record.`
  );
}

async function assertSlotAvailable(controlValue: SiteSandboxControl | undefined, slot: SiteSandboxSlot) {
  if (!controlValue) return;
  const currentId = slot === "blue" ? controlValue.blueDeploymentId : controlValue.greenDeploymentId;
  assert(controlValue.activeDeploymentId !== currentId, `${slot} is active and cannot be reused.`);
  if (!currentId) return;
  const drain = await sitePlatformRepository.getSandboxDeploymentDrain(currentId);
  assert.equal(drain.runningRunIds.length, 0, `${slot} still has running execution pins: ${drain.runningRunIds.join(", ")}`);
  assert.equal(drain.liveSessionIds.length, 0, `${slot} still has live sandbox sessions: ${drain.liveSessionIds.join(", ")}`);
}

function deploymentId(value: unknown) {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return `sandbox_deployment_${digest.slice(0, 32)}`;
}

function sameManifest(
  left: SiteSandboxDeployment["manifest"],
  right: SiteSandboxDeployment["manifest"]
) {
  return left.kind === right.kind
    && left.apiIdentity === right.apiIdentity
    && left.storageIdentity === right.storageIdentity
    && left.durableObjectIdentity === right.durableObjectIdentity
    && left.artifactContractIdentity === right.artifactContractIdentity
    && left.toolchainIdentity === right.toolchainIdentity
    && left.sourcePolicyIdentity === right.sourcePolicyIdentity;
}

async function run(command: string, args: string[], childEnvironment: NodeJS.ProcessEnv) {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: childEnvironment,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Development sandbox refresh failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

async function acquireDevelopmentDeploymentLock(repositoryRoot: string) {
  const lockDirectory = resolve(repositoryRoot, ".data/site-sandbox-dev-deployment.lock");
  const ownerPath = resolve(lockDirectory, "owner.json");
  const token = `${process.pid}:${Date.now()}:${randomUUID()}`;
  const deadline = Date.now() + 20 * 60_000;

  while (true) {
    try {
      mkdirSync(lockDirectory);
      writeFileSync(ownerPath, `${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          try {
            const retained = JSON.parse(readFileSync(ownerPath, "utf8")) as { token?: unknown };
            if (retained.token === token) rmSync(lockDirectory, { recursive: true });
          } catch {
            // A successor or operator may already have removed the lock.
          }
        }
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (developmentDeploymentLockIsStale(lockDirectory, ownerPath)) {
        rmSync(lockDirectory, { recursive: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for another local sandbox deployment to finish.");
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
}

function developmentDeploymentLockIsStale(lockDirectory: string, ownerPath: string) {
  try {
    const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { pid?: unknown; createdAt?: unknown };
    if (typeof owner.pid !== "number" || !Number.isInteger(owner.pid) || owner.pid < 1) {
      return Date.now() - statSync(lockDirectory).mtimeMs > 2 * 60_000;
    }
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      return isMissingProcess(error);
    }
  } catch {
    return Date.now() - statSync(lockDirectory).mtimeMs > 2 * 60_000;
  }
}

function isAlreadyExists(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissingProcess(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

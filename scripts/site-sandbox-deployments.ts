import "./load-env";

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { sitePlatformRepository } from "../packages/platform-data";
import {
  expectedSiteSandboxManifest,
  siteSandboxControlSchema,
  siteSandboxDeploymentSchema,
  siteSandboxManifestSchema,
  siteSandboxSlotSchema,
  type SiteSandboxControl,
  type SiteSandboxDeployment,
  type SiteSandboxManifest,
  type SiteSandboxSlot
} from "../packages/site-contracts";
import {
  configuredSiteSandboxRuntimeForDeployment,
  configuredSiteSandboxRuntimeForSlot
} from "../packages/site-sandbox";

const command = process.argv[2];
assert(command, "Usage: site-sandbox-deployments <status|assert-slot-available|register|promote|rollback> [options]");

if (command === "status") {
  const control = await sitePlatformRepository.getSandboxControl();
  process.stdout.write(`${JSON.stringify(await controlStatus(control), null, 2)}\n`);
} else if (command === "assert-slot-available") {
  const slot = requiredSlot();
  const control = await sitePlatformRepository.getSandboxControl();
  await assertSlotAvailable(control, slot);
  process.stdout.write(`${JSON.stringify({ ok: true, slot })}\n`);
} else if (command === "register") {
  const slot = requiredSlot();
  const releaseSha = requiredOption("release-sha");
  const workerVersionId = requiredOption("worker-version");
  const imageDigest = requiredOption("image-digest");
  const initialize = hasFlag("initialize");
  const control = await sitePlatformRepository.getSandboxControl();
  if (control) await assertSlotAvailable(control, slot);
  else assert(initialize && slot === "blue", "The first deployment must initialize blue.");
  const manifest = await readSlotHealthManifest(slot);
  assertCompatibleManifest(manifest);
  const deployment = siteSandboxDeploymentSchema.parse({
    schemaVersion: 1,
    id: deploymentId({ slot, releaseSha, workerVersionId, imageDigest, manifest }),
    slot,
    workerVersionId,
    releaseSha,
    imageDigest,
    credentialSlot: slot,
    manifest,
    createdAt: new Date().toISOString()
  });
  await sitePlatformRepository.saveSandboxDeployment(deployment);
  const next = control
    ? siteSandboxControlSchema.parse({
        ...control,
        ...(slot === "blue" ? { blueDeploymentId: deployment.id } : { greenDeploymentId: deployment.id }),
        updatedAt: new Date().toISOString()
      })
    : siteSandboxControlSchema.parse({
        schemaVersion: 1,
        id: "production",
        blueDeploymentId: deployment.id,
        activeDeploymentId: deployment.id,
        updatedAt: new Date().toISOString()
      });
  await sitePlatformRepository.saveSandboxControl(next);
  process.stdout.write(`${JSON.stringify({ ok: true, deployment, control: next }, null, 2)}\n`);
} else if (command === "promote") {
  const deploymentIdValue = requiredOption("deployment-id");
  const [control, deployment] = await Promise.all([
    sitePlatformRepository.getSandboxControl(),
    sitePlatformRepository.getSandboxDeployment(deploymentIdValue)
  ]);
  assert(control && deployment, "Sandbox control or deployment is missing.");
  assert([control.blueDeploymentId, control.greenDeploymentId].includes(deployment.id), "Deployment is not assigned to blue or green.");
  await assertDeploymentHealth(deployment);
  const next = siteSandboxControlSchema.parse({ ...control, activeDeploymentId: deployment.id, updatedAt: new Date().toISOString() });
  await sitePlatformRepository.saveSandboxControl(next);
  process.stdout.write(`${JSON.stringify({ ok: true, previousDeploymentId: control.activeDeploymentId, activeDeploymentId: deployment.id }, null, 2)}\n`);
} else if (command === "rollback") {
  const previousDeploymentId = requiredOption("deployment-id");
  const control = await sitePlatformRepository.getSandboxControl();
  assert(control, "Sandbox control is missing.");
  assert(previousDeploymentId !== control.activeDeploymentId, "Rollback target is already active.");
  const deployment = await sitePlatformRepository.getSandboxDeployment(previousDeploymentId);
  assert(deployment && [control.blueDeploymentId, control.greenDeploymentId].includes(deployment.id), "Rollback target is not assigned to a slot.");
  await assertDeploymentHealth(deployment);
  const affectedRunIds = await sitePlatformRepository.rollbackSandboxDeployment({
    failedDeploymentId: control.activeDeploymentId,
    previousDeploymentId,
    now: new Date().toISOString()
  });
  process.stdout.write(`${JSON.stringify({ ok: true, activeDeploymentId: previousDeploymentId, failedDeploymentId: control.activeDeploymentId, affectedRunIds }, null, 2)}\n`);
} else {
  throw new Error(`Unknown sandbox deployment command ${command}.`);
}

async function controlStatus(control: SiteSandboxControl | undefined) {
  if (!control) return { configured: false };
  const ids = [...new Set([control.blueDeploymentId, control.greenDeploymentId].filter((value): value is string => Boolean(value)))];
  const deployments = await Promise.all(ids.map(async (id) => {
    const [deployment, drain] = await Promise.all([
      sitePlatformRepository.getSandboxDeployment(id),
      sitePlatformRepository.getSandboxDeploymentDrain(id)
    ]);
    return {
      deployment,
      lifecycle: control.activeDeploymentId === id
        ? "active"
        : drain.runningRunIds.length || drain.liveSessionIds.length ? "draining" : "standby",
      drain
    };
  }));
  return { configured: true, control, deployments };
}

async function assertSlotAvailable(control: SiteSandboxControl | undefined, slot: SiteSandboxSlot) {
  assert(control, "Sandbox control is not initialized.");
  const currentId = slot === "blue" ? control.blueDeploymentId : control.greenDeploymentId;
  assert(control.activeDeploymentId !== currentId, `${slot} is active and cannot be reused.`);
  if (!currentId) return;
  const drain = await sitePlatformRepository.getSandboxDeploymentDrain(currentId);
  assert.equal(drain.runningRunIds.length, 0, `${slot} still has running execution pins: ${drain.runningRunIds.join(", ")}`);
  assert.equal(drain.liveSessionIds.length, 0, `${slot} still has live sandbox sessions: ${drain.liveSessionIds.join(", ")}`);
}

async function readSlotHealthManifest(slot: SiteSandboxSlot) {
  const runtime = configuredSiteSandboxRuntimeForSlot(slot);
  const response = await fetch(`${runtime.url.replace(/\/$/, "")}/health`, {
    headers: { authorization: `Bearer ${runtime.token}` },
    signal: AbortSignal.timeout(15_000)
  });
  assert(response.ok, `${slot} sandbox health returned ${response.status}.`);
  const payload = await response.json() as { sandboxManifest?: unknown };
  return siteSandboxManifestSchema.parse(payload.sandboxManifest);
}

async function assertDeploymentHealth(deployment: SiteSandboxDeployment) {
  const runtime = configuredSiteSandboxRuntimeForDeployment(deployment);
  const response = await fetch(`${runtime.url.replace(/\/$/, "")}/health`, {
    headers: { authorization: `Bearer ${runtime.token}` },
    signal: AbortSignal.timeout(15_000)
  });
  assert(response.ok, `${deployment.slot} sandbox health returned ${response.status}.`);
  const payload = await response.json() as { sandboxManifest?: unknown };
  assert.deepEqual(siteSandboxManifestSchema.parse(payload.sandboxManifest), deployment.manifest, "Sandbox health manifest differs from its immutable deployment record.");
}

function assertCompatibleManifest(manifest: SiteSandboxManifest) {
  for (const key of ["apiIdentity", "artifactContractIdentity", "sourcePolicyIdentity", "storageIdentity", "durableObjectIdentity"] as const) {
    assert.equal(manifest[key], expectedSiteSandboxManifest[key], `Sandbox ${key} is a coordinated-maintenance change.`);
  }
}

function deploymentId(value: unknown) {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return `sandbox_deployment_${digest.slice(0, 32)}`;
}

function requiredSlot() {
  return siteSandboxSlotSchema.parse(requiredOption("slot"));
}

function requiredOption(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  const optionIndex = process.argv.indexOf(`--${name}`);
  const value = inline?.slice(name.length + 3) ?? (optionIndex >= 0 ? process.argv[optionIndex + 1] : undefined);
  assert(value && !value.startsWith("--"), `--${name} is required.`);
  return value;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

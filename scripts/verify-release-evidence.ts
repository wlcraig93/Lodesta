import assert from "node:assert/strict";
import {
  currentCloudflareDeployment,
  currentCloudflareContainer,
  currentRailwayDeployment,
  currentSandboxHealth,
  deployedCloudflareRelease,
  readyCloudflareContainer,
  readyCloudflareContainerDetails
} from "./release-evidence";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";

assert.deepEqual(currentCloudflareDeployment([
  {
    id: "deployment-old",
    created_on: "2026-01-01T00:00:00.000Z",
    versions: [{ version_id: "version-old", percentage: 100 }]
  },
  {
    id: "deployment-new",
    created_on: "2026-01-02T00:00:00.000Z",
    versions: [{ version_id: "version-new", percentage: 100 }]
  }
]), {
  deploymentId: "deployment-new",
  versionId: "version-new",
  createdAt: "2026-01-02T00:00:00.000Z"
});

assert.deepEqual(deployedCloudflareRelease(`
5f703837: digest: sha256:${"a".repeat(64)} size: 856
Current Version ID: 5f703837-b773-40ef-9048-872ddc517609
`), {
  versionId: "5f703837-b773-40ef-9048-872ddc517609",
  imageDigest: `sha256:${"a".repeat(64)}`
});

assert.deepEqual(deployedCloudflareRelease(`
FROM docker.io/cloudflare/sandbox:0.12.3@sha256:${"b".repeat(64)}
exporting manifest sha256:${"c".repeat(64)} done
Image already exists remotely, skipping push
Current Version ID: 5f703837-b773-40ef-9048-872ddc517609
`), {
  versionId: "5f703837-b773-40ef-9048-872ddc517609",
  imageDigest: `sha256:${"c".repeat(64)}`
});

assert.deepEqual(currentCloudflareContainer([{
  id: "container-app",
  name: "lodesta-site-sandbox-v1-sandbox",
  state: "ready",
  image: `registry.cloudflare.com/account/lodesta-site-sandbox-v1-sandbox@sha256:${"c".repeat(64)}`,
  version: 23,
  updated_at: "2026-01-02T12:00:00.000Z"
}], "lodesta-site-sandbox-v1-sandbox"), {
  applicationId: "container-app",
  applicationName: "lodesta-site-sandbox-v1-sandbox",
  state: "ready",
  applicationVersion: 23,
  imageDigest: `sha256:${"c".repeat(64)}`,
  updatedAt: "2026-01-02T12:00:00.000Z"
});

assert.deepEqual(readyCloudflareContainer([{
  id: "container-app",
  name: "lodesta-site-sandbox-v1-sandbox",
  state: "ready",
  image: `registry.cloudflare.com/account/lodesta-site-sandbox-v1-sandbox@sha256:${"c".repeat(64)}`,
  version: 23,
  updated_at: "2026-01-02T12:00:00.000Z"
}], "lodesta-site-sandbox-v1-sandbox", `sha256:${"c".repeat(64)}`), {
  applicationId: "container-app",
  applicationName: "lodesta-site-sandbox-v1-sandbox",
  state: "ready",
  applicationVersion: 23,
  imageDigest: `sha256:${"c".repeat(64)}`,
  updatedAt: "2026-01-02T12:00:00.000Z"
});

assert.deepEqual(readyCloudflareContainerDetails({
  id: "container-app",
  name: "lodesta-site-sandbox-v1-sandbox",
  version: 24,
  updated_at: "2026-01-02T12:05:00.000Z",
  max_instances: 5,
  configuration: {
    image: `registry.cloudflare.com/account/lodesta-site-sandbox-v1-sandbox@sha256:${"d".repeat(64)}`
  },
  health: {
    errors: [],
    instances: { healthy: 5, failed: 0, scheduling: 0, starting: 0 }
  }
}, "container-app", "lodesta-site-sandbox-v1-sandbox", `sha256:${"d".repeat(64)}`), {
  applicationId: "container-app",
  applicationName: "lodesta-site-sandbox-v1-sandbox",
  applicationVersion: 24,
  imageDigest: `sha256:${"d".repeat(64)}`,
  updatedAt: "2026-01-02T12:05:00.000Z",
  healthyInstances: 5,
  maxInstances: 5
});

assert.deepEqual(currentRailwayDeployment([{
  id: "railway-deployment",
  status: "SUCCESS",
  createdAt: "2026-01-03T00:00:00.000Z",
  meta: {
    commitHash: "abc123",
    cliMessage: "release abc123",
    imageDigest: `sha256:${"b".repeat(64)}`
  }
}]), {
  deploymentId: "railway-deployment",
  status: "SUCCESS",
  createdAt: "2026-01-03T00:00:00.000Z",
  commitSha: "abc123",
  imageDigest: `sha256:${"b".repeat(64)}`,
  message: "release abc123"
});

const currentManifest = {
  kind: "site-sandbox-manifest",
  artifactContractIdentity: "artifact-contract",
  toolchainIdentity: "toolchain",
  sourcePolicyIdentity: "source-policy"
};
assert.deepEqual(currentSandboxHealth({
  ok: true,
  provider: "cloudflare-sandbox",
  transport: "rpc",
  sandboxManifest: currentManifest
}), {
  provider: "cloudflare-sandbox",
  sandboxManifest: currentManifest
});
assert.deepEqual(currentSandboxHealth({
  ok: true,
  provider: "cloudflare-sandbox",
  transport: "rpc"
}), {
  provider: "cloudflare-sandbox",
  sandboxManifest: null
});

assert.throws(() => currentCloudflareDeployment([]), /no deployments/i);
assert.throws(() => currentCloudflareContainer([], "missing"), /content-addressed/i);
assert.throws(() => readyCloudflareContainer([{
  id: "container-app",
  name: "candidate",
  state: "deploying",
  image: `registry.cloudflare.com/account/candidate@sha256:${"c".repeat(64)}`,
  version: 23,
  updated_at: "2026-01-02T12:00:00.000Z"
}], "candidate", `sha256:${"c".repeat(64)}`), /not ready/i);
assert.throws(() => readyCloudflareContainer([{
  id: "container-app",
  name: "candidate",
  state: "ready",
  image: `registry.cloudflare.com/account/candidate@sha256:${"b".repeat(64)}`,
  version: 23,
  updated_at: "2026-01-02T12:00:00.000Z"
}], "candidate", `sha256:${"c".repeat(64)}`), /expected/i);
assert.throws(() => readyCloudflareContainerDetails({
  id: "container-app",
  name: "candidate",
  version: 24,
  updated_at: "2026-01-02T12:05:00.000Z",
  max_instances: 5,
  configuration: { image: `registry.cloudflare.com/account/candidate@sha256:${"d".repeat(64)}` },
  health: { errors: [], instances: { healthy: 0, failed: 0, scheduling: 1, starting: 0 } }
}, "container-app", "candidate", `sha256:${"d".repeat(64)}`), /healthy detailed status/i);
assert.throws(() => deployedCloudflareRelease("Current Version ID: missing-digest"), /both/i);
assert.throws(() => currentRailwayDeployment([{ status: "SUCCESS" }]), /malformed/i);
assert.throws(() => currentSandboxHealth({ ok: false, provider: "cloudflare-sandbox" }), /healthy/i);
assert.throws(() => currentSandboxHealth({
  ok: true,
  provider: "cloudflare-sandbox",
  sandboxManifest: "invalid"
}), /malformed sandbox manifest/i);

process.stdout.write(`${JSON.stringify({ ok: true, checks: ["cloudflare-current", "cloudflare-container-current", "cloudflare-container-ready", "cloudflare-container-details-ready", "cloudflare-deploy", "railway-current", "sandbox-health"] })}\n`);

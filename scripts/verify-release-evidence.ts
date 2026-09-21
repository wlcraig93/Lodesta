import assert from "node:assert/strict";
import {
  currentCloudflareDeployment,
  currentCloudflareContainer,
  currentRailwayDeployment,
  currentSandboxHealth,
  deployedCloudflareRelease,
  readyCloudflareContainer
} from "./release-evidence";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import { probeSiteSandboxContainerReadiness } from "./probe-site-sandbox-container-readiness";

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
assert.throws(() => deployedCloudflareRelease("Current Version ID: missing-digest"), /both/i);
assert.throws(() => currentRailwayDeployment([{ status: "SUCCESS" }]), /malformed/i);
assert.throws(() => currentSandboxHealth({ ok: false, provider: "cloudflare-sandbox" }), /healthy/i);
assert.throws(() => currentSandboxHealth({
  ok: true,
  provider: "cloudflare-sandbox",
  sandboxManifest: "invalid"
}), /malformed sandbox manifest/i);

const destroyedSessions: string[] = [];
const readiness = await probeSiteSandboxContainerReadiness({
  diagnostics: async () => ({
    ok: false,
    revision: "uninitialized",
    versions: [],
    sandboxManifest: expectedSiteSandboxManifest,
    placementId: "candidate-placement",
    processes: []
  }),
  destroy: async (sessionId) => {
    destroyedSessions.push(sessionId);
    return { ok: true };
  }
}, "readiness_fixture", expectedSiteSandboxManifest);
assert.equal(readiness.observation, "container_manifest_read");
assert.equal(readiness.placementId, "candidate-placement");
assert.deepEqual(destroyedSessions, ["readiness_fixture"]);

let staleReadinessDestroyed = false;
await assert.rejects(
  () => probeSiteSandboxContainerReadiness({
    diagnostics: async () => ({
      ok: true,
      revision: "uninitialized",
      versions: [],
      sandboxManifest: { ...expectedSiteSandboxManifest, toolchainIdentity: "stale-toolchain" },
      placementId: "stale-placement",
      processes: []
    }),
    destroy: async () => {
      staleReadinessDestroyed = true;
      return { ok: true };
    }
  }, "stale_readiness_fixture", expectedSiteSandboxManifest),
  /does not match/i
);
assert.equal(staleReadinessDestroyed, true, "A rejected readiness probe did not destroy its fresh sandbox.");

process.stdout.write(`${JSON.stringify({ ok: true, checks: ["cloudflare-current", "cloudflare-container-current", "cloudflare-container-ready", "cloudflare-deploy", "sandbox-container-serving", "railway-current", "sandbox-health"] })}\n`);

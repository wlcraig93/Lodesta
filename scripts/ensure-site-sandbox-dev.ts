import "./load-env";
import { spawn } from "node:child_process";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import {
  assertConfiguredSiteSandboxRuntimeReady,
  configuredSiteSandboxRuntime,
  type SiteSandboxManifest
} from "../packages/site-sandbox/runtime-config";
import { ensureDevelopmentSandboxToken } from "./development-sandbox-token";

const root = process.cwd();
const credential = await ensureDevelopmentSandboxToken(process.env, root);
const environment = {
  ...process.env,
  LODESTA_DEV_SANDBOX: "1",
  LODESTA_DEV_SANDBOX_TOKEN: credential.token
} satisfies NodeJS.ProcessEnv;

let reason = credential.created ? "development credentials were created" : "";
if (!reason) {
  try {
    const runtime = await assertConfiguredSiteSandboxRuntimeReady(environment, root);
    if (!runtime) throw new Error("development runtime did not resolve");
    const response = await fetch(new URL("/health", runtime.url), {
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json().catch(() => undefined) as {
      sandboxManifest?: SiteSandboxManifest;
    } | undefined;
    if (!response.ok || !body?.sandboxManifest || !sameManifest(body.sandboxManifest, expectedSiteSandboxManifest)) {
      throw new Error("the deployed development sandbox is unavailable or stale");
    }
    process.stdout.write("[dev] development sandbox is current\n");
    process.exit(0);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
}

process.stdout.write(`[dev] refreshing development sandbox: ${safeReason(reason)}\n`);
await run(process.execPath, ["--import", "tsx", "scripts/deploy-site-sandbox-dev.ts"], environment);

function sameManifest(left: SiteSandboxManifest, right: SiteSandboxManifest) {
  return left.kind === right.kind
    && left.artifactContractIdentity === right.artifactContractIdentity
    && left.toolchainIdentity === right.toolchainIdentity
    && left.sourcePolicyIdentity === right.sourcePolicyIdentity;
}

function safeReason(value: string) {
  return value.replace(/\s+/g, " ").slice(0, 240);
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

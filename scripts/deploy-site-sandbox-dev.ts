import "./load-env";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import {
  computeDevelopmentSandboxConfigHash,
  developmentSandboxReceiptPath,
  developmentSandboxWorkerName,
  type DevelopmentSandboxReceipt
} from "../packages/site-sandbox/runtime-config";
import { ensureDevelopmentSandboxToken } from "./development-sandbox-token";
import { deployedCloudflareRelease } from "./release-evidence";

const root = process.cwd();
const { token } = await ensureDevelopmentSandboxToken(process.env, root);
if (process.env.LODESTA_SANDBOX_TOKEN?.trim() === token) {
  throw new Error("Development and production sandbox tokens must differ.");
}

await run("npm", ["run", "generate:site-sandbox-manifest"]);
await run("npm", ["run", "verify:site-sandbox-manifest"]);
await run("npm", ["run", "verify:site-sandbox-local"]);

const temporary = await mkdtemp(join(tmpdir(), "lodesta-site-sandbox-dev-"));
const secretsFile = join(temporary, "secrets.json");
try {
  const dockerHost = (await runQuiet("docker", [
    "context", "inspect", process.env.DOCKER_CONTEXT?.trim() || "colima",
    "--format", "{{.Endpoints.docker.Host}}"
  ])).trim();
  if (!dockerHost.startsWith("unix://")) throw new Error("The development sandbox deploy requires a local Unix Docker context.");
  const dockerConfig = join(temporary, "docker");
  await mkdir(join(dockerConfig, "cli-plugins"), { recursive: true });
  await writeFile(join(dockerConfig, "config.json"), "{\"auths\":{}}\n", { mode: 0o600 });
  await symlink(
    join(homedir(), ".docker/cli-plugins/docker-buildx"),
    join(dockerConfig, "cli-plugins/docker-buildx")
  );
  await writeFile(secretsFile, `${JSON.stringify({ SANDBOX_TOKEN: token })}\n`, { mode: 0o600 });
  const deployed = await run("npx", [
    "wrangler", "deploy",
    "--config", "workers/site-sandbox/wrangler.dev.jsonc",
    "--strict",
    "--containers-rollout=immediate",
    "--secrets-file", secretsFile,
    "--message", `Development sandbox from ${await gitRevision()}`
  ], {
    ...process.env,
    DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: dockerHost
  });
  const release = deployedCloudflareRelease(deployed);
  const url = deployed.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i)?.[0];
  if (!url) throw new Error("Wrangler output did not report the development workers.dev URL.");
  if (process.env.LODESTA_SANDBOX_URL
    && normalizeUrl(process.env.LODESTA_SANDBOX_URL) === normalizeUrl(url)) {
    throw new Error("Development and production sandbox URLs must differ.");
  }

  const canaryEnvironment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_ENV")),
    NODE_ENV: "development" as const,
    LODESTA_DEV_SANDBOX: "0",
    LODESTA_SANDBOX_URL: url,
    LODESTA_SANDBOX_TOKEN: token,
    LODESTA_SANDBOX_IMAGE_DIGEST: release.imageDigest
  } satisfies NodeJS.ProcessEnv;
  await runCanary(canaryEnvironment);

  const receipt: DevelopmentSandboxReceipt = {
    schemaVersion: 1,
    workerName: developmentSandboxWorkerName,
    url,
    imageDigest: release.imageDigest as `sha256:${string}`,
    sandboxManifest: expectedSiteSandboxManifest,
    devConfigHash: computeDevelopmentSandboxConfigHash(root),
    deployedAt: new Date().toISOString()
  };
  const receiptPath = resolve(root, developmentSandboxReceiptPath);
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    workerName: receipt.workerName,
    url: receipt.url,
    imageDigest: receipt.imageDigest,
    sandboxManifest: receipt.sandboxManifest,
    receiptPath: developmentSandboxReceiptPath
  }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function run(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env) {
  return await new Promise<string>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun(output);
      else reject(new Error([
        `${command} ${args[0] ?? ""} failed with ${signal ?? `exit code ${code}`}.`,
        output.slice(-4_000)
      ].filter(Boolean).join("\n")));
    });
  });
}

async function runCanary(environment: NodeJS.ProcessEnv) {
  const attempts = 12;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run("npm", ["run", "verify:site-sandbox-deployed"], environment);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\b404\b|1042|ECONN|fetch failed|timeout|temporarily unavailable|manifest does not match|controller contract/i.test(message);
      if (!retryable || attempt === attempts) throw error;
      process.stderr.write(`[dev] development sandbox route or container is still propagating; retrying canary (${attempt}/${attempts})\n`);
      await delay(10_000);
    }
  }
}

async function gitRevision() {
  const revision = (await runQuiet("git", ["rev-parse", "--short=12", "HEAD"])).trim();
  const dirty = (await runQuiet("git", ["status", "--short"])).trim();
  return `${revision}${dirty ? "-dirty" : ""}`;
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

async function runQuiet(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env) {
  return await new Promise<string>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun(stdout);
      else reject(new Error(`${command} ${args[0] ?? ""} failed with ${signal ?? `exit code ${code}`}: ${stderr.trim()}`));
    });
  });
}

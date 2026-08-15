import "./load-env";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { siteSandboxManifestSchema, siteSandboxSlotSchema } from "../packages/site-contracts";
import {
  computeDevelopmentSandboxConfigHash,
  developmentSandboxReceiptPath,
  developmentSandboxWorkerName,
  readDevelopmentSandboxReceipt,
  readDevelopmentSandboxToken,
  type DevelopmentSandboxReceipt
} from "../packages/site-sandbox/runtime-config";
import { ensureDevelopmentSandboxToken } from "./development-sandbox-token";
import { deployedCloudflareRelease } from "./release-evidence";

const root = process.cwd();
const quiet = process.argv.includes("--quiet");
const slotIndex = process.argv.indexOf("--slot");
const inlineSlot = process.argv.find((argument) => argument.startsWith("--slot="))?.slice("--slot=".length);
const slot = siteSandboxSlotSchema.parse(inlineSlot ?? (slotIndex >= 0 ? process.argv[slotIndex + 1] : undefined));
const unexpectedArguments = process.argv.slice(2).filter((argument, index, args) =>
  argument !== "--quiet"
  && !argument.startsWith("--slot=")
  && argument !== "--slot"
  && args[index - 1] !== "--slot");
if (unexpectedArguments.length) throw new Error(`Unknown development sandbox deploy argument: ${unexpectedArguments[0]}`);
const deploymentLogPath = resolve(root, `.data/site-sandbox-dev-${slot}-deploy.log`);
let deploymentLog = "";
const { token } = await ensureDevelopmentSandboxToken(slot, process.env, root);
if ([process.env.LODESTA_SANDBOX_BLUE_TOKEN, process.env.LODESTA_SANDBOX_GREEN_TOKEN].some((value) => value?.trim() === token)) {
  throw new Error("Development and production sandbox tokens must differ.");
}
const otherSlot = slot === "blue" ? "green" : "blue";
try {
  if (readDevelopmentSandboxToken(otherSlot, process.env, root) === token) {
    throw new Error("Development blue and green sandbox tokens must differ.");
  }
} catch (error) {
  if (!/credentials are missing/i.test(error instanceof Error ? error.message : String(error))) throw error;
}

status("validating development sandbox sources");
await run("npm", ["run", "generate:site-sandbox-manifest"]);
await run("npm", ["run", "verify:site-sandbox-manifest"]);
await run("npm", ["run", "verify:site-sandbox-local"]);
const sandboxManifest = siteSandboxManifestSchema.parse(JSON.parse(
  await readFile(resolve(root, "workers/site-sandbox/scaffold/lodesta-manifest.json"), "utf8")
));

const temporary = await mkdtemp(join(tmpdir(), `lodesta-site-sandbox-dev-${slot}-`));
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
  status(`building and deploying development ${slot} sandbox`);
  const deployed = await run("npx", [
    "wrangler", "deploy",
    "--config", `workers/site-sandbox/wrangler.dev.${slot}.jsonc`,
    "--strict",
    "--containers-rollout=immediate",
    "--secrets-file", secretsFile,
    "--message", `Development ${slot} sandbox from ${await gitRevision()}`
  ], {
    ...process.env,
    DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: dockerHost
  });
  const release = deployedCloudflareRelease(deployed);
  const url = deployed.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i)?.[0];
  if (!url) throw new Error("Wrangler output did not report the development workers.dev URL.");
  if ([process.env.LODESTA_SANDBOX_BLUE_URL, process.env.LODESTA_SANDBOX_GREEN_URL]
    .some((value) => value && normalizeUrl(value) === normalizeUrl(url))) {
    throw new Error("Development and production sandbox URLs must differ.");
  }
  try {
    if (normalizeUrl(readDevelopmentSandboxReceipt(otherSlot, root).url) === normalizeUrl(url)) {
      throw new Error("Development blue and green sandbox URLs must differ.");
    }
  } catch (error) {
    if (!/is not deployed/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }

  const canaryEnvironment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_ENV")),
    NODE_ENV: "development" as const,
    LODESTA_DEV_SANDBOX: "0",
    LODESTA_SANDBOX_CANARY_URL: url,
    LODESTA_SANDBOX_CANARY_TOKEN: token
  } satisfies NodeJS.ProcessEnv;
  status(`verifying deployed development ${slot} sandbox`);
  await runCanary(canaryEnvironment);

  const receipt: DevelopmentSandboxReceipt = {
    schemaVersion: 1,
    slot,
    workerName: developmentSandboxWorkerName(slot),
    workerVersionId: release.versionId,
    releaseSha: await gitReleaseSha(),
    url,
    imageDigest: release.imageDigest as `sha256:${string}`,
    sandboxManifest,
    devConfigHash: computeDevelopmentSandboxConfigHash(slot, root),
    deployedAt: new Date().toISOString()
  };
  const receiptPath = resolve(root, developmentSandboxReceiptPath(slot));
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  if (quiet) {
    process.stdout.write(`[dev] development sandbox ready (${receipt.url})\n`);
  } else {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      workerName: receipt.workerName,
      url: receipt.url,
      imageDigest: receipt.imageDigest,
      sandboxManifest: receipt.sandboxManifest,
      receiptPath: developmentSandboxReceiptPath(slot)
    }, null, 2)}\n`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (quiet) {
    await mkdir(dirname(deploymentLogPath), { recursive: true });
    await writeFile(deploymentLogPath, deploymentLog, { mode: 0o600 });
  }
}

async function run(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env) {
  return await new Promise<string>((resolveRun, reject) => {
    if (quiet) deploymentLog += `$ ${command} ${args.join(" ")}\n`;
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      if (quiet) deploymentLog += text;
      else process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      if (quiet) deploymentLog += text;
      else process.stderr.write(text);
    });
    child.once("error", (error) => {
      if (!quiet) {
        reject(error);
        return;
      }
      void persistDeploymentLog().catch(() => undefined).finally(() => reject(error));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun(output);
      else {
        const error = new Error([
          `${command} ${args[0] ?? ""} failed with ${signal ?? `exit code ${code}`}.`,
          quiet ? `Detailed log: ${deploymentLogPath}` : "",
          output.slice(-4_000)
        ].filter(Boolean).join("\n"));
        if (!quiet) reject(error);
        else void persistDeploymentLog().catch(() => undefined).finally(() => reject(error));
      }
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
      const retryable = /\b404\b|1042|ECONN|fetch failed|timeout|temporarily unavailable|manifest does not match|controller contract|OPERATION_INTERRUPTED|sandbox_operation_failed|runtime connection was closing|platform was updating/i.test(message);
      if (!retryable || attempt === attempts) throw error;
      process.stderr.write(`[dev] development sandbox route or container is still propagating; retrying canary (${attempt}/${attempts})\n`);
      await delay(10_000);
    }
  }
}

function status(message: string) {
  if (quiet) process.stdout.write(`[dev] ${message}…\n`);
}

async function persistDeploymentLog() {
  await mkdir(dirname(deploymentLogPath), { recursive: true });
  await writeFile(deploymentLogPath, deploymentLog, { mode: 0o600 });
}

async function gitRevision() {
  const revision = (await runQuiet("git", ["rev-parse", "--short=12", "HEAD"])).trim();
  const dirty = (await runQuiet("git", ["status", "--short"])).trim();
  return `${revision}${dirty ? "-dirty" : ""}`;
}

async function gitReleaseSha() {
  const revision = (await runQuiet("git", ["rev-parse", "HEAD"])).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Git did not report a full release SHA.");
  return revision;
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

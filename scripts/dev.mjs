import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "4330";
const repositoryMode = process.env.LODESTA_REPOSITORY === "local" ? "local" : "supabase";

await ensureDevelopmentSandbox();

console.log(`[dev] starting Next.js at http://${host}:${port}`);
console.log(`[dev] repository=${repositoryMode} sandbox=development worker=enabled`);

const sharedEnv = {
  ...process.env,
  FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
  LODESTA_DEV_SANDBOX: "1",
  LODESTA_SANDBOX_BLUE_URL: "",
  LODESTA_SANDBOX_BLUE_TOKEN: "",
  LODESTA_SANDBOX_GREEN_URL: "",
  LODESTA_SANDBOX_GREEN_TOKEN: "",
  LODESTA_RELEASE_GIT_SHA: ""
};
const web = spawn(localBin("next"), ["dev", "--turbopack", "-p", port, "-H", host], {
  stdio: "inherit",
  env: sharedEnv
});
const worker = spawn(process.execPath, ["--import", "tsx", "workers/runner.ts", "work", "250", "4"], {
  stdio: "inherit",
  env: sharedEnv
});
const children = [web, worker];
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}

watch(web, "web");
watch(worker, "worker");

function watch(child, label) {
  child.once("error", (error) => {
    console.error(`[dev] failed to start ${label}: ${error.message}`);
    stop("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[dev] ${label} exited with ${typeof code === "number" ? `code ${code}` : signal ?? "an unknown signal"}`);
    stop("SIGTERM", typeof code === "number" && code !== 0 ? code : 1);
  });
}

function stop(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  const force = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 5_000);
  const finish = () => {
    if (children.some((child) => child.exitCode === null && child.signalCode === null)) return;
    clearTimeout(force);
    process.exit(exitCode);
  };
  for (const child of children) child.once("exit", finish);
  finish();
}

async function ensureDevelopmentSandbox() {
  await new Promise((resolveEnsure, reject) => {
    const ensure = spawn(process.execPath, ["--import", "tsx", "scripts/ensure-site-sandbox-dev.ts"], {
      stdio: "inherit",
      env: process.env
    });
    ensure.once("error", reject);
    ensure.once("exit", (code, signal) => {
      if (code === 0) resolveEnsure();
      else reject(new Error(`Development sandbox preflight failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

function localBin(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  const filePath = join(process.cwd(), "node_modules", ".bin", executable);
  if (!existsSync(filePath)) {
    console.error(`[dev] missing ${filePath}; run npm install first`);
    process.exit(1);
  }
  return filePath;
}

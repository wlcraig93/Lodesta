import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "4330";
const repositoryMode = process.env.LODESTA_REPOSITORY === "local" ? "local" : "supabase";

await ensureDevelopmentSandbox();

console.log(`[dev] starting Next.js at http://${host}:${port}`);
console.log(`[dev] repository=${repositoryMode} sandbox=development worker=disabled`);
console.log("[dev] run npm run dev:worker separately only when you intend to mutate shared queues and recovery state");

const child = spawn(localBin("next"), ["dev", "--turbopack", "-p", port, "-H", host], {
  stdio: "inherit",
  env: {
    ...process.env,
    FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
    LODESTA_DEV_SANDBOX: "1",
    LODESTA_SANDBOX_URL: "",
    LODESTA_SANDBOX_TOKEN: "",
    LODESTA_SANDBOX_IMAGE_DIGEST: "",
    LODESTA_RELEASE_GIT_SHA: ""
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`[dev] failed to start Next.js: ${error.message}`);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (typeof code === "number") process.exit(code);
  console.error(`[dev] Next.js exited from ${signal ?? "an unknown signal"}`);
  process.exit(1);
});

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

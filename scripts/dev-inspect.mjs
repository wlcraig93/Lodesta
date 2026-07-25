import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const host = (process.env.HOST || "127.0.0.1").trim();
const port = (process.env.PORT || "4330").trim();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (process.env.NODE_ENV === "production") {
  throw new Error("Local inspection mode cannot run with NODE_ENV=production.");
}

if (!loopbackHosts.has(host)) {
  throw new Error(`Local inspection mode requires a loopback HOST; received ${JSON.stringify(host)}.`);
}

const inspectionEnv = {
  ...process.env,
  HOST: host,
  PORT: port,
  LODESTA_ADMIN_TOKEN: "",
  LODESTA_REQUIRE_AUTH: "false",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_ANON_KEY: ""
};

console.log(`[dev:inspect] starting read-only local inspection at http://${host}:${port}`);
console.log("[dev:inspect] browser auth, admin-token access, and the background worker are disabled for this process");

if (process.argv.includes("--check")) {
  console.log("[dev:inspect] configuration check passed");
  process.exit(0);
}

const next = localBin("next");
const child = spawn(next, ["dev", "--turbopack", "-p", port, "-H", host], {
  stdio: "inherit",
  env: inspectionEnv
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`[dev:inspect] failed to start Next.js: ${error.message}`);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (typeof code === "number") process.exit(code);
  console.error(`[dev:inspect] Next.js exited from ${signal ?? "an unknown signal"}`);
  process.exit(1);
});

function localBin(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  const filePath = join(process.cwd(), "node_modules", ".bin", executable);
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${filePath}; run npm install first.`);
  }
  return filePath;
}

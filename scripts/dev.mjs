import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "4330";
const children = new Set();
let shuttingDown = false;

console.log("[dev] starting Next.js and the Lodesta job worker");

start("web", localBin("next"), ["dev", "-p", port, "-H", host]);
start("worker", process.execPath, ["--import", "tsx", "workers/runner.ts", "work"]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown(signal));
}

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? "1"
    }
  });

  children.add(child);

  child.once("error", (error) => {
    console.error(`[dev] ${name} failed to start: ${error.message}`);
    shutdown("SIGTERM", 1);
  });

  child.once("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    console.error(`[dev] ${name} exited${signal ? ` from ${signal}` : ` with code ${exitCode}`}`);
    shutdown("SIGTERM", exitCode);
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

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    child.kill(signal);
  }

  if (children.size === 0) {
    process.exit(exitCode);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 2500).unref();
}

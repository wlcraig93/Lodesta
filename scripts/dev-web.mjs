import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "4330";
const executable = process.platform === "win32" ? "next.cmd" : "next";
const next = join(process.cwd(), "node_modules", ".bin", executable);

if (!existsSync(next)) throw new Error(`Missing ${next}; run npm install first.`);

const child = spawn(next, ["dev", "--turbopack", "-p", port, "-H", host], {
  stdio: "inherit",
  env: {
    ...process.env,
    LODESTA_REPOSITORY: "local",
    LODESTA_EXECUTION_ROLE: "",
    LODESTA_DEV_SANDBOX: "0",
    LODESTA_SANDBOX_BLUE_URL: "",
    LODESTA_SANDBOX_BLUE_TOKEN: "",
    LODESTA_SANDBOX_GREEN_URL: "",
    LODESTA_SANDBOX_GREEN_TOKEN: "",
    LODESTA_RELEASE_GIT_SHA: ""
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(`[dev:web] failed to start Next.js: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (typeof code === "number") process.exit(code);
  console.error(`[dev:web] Next.js exited from ${signal ?? "an unknown signal"}`);
  process.exit(1);
});

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const executable = process.platform === "win32" ? "next.cmd" : "next";
const next = join(process.cwd(), "node_modules", ".bin", executable);

if (!existsSync(next)) throw new Error(`Missing ${next}; run npm install first.`);

const child = spawn(next, ["start", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    LODESTA_DEV_SANDBOX: "0",
    LODESTA_DEV_SANDBOX_BLUE_TOKEN: "",
    LODESTA_DEV_SANDBOX_GREEN_TOKEN: "",
    LODESTA_SANDBOX_BLUE_URL: "",
    LODESTA_SANDBOX_BLUE_TOKEN: "",
    LODESTA_SANDBOX_GREEN_URL: "",
    LODESTA_SANDBOX_GREEN_TOKEN: "",
    LODESTA_RELEASE_GIT_SHA: ""
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(`[start] failed to start Next.js: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (typeof code === "number") process.exit(code);
  console.error(`[start] Next.js exited from ${signal ?? "an unknown signal"}`);
  process.exit(1);
});

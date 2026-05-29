import "./load-env";

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
const child = spawn(process.execPath, [cli, "install", "chromium"], {
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Playwright browser installation interrupted by ${signal}.\n`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  process.stderr.write(`Playwright browser installation failed: ${error.message}\n`);
  process.exit(1);
});

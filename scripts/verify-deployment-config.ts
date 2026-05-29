import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};
const webConfig = readFileSync("railway.toml", "utf8");
const workerConfig = readFileSync("deploy/railway-worker.toml", "utf8");

assert(packageJson.dependencies?.playwright, "playwright must be a runtime dependency for deployed render inspection.");
assert(packageJson.scripts?.["install:browsers"], "package.json must expose npm run install:browsers.");
assert(packageJson.scripts?.["verify:render-browser"], "package.json must expose npm run verify:render-browser.");

assertIncludes(webConfig, 'builder = "RAILPACK"', "Web Railway config must use Railpack.");
assertIncludes(webConfig, "PLAYWRIGHT_BROWSERS_PATH=0 npm run install:browsers && npm run build", "Web build must install Chromium into the image.");
assertIncludes(webConfig, 'startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run start"', "Web service must start Next.js.");
assertIncludes(webConfig, 'healthcheckPath = "/api/health"', "Web service must use the public health endpoint.");
assertIncludes(webConfig, 'restartPolicyType = "ON_FAILURE"', "Web service should restart on failure.");

assertIncludes(workerConfig, 'builder = "RAILPACK"', "Worker Railway config must use Railpack.");
assertIncludes(workerConfig, "PLAYWRIGHT_BROWSERS_PATH=0 npm run install:browsers && npm run build", "Worker build must install Chromium into the image.");
assertIncludes(workerConfig, 'startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run worker -- work"', "Worker service must run the long-lived worker loop.");
assertIncludes(workerConfig, "healthcheckPath = null", "Worker service should not expose an HTTP healthcheck.");
assertIncludes(workerConfig, 'restartPolicyType = "ALWAYS"', "Worker service should restart continuously.");

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      web: "railway.toml",
      worker: "deploy/railway-worker.toml",
      browserInstall: true
    },
    null,
    2
  )}\n`
);

function assertIncludes(value: string, expected: string, message: string) {
  assert(value.includes(expected), message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

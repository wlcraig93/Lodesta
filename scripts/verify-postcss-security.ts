import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const patchedVersion = "8.5.18";
const pinnedVersion = "8.5.23";
const lockfiles = [
  {
    packageJson: "package.json",
    packageLock: "package-lock.json",
    requireOverride: true
  },
  {
    packageJson: "workers/site-sandbox/scaffold/package.json",
    packageLock: "workers/site-sandbox/scaffold/package-lock.json",
    requireOverride: false
  }
] as const;

type PackageJson = {
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

type LockPackage = {
  dev?: boolean;
  version?: string;
};

type PackageLock = {
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
};

function parseVersion(value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  assert(match, `Expected an exact semantic version, received ${JSON.stringify(value)}.`);
  return match.slice(1).map(Number) as [number, number, number];
}

function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

const verified: Array<{
  packageLock: string;
  resolutions: Array<{ path: string; version: string }>;
}> = [];

for (const target of lockfiles) {
  const [packageJson, packageLock] = await Promise.all([
    readFile(target.packageJson, "utf8").then((source) => JSON.parse(source) as PackageJson),
    readFile(target.packageLock, "utf8").then((source) => JSON.parse(source) as PackageLock)
  ]);

  assert.equal(
    packageJson.dependencies?.postcss,
    pinnedVersion,
    `${target.packageJson} must pin PostCSS ${pinnedVersion}.`
  );
  if (target.requireOverride) {
    assert.equal(
      packageJson.overrides?.postcss,
      pinnedVersion,
      `${target.packageJson} must override PostCSS to ${pinnedVersion}.`
    );
  }

  assert(
    packageLock.lockfileVersion && packageLock.lockfileVersion >= 3 && packageLock.packages,
    `${target.packageLock} must use a package-lock format with inspectable package resolutions.`
  );
  const resolutions = Object.entries(packageLock.packages)
    .filter(([path, entry]) => path.endsWith("node_modules/postcss") && entry.dev !== true)
    .map(([path, entry]) => {
      assert(entry.version, `${target.packageLock}:${path} omits its resolved version.`);
      return { path, version: entry.version };
    });
  assert(resolutions.length > 0, `${target.packageLock} contains no production PostCSS resolution.`);
  for (const resolution of resolutions) {
    assert(
      compareVersions(resolution.version, patchedVersion) >= 0,
      `${target.packageLock}:${resolution.path} resolves vulnerable PostCSS ${resolution.version}; require ${patchedVersion} or newer.`
    );
  }
  verified.push({ packageLock: target.packageLock, resolutions });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  patchedVersion,
  pinnedVersion,
  verified
})}\n`);

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

type CloudflareDeployment = {
  id?: unknown;
  created_on?: unknown;
  versions?: Array<{ version_id?: unknown; percentage?: unknown }>;
};

type RailwayDeployment = {
  id?: unknown;
  status?: unknown;
  createdAt?: unknown;
  meta?: {
    commitHash?: unknown;
    cliMessage?: unknown;
    imageDigest?: unknown;
  };
};

type CloudflareContainerApplication = {
  id?: unknown;
  name?: unknown;
  state?: unknown;
  image?: unknown;
  version?: unknown;
  updated_at?: unknown;
};

export function currentCloudflareDeployment(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Cloudflare returned no deployments.");
  }
  const deployment = [...value].reverse().find((candidate): candidate is CloudflareDeployment => {
    if (!candidate || typeof candidate !== "object") return false;
    const versions = (candidate as CloudflareDeployment).versions;
    return Array.isArray(versions) && versions.some((version) => version.percentage === 100);
  });
  const activeVersion = deployment?.versions?.find((version) => version.percentage === 100);
  if (!deployment || typeof deployment.id !== "string" || typeof deployment.created_on !== "string"
    || typeof activeVersion?.version_id !== "string") {
    throw new Error("Cloudflare deployment data does not identify one active version.");
  }
  return {
    deploymentId: deployment.id,
    versionId: activeVersion.version_id,
    createdAt: deployment.created_on
  };
}

export function deployedCloudflareRelease(output: string) {
  const versionIds = [...output.matchAll(/Current Version ID:\s*([a-f0-9-]{36})/gi)];
  const digests = [
    ...output.matchAll(/\bdigest:\s*(sha256:[a-f0-9]{64})\b/gi),
    ...output.matchAll(/@(?<digest>sha256:[a-f0-9]{64})\b/gi)
  ];
  const versionId = versionIds.at(-1)?.[1];
  const imageDigest = digests.at(-1)?.groups?.digest ?? digests.at(-1)?.[1];
  if (!versionId || !imageDigest) {
    throw new Error("Wrangler output did not contain both a Worker version ID and a container image digest.");
  }
  return { versionId, imageDigest: imageDigest.toLowerCase() };
}

export function currentCloudflareContainer(value: unknown, applicationName: string) {
  if (!Array.isArray(value)) throw new Error("Cloudflare container data is malformed.");
  const application = value.find((candidate): candidate is CloudflareContainerApplication =>
    Boolean(candidate) && typeof candidate === "object" && (candidate as CloudflareContainerApplication).name === applicationName);
  const digest = typeof application?.image === "string"
    ? application.image.match(/@(sha256:[a-f0-9]{64})$/)?.[1]
    : undefined;
  if (!application || typeof application.id !== "string" || typeof application.state !== "string"
    || typeof application.version !== "number" || typeof application.updated_at !== "string" || !digest) {
    throw new Error(`Cloudflare container application ${applicationName} did not report a content-addressed image.`);
  }
  return {
    applicationId: application.id,
    applicationName,
    state: application.state,
    applicationVersion: application.version,
    imageDigest: digest,
    updatedAt: application.updated_at
  };
}

export function currentRailwayDeployment(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Railway returned no deployments.");
  }
  const deployment = value[0] as RailwayDeployment;
  if (typeof deployment?.id !== "string" || typeof deployment.status !== "string"
    || typeof deployment.createdAt !== "string") {
    throw new Error("Railway deployment data is malformed.");
  }
  return {
    deploymentId: deployment.id,
    status: deployment.status,
    createdAt: deployment.createdAt,
    commitSha: typeof deployment.meta?.commitHash === "string" ? deployment.meta.commitHash : undefined,
    imageDigest: typeof deployment.meta?.imageDigest === "string" ? deployment.meta.imageDigest : undefined,
    message: typeof deployment.meta?.cliMessage === "string" ? deployment.meta.cliMessage : undefined
  };
}

if (basename(process.argv[1] ?? "") === "release-evidence.ts") {
  const command = process.argv[2];
  const file = process.argv[3];
  if (!command || !file) {
    throw new Error("Usage: release-evidence.ts <current-cloudflare|current-cloudflare-container|deployed-cloudflare|current-railway> <input-file> [application-name]");
  }
  const source = await readFile(file, "utf8");
  const result = command === "current-cloudflare"
    ? currentCloudflareDeployment(JSON.parse(source))
    : command === "current-cloudflare-container"
      ? currentCloudflareContainer(JSON.parse(source), process.argv[4] ?? "")
    : command === "deployed-cloudflare"
      ? deployedCloudflareRelease(source)
      : command === "current-railway"
        ? currentRailwayDeployment(JSON.parse(source))
        : undefined;
  if (!result) throw new Error(`Unknown release evidence command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

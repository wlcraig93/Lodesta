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

type CloudflareContainerApplicationDetails = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  updated_at?: unknown;
  max_instances?: unknown;
  configuration?: { image?: unknown };
  health?: {
    errors?: unknown;
    instances?: {
      healthy?: unknown;
      failed?: unknown;
      scheduling?: unknown;
      starting?: unknown;
    };
  };
};

type SandboxHealth = {
  ok?: unknown;
  provider?: unknown;
  sandboxManifest?: unknown;
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
  const versionId = versionIds.at(-1)?.[1];
  const pushed = [...output.matchAll(/\bdigest:\s*(sha256:[a-f0-9]{64})\b/gi)].at(-1)?.[1];
  const built = [...output.matchAll(/exporting manifest\s+(sha256:[a-f0-9]{64})\b/gi)].at(-1)?.[1];
  const configured = [...output.matchAll(/registry\.cloudflare\.com\/[^\s"]+@(sha256:[a-f0-9]{64})\b/gi)].at(-1)?.[1];
  const imageDigest = pushed ?? built ?? configured;
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

export function readyCloudflareContainer(value: unknown, applicationName: string, expectedImageDigest: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedImageDigest)) {
    throw new Error("Expected Cloudflare container image digest is malformed.");
  }
  const current = currentCloudflareContainer(value, applicationName);
  if (current.state !== "ready") {
    throw new Error(`Cloudflare container application ${applicationName} is ${current.state}, not ready.`);
  }
  if (current.imageDigest !== expectedImageDigest) {
    throw new Error(
      `Cloudflare container application ${applicationName} reports ${current.imageDigest}, expected ${expectedImageDigest}.`
    );
  }
  return current;
}

export function readyCloudflareContainerDetails(
  value: unknown,
  applicationId: string,
  applicationName: string,
  expectedImageDigest: string
) {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedImageDigest)) {
    throw new Error("Expected Cloudflare container image digest is malformed.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cloudflare container application details are malformed.");
  }
  const application = value as CloudflareContainerApplicationDetails;
  const digest = typeof application.configuration?.image === "string"
    ? application.configuration.image.match(/@(sha256:[a-f0-9]{64})$/)?.[1]
    : undefined;
  const health = application.health?.instances;
  const errors = application.health?.errors;
  if (application.id !== applicationId || application.name !== applicationName
    || typeof application.version !== "number" || typeof application.updated_at !== "string"
    || typeof application.max_instances !== "number" || !digest
    || !Array.isArray(errors) || !health || typeof health.healthy !== "number"
    || typeof health.failed !== "number" || typeof health.scheduling !== "number"
    || typeof health.starting !== "number") {
    throw new Error(`Cloudflare container application ${applicationName} did not report valid detailed status.`);
  }
  if (digest !== expectedImageDigest) {
    throw new Error(
      `Cloudflare container application ${applicationName} reports ${digest}, expected ${expectedImageDigest}.`
    );
  }
  if (errors.length || health.failed || health.scheduling || health.starting || health.healthy < 1) {
    throw new Error(`Cloudflare container application ${applicationName} has not reached healthy detailed status.`);
  }
  return {
    applicationId,
    applicationName,
    applicationVersion: application.version,
    imageDigest: digest,
    updatedAt: application.updated_at,
    healthyInstances: health.healthy,
    maxInstances: application.max_instances
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

export function currentSandboxHealth(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Sandbox health data is malformed.");
  }
  const health = value as SandboxHealth;
  if (health.ok !== true || health.provider !== "cloudflare-sandbox") {
    throw new Error("Sandbox health did not identify a healthy Cloudflare sandbox.");
  }
  if (health.sandboxManifest !== undefined
    && (!health.sandboxManifest || typeof health.sandboxManifest !== "object" || Array.isArray(health.sandboxManifest))) {
    throw new Error("Sandbox health reported a malformed sandbox manifest.");
  }
  return {
    provider: health.provider,
    sandboxManifest: health.sandboxManifest ?? null
  };
}

if (basename(process.argv[1] ?? "") === "release-evidence.ts") {
  const command = process.argv[2];
  const file = process.argv[3];
  if (!command || !file) {
    throw new Error("Usage: release-evidence.ts <current-cloudflare|current-cloudflare-container|ready-cloudflare-container|ready-cloudflare-container-details|deployed-cloudflare|current-railway|current-sandbox-health> <input-file> [application-id|application-name] [application-name|expected-image-digest] [expected-image-digest]");
  }
  const source = await readFile(file, "utf8");
  const result = command === "current-cloudflare"
    ? currentCloudflareDeployment(JSON.parse(source))
    : command === "current-cloudflare-container"
      ? currentCloudflareContainer(JSON.parse(source), process.argv[4] ?? "")
    : command === "ready-cloudflare-container"
      ? readyCloudflareContainer(JSON.parse(source), process.argv[4] ?? "", process.argv[5] ?? "")
    : command === "ready-cloudflare-container-details"
      ? readyCloudflareContainerDetails(
          JSON.parse(source),
          process.argv[4] ?? "",
          process.argv[5] ?? "",
          process.argv[6] ?? ""
        )
    : command === "deployed-cloudflare"
      ? deployedCloudflareRelease(source)
      : command === "current-railway"
        ? currentRailwayDeployment(JSON.parse(source))
        : command === "current-sandbox-health"
          ? currentSandboxHealth(JSON.parse(source))
        : undefined;
  if (!result) throw new Error(`Unknown release evidence command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

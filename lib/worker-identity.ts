import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

let warnedAboutDeprecatedWorkerId = false;

const processWorkerId = `worker_${normalizeHostname(readHostname())}_${process.pid}_${randomUUID().slice(0, 8)}`;

export function getProcessWorkerId() {
  return processWorkerId;
}

export function warnIfDeprecatedWorkerIdEnvSet() {
  if (warnedAboutDeprecatedWorkerId || process.env.NODE_ENV === "test" || !process.env.LODESTA_WORKER_ID) return;
  warnedAboutDeprecatedWorkerId = true;
  console.warn("LODESTA_WORKER_ID is deprecated and ignored; Lodesta now generates worker IDs automatically per process.");
}

function readHostname() {
  try {
    return hostname();
  } catch {
    return "";
  }
}

function normalizeHostname(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32)
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

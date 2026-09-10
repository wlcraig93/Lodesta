import assert from "node:assert/strict";
import {
  SiteSandboxClient,
  SiteSandboxRequestError,
  sandboxDiagnosticProviderCode,
  type SandboxDiagnostics,
  type SandboxOperationStatus
} from "../packages/site-sandbox";

type FailureCauseCarrier = Error & { sandboxFailureCauses?: SiteSandboxRequestError[] };
type SanitizedFailure = { name: string; action?: string; status?: number; providerCode?: string };

export function assertWithSandboxFailureCauses(
  condition: unknown,
  message: string,
  causes: readonly SiteSandboxRequestError[]
) {
  try {
    assert(condition, message);
  } catch (error) {
    if (error instanceof Error && causes.length > 0 && Object.isExtensible(error)) {
      Object.defineProperty(error, "sandboxFailureCauses", {
        value: causes.slice(0, 4),
        enumerable: false
      });
    }
    throw error;
  }
}

export async function captureCanaryFailureDiagnostic(sandbox: SiteSandboxClient, failedSessionId: string, error: unknown) {
  let diagnostics: ReturnType<typeof sanitizedDiagnostics> | undefined;
  let diagnosticsFailure: Record<string, string | number | undefined> | undefined;
  try {
    // Capture only after a canary failure and before destroy. This is a bounded
    // observer of the existing public diagnostics endpoint; it does not replay
    // an operation or alter its deadline, lock, or cleanup behavior.
    diagnostics = sanitizedDiagnostics(await sandbox.diagnostics(failedSessionId, 10_000));
  } catch (diagnosticError) {
    diagnosticsFailure = sanitizedFailure(diagnosticError);
  }
  const causes = sandboxFailureCauses(error);
  return {
    kind: "site_sandbox_canary_failure_diagnostic",
    sessionId: failedSessionId,
    failure: sanitizedFailure(error),
    ...(error instanceof SiteSandboxRequestError && error.operationPollDiagnostic
      ? { poll: error.operationPollDiagnostic }
      : {}),
    ...(causes.length > 0
      ? { causes: causes.map((cause) => ({
        failure: sanitizedFailure(cause),
        ...(cause.operationPollDiagnostic ? { poll: cause.operationPollDiagnostic } : {})
      })) }
      : {}),
    ...(diagnostics
      ? { sandbox: diagnostics }
      : { diagnosticsFailure: diagnosticsFailure ?? { name: "diagnostics_unavailable" } }),
    processLogTails: "not_exposed_by_current_public_diagnostics_endpoint"
  };
}

export function boundedFailureLabel(error: unknown) {
  const failure = sanitizedFailure(error);
  return [failure.name, failure.status, failure.providerCode].filter((value) => value !== undefined).join(":");
}

function sandboxFailureCauses(error: unknown) {
  if (error instanceof SiteSandboxRequestError) return [];
  if (!(error instanceof Error)) return [];
  return ((error as FailureCauseCarrier).sandboxFailureCauses ?? [])
    .filter((cause): cause is SiteSandboxRequestError => cause instanceof SiteSandboxRequestError)
    .slice(0, 4);
}

function sanitizedFailure(error: unknown): SanitizedFailure {
  if (error instanceof SiteSandboxRequestError) {
    return {
      name: error.name,
      action: diagnosticToken(error.action),
      status: error.status,
      ...(error.providerCode ? { providerCode: sandboxDiagnosticProviderCode(error.providerCode) } : {})
    };
  }
  return { name: diagnosticErrorName(error) };
}

function sanitizedDiagnostics(value: SandboxDiagnostics) {
  return {
    ok: value.ok,
    revision: diagnosticToken(value.revision),
    placementId: diagnosticToken(value.placementId),
    ...(value.mutationLock ? { mutationLock: sanitizedLock(value.mutationLock) } : {}),
    ...(value.activeOperation ? { activeOperation: sanitizedOperation(value.activeOperation) } : {}),
    processes: value.processes.slice(0, 20).map((process) => ({
      id: diagnosticToken(process.id),
      status: diagnosticToken(process.status)
    })),
    ...(value.processes.length > 20 ? { processesTruncated: true } : {})
  };
}

function sanitizedLock(lock: NonNullable<SandboxDiagnostics["mutationLock"]>) {
  return {
    ...(lock.operationId ? { operationId: diagnosticToken(lock.operationId) } : {}),
    ...(lock.startedAt && isIsoTimestamp(lock.startedAt) ? { startedAt: lock.startedAt } : {})
  };
}

function sanitizedOperation(operation: SandboxOperationStatus) {
  return {
    operationId: diagnosticToken(operation.operationId),
    status: diagnosticToken(operation.status),
    phase: diagnosticToken(operation.phase),
    ...(isIsoTimestamp(operation.createdAt) ? { createdAt: operation.createdAt } : {}),
    ...(isIsoTimestamp(operation.updatedAt) ? { updatedAt: operation.updatedAt } : {}),
    ...(isIsoTimestamp(operation.phaseStartedAt) ? { phaseStartedAt: operation.phaseStartedAt } : {}),
    timestamps: Object.fromEntries(Object.entries(operation.timestamps)
      .filter(([key, timestamp]) => diagnosticToken(key) === key && isIsoTimestamp(timestamp))
      .slice(0, 12)),
    phaseTimings: Object.fromEntries(Object.entries(operation.phaseTimings)
      .filter(([key, duration]) => diagnosticToken(key) === key && Number.isFinite(duration) && duration >= 0 && duration <= 86_400_000)
      .slice(0, 12))
  };
}

function diagnosticErrorName(error: unknown) {
  const name = error instanceof Error ? error.name : "unknown_error";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(name) ? name : "unknown_error";
}

function diagnosticToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "unknown";
}

function isIsoTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value);
}

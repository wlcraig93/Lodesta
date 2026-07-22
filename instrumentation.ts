export function shouldScheduleStartupRecovery(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NEXT_RUNTIME === "nodejs"
    && environment.NODE_ENV === "production"
    && environment.NEXT_PHASE !== "phase-production-build";
}

const startupRecoveryState = globalThis as typeof globalThis & {
  __lodestaStartupRecoveryScheduled?: boolean;
};

export function register() {
  if (!shouldScheduleStartupRecovery() || startupRecoveryState.__lodestaStartupRecoveryScheduled) return;
  startupRecoveryState.__lodestaStartupRecoveryScheduled = true;
  globalThis.setTimeout(() => {
    void triggerStartupRecovery().catch((error) => {
      console.error(JSON.stringify({
        event: "automatic_recovery_failed",
        trigger: "startup",
        error: error instanceof Error ? error.message : String(error)
      }));
    });
  }, 2_000);
}

export async function triggerStartupRecovery(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch
) {
  const token = environment.LODESTA_RECOVERY_WATCHDOG_TOKEN?.trim();
  const configuredUrl = environment.LODESTA_RECOVERY_WATCHDOG_URL?.trim();
  const appOrigin = environment.LODESTA_APP_ORIGIN?.trim();
  const endpoint = configuredUrl || (appOrigin ? new URL("/api/site-agent/maintenance", appOrigin).toString() : undefined);
  if (!endpoint || !token) throw new Error("Startup recovery URL and token are required.");
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-lodesta-recovery-trigger": "startup"
    }
  });
  if (response.status !== 202) throw new Error(`Startup recovery request failed with status ${response.status}.`);
  console.log(JSON.stringify({ event: "automatic_recovery_scheduled", trigger: "startup" }));
}

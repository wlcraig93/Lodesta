/// <reference types="@cloudflare/workers-types" />

interface Env {
  LODESTA_RECOVERY_WATCHDOG_URL?: string;
  LODESTA_RECOVERY_WATCHDOG_TOKEN?: string;
}

export async function triggerRecoveryWatchdog(env: Env, fetcher: typeof fetch = fetch) {
  const endpoint = env.LODESTA_RECOVERY_WATCHDOG_URL?.trim();
  const token = env.LODESTA_RECOVERY_WATCHDOG_TOKEN?.trim();
  if (!endpoint || !token) throw new Error("Recovery watchdog URL and token are required.");
  const url = new URL(endpoint);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Recovery watchdog URL must use HTTPS.");
  }
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-lodesta-recovery-trigger": "cloudflare_cron"
    }
  });
  if (response.status !== 202) {
    throw new Error(`Recovery watchdog request failed with status ${response.status}.`);
  }
  console.log(JSON.stringify({ event: "recovery_watchdog_accepted", status: response.status }));
  return response.status;
}

export default {
  scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(triggerRecoveryWatchdog(env));
  }
} satisfies ExportedHandler<Env>;

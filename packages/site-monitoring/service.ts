import { connect } from "node:tls";
import { configuredAppOriginOrDefault } from "@/lib/app-origin";
import { internalTrafficHeaderValue } from "@/lib/analytics-ingestion";
import { ownerNotificationRepository, type OwnerNotificationRepository } from "@/packages/owner-notifications/repository";
import { siteCapabilityRepository, type SiteCapabilityRepository } from "@/packages/site-capabilities";
import { platformOperationsRepository, type PlatformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import type { PlatformSiteRecord } from "@/packages/site-contracts";
import { siteMonitorRepository, type SiteMonitorKind, type SiteMonitorRepository } from "./repository";

/** Site probes run every five minutes and form probes every fifteen; two failures in a row alert. */
const intervals: Record<SiteMonitorKind, number> = { site: 5 * 60_000, form: 15 * 60_000 };
const certificateWarningMs = 14 * 24 * 60 * 60_000;

export type ProbeResult = { ok: boolean; detail: Record<string, unknown> };

export type SiteMonitorDependencies = {
  checks: SiteMonitorRepository;
  platform: Pick<SitePlatformRepository, "listSites" | "getSiteVersion" | "getPublicBuildInput">;
  domains: Pick<PlatformOperationsRepository, "listDomains">;
  alerts: Pick<OwnerNotificationRepository, "enqueue">;
  inquiries: Pick<SiteCapabilityRepository, "listRecentFormSubmissions">;
  fetch: typeof fetch;
  certificateExpiry(hostname: string): Promise<Date | undefined>;
  appOrigin(): string;
  /** A Lodesta-owned site whose form receives a labelled synthetic inquiry. */
  syntheticFormSiteId(): string | undefined;
};

export function createSiteMonitor(deps: SiteMonitorDependencies) {
  return {
    /** Runs every probe that is due and records one operator alert per failure episode. */
    async runDueChecks(now = new Date()) {
      const results: Array<{ siteId: string; kind: SiteMonitorKind; ok: boolean }> = [];
      const liveDomains = (await deps.domains.listDomains()).filter((domain) => domain.status === "active");
      for (const site of await deps.platform.listSites()) {
        if (!site.publishedVersionId || (site.status !== "active" && site.status !== "offline")) continue;
        const domain = liveDomains.find((item) => item.siteId === site.id);
        // Canonical slashed URLs: trailingSlash redirects anything else with a 308.
        const url = domain ? `https://${domain.hostname}/` : `${deps.appOrigin()}/sites/${encodeURIComponent(site.slug)}/`;
        for (const kind of ["site", "form"] as const) {
          if (kind === "form" && site.status !== "active") continue;
          const [last] = await deps.checks.recent(site.id, kind, 1);
          if (last && now.getTime() - Date.parse(last.checkedAt) < intervals[kind]) continue;
          const result = kind === "site" ? await probeSite(site, url, domain?.hostname, now) : await probeForm(site, url);
          await deps.checks.record({ siteId: site.id, kind, target: url, ok: result.ok, detail: result.detail, checkedAt: now.toISOString() });
          results.push({ siteId: site.id, kind, ok: result.ok });
          if (!result.ok) await alertIfRepeated(site, kind, now);
        }
      }
      return results;
    }
  };

  async function probeSite(site: PlatformSiteRecord, url: string, hostname: string | undefined, now: Date): Promise<ProbeResult> {
    const problems: string[] = [];
    let status: number | undefined;
    try {
      const response = await deps.fetch(url, { headers: { "x-lodesta-internal-traffic": internalTrafficHeaderValue(now.getTime()), ...pilotAccessHeaders() }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      status = response.status;
      const html = await response.text();
      if (site.status === "offline") {
        if (response.status !== 503) problems.push(`offline site answered ${response.status}, expected 503`);
      } else {
        if (response.status !== 200) problems.push(`answered ${response.status}`);
        const csp = response.headers.get("content-security-policy") ?? "";
        if (!csp.includes("default-src 'none'")) problems.push("missing the site content security policy");
        if (response.headers.get("x-lodesta-site-version") !== site.publishedVersionId) problems.push("served a different version than the published one");
        const runtimePath = html.match(/<script[^>]+src="([^"]*\/_lodesta\/runtime\/[^"]+)"/)?.[1];
        if (!runtimePath) problems.push("page has no trusted runtime script");
        else {
          const runtime = await deps.fetch(new URL(runtimePath, url), { headers: pilotAccessHeaders(), signal: AbortSignal.timeout(15_000) });
          if (runtime.status !== 200) problems.push(`runtime script answered ${runtime.status}`);
        }
      }
      if (hostname) {
        const expiry = await deps.certificateExpiry(hostname).catch(() => undefined);
        if (!expiry) problems.push("could not read the TLS certificate");
        else if (expiry.getTime() - now.getTime() < certificateWarningMs) problems.push(`TLS certificate expires ${expiry.toISOString()}`);
      }
    } catch (error) {
      problems.push(`unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: problems.length === 0, detail: { status, problems } };
  }

  /**
   * Every published form must still be referenced by the live version. The
   * designated Lodesta-owned site also receives a labelled synthetic inquiry
   * end to end; no customer's inbox or email is ever touched.
   */
  async function probeForm(site: PlatformSiteRecord, url: string): Promise<ProbeResult> {
    const problems: string[] = [];
    try {
      const version = site.publishedVersionId ? await deps.platform.getSiteVersion(site.publishedVersionId) : undefined;
      const input = version ? await deps.platform.getPublicBuildInput(version.publicBuildInputId) : undefined;
      if (!version || !input) problems.push("published version or its build input is missing");
      else if (!input.forms.every((form) => version.formDefinitionIds.includes(form.id))) problems.push("a site form is not part of the published version");
      if (!problems.length && site.id === deps.syntheticFormSiteId() && input?.forms[0]) {
        const form = input.forms[0];
        // Each probe is a distinct submission, so inbox deduplication of
        // identical visitor retries never hides a fresh check.
        const probeId = `lodesta-monitor-${crypto.randomUUID()}`;
        const payload = Object.fromEntries(form.fields.map((field) => [field.id, syntheticValue(field, probeId)]));
        const submittedAt = new Date();
        // Same request a visitor's browser sends: slashed endpoint, page referrer, runtime render stamp.
        const response = await deps.fetch(new URL("/api/forms/submit/", url), {
          method: "POST",
          headers: { "content-type": "application/json", referer: url, "x-lodesta-internal-traffic": internalTrafficHeaderValue(), ...pilotAccessHeaders() },
          body: JSON.stringify({ siteId: site.id, versionId: site.publishedVersionId, formId: form.id, pageId: new URL(url).pathname, formRenderedAt: Date.now() - 5_000, payload }),
          signal: AbortSignal.timeout(15_000)
        });
        const body = await response.json().catch(() => ({})) as { accepted?: boolean; submissionKind?: string; error?: string };
        if (response.status !== 200 || body.accepted !== true || body.submissionKind !== "synthetic") {
          problems.push(`synthetic inquiry answered ${response.status}${body.error ? `: ${body.error}` : ""}`);
        } else {
          // A success response is not enough: the inquiry must be in the inbox.
          const saved = await deps.inquiries.listRecentFormSubmissions(new Date(submittedAt.getTime() - 60_000).toISOString(), 50);
          const persisted = saved.some((event) => event.siteId === site.id
            && event.metadata?.submissionKind === "synthetic"
            && Object.values(event.payload ?? {}).some((value) => String(value).includes(probeId)));
          if (!persisted) problems.push("synthetic inquiry was accepted but not saved to the inbox");
        }
      }
    } catch (error) {
      problems.push(`form check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: problems.length === 0, detail: { problems } };
  }

  async function alertIfRepeated(site: PlatformSiteRecord, kind: SiteMonitorKind, now: Date) {
    const recent = await deps.checks.recent(site.id, kind, 2);
    if (recent.length < 2 || recent[0]?.ok || recent[1]?.ok) return;
    // One alert per failure episode. The episode is named by the last success
    // before it, which stays fixed however long the failure lasts.
    const lastSuccess = await deps.checks.lastSuccess(site.id, kind);
    await deps.alerts.enqueue({
      siteId: site.id,
      kind: kind === "site" ? "site_unreachable" : "form_unreachable",
      subjectId: recent[0]!.id,
      dedupeKey: `monitor:${site.id}:${kind}:after:${lastSuccess?.checkedAt ?? "never"}`,
      audience: "operator",
      test: false
    }, now);
  }
}

/** Access-restricted pilot sites accept the team credential; elsewhere it is ignored. */
function pilotAccessHeaders(): Record<string, string> {
  const credential = process.env.LODESTA_PILOT_ACCESS_CREDENTIAL?.trim();
  return credential ? { authorization: `Basic ${Buffer.from(credential).toString("base64")}` } : {};
}

/**
 * A value each field type accepts, so the synthetic inquiry validates like a
 * real one. Free-text and email values carry the probe's unique identity.
 */
function syntheticValue(field: { type: string; options?: string[] }, probeId: string) {
  if (field.type === "email") return `monitor+${probeId}@lodesta.example`;
  if (field.type === "phone") return "(512) 555-0100";
  if (field.type === "select" || field.type === "radio") return field.options?.[0] ?? probeId;
  // A checked box submits its value, or "on" like a browser.
  if (field.type === "checkbox") return field.options?.[0] ?? "on";
  return `Lodesta synthetic monitoring check ${probeId}`;
}

function certificateExpiry(hostname: string) {
  return new Promise<Date | undefined>((resolvePromise, reject) => {
    const socket = connect({ host: hostname, port: 443, servername: hostname, timeout: 10_000 }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      resolvePromise(certificate?.valid_to ? new Date(certificate.valid_to) : undefined);
    });
    socket.on("error", reject);
    socket.on("timeout", () => { socket.destroy(); reject(new Error("tls_timeout")); });
  });
}

export const siteMonitor = createSiteMonitor({
  checks: siteMonitorRepository,
  platform: sitePlatformRepository,
  domains: platformOperationsRepository,
  alerts: ownerNotificationRepository,
  inquiries: siteCapabilityRepository,
  fetch: (input, init) => fetch(input, init),
  certificateExpiry,
  appOrigin: configuredAppOriginOrDefault,
  syntheticFormSiteId: () => process.env.LODESTA_MONITOR_SYNTHETIC_SITE_ID?.trim() || undefined
});

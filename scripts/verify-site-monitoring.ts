import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalOwnerNotificationRepository } from "../packages/owner-notifications";
import { createLocalSiteMonitorRepository, createSiteMonitor } from "../packages/site-monitoring";
import type { PlatformSiteRecord } from "../packages/site-contracts";

// Published sites are probed every five minutes and forms every fifteen; two
// failed checks in a row alert an operator once per episode.
const directory = await mkdtemp(join(tmpdir(), "lodesta-site-monitor-"));
try {
  const checks = createLocalSiteMonitorRepository(join(directory, "checks.json"));
  const alerts = createLocalOwnerNotificationRepository(join(directory, "alerts.json"));
  const sites: Array<Partial<PlatformSiteRecord>> = [
    { id: "site_live", slug: "crawford-pest", status: "active", publishedVersionId: "version_live" },
    { id: "site_off", slug: "chets-pest", status: "offline", publishedVersionId: "version_off" },
    { id: "site_draft", slug: "draft", status: "draft" }
  ];
  let healthy = true;
  const requested: string[] = [];
  const syntheticPosts: Array<{ internal: boolean; body: string }> = [];
  const html = `<html><head><script src="/_lodesta/runtime/site-runtime-v4.js"></script></head><body></body></html>`;
  const monitor = createSiteMonitor({
    checks,
    alerts,
    platform: {
      listSites: async () => sites as PlatformSiteRecord[],
      getSiteVersion: async (id) => ({ id, publicBuildInputId: `input_${id}`, formDefinitionIds: ["form_1"] }) as never,
      getPublicBuildInput: async () => ({ forms: [{ id: "form_1", fields: [{ id: "name", type: "text" }, { id: "phone", type: "tel" }] }] }) as never
    },
    domains: { listDomains: async () => [{ siteId: "site_live", hostname: "www.crawford.example", status: "active" }] as never },
    fetch: (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/forms/submit")) {
        syntheticPosts.push({ internal: Boolean(new Headers(init?.headers).get("x-lodesta-internal-traffic")), body: String(init?.body) });
        return Response.json({ accepted: true, submissionKind: "synthetic" });
      }
      if (url.includes("/_lodesta/runtime/")) return new Response("/* runtime */", { status: healthy ? 200 : 404 });
      if (url.includes("chets-pest")) return new Response("unavailable", { status: 503 });
      return new Response(html, {
        status: healthy ? 200 : 500,
        headers: { "content-security-policy": "default-src 'none'; script-src 'self'", "x-lodesta-site-version": "version_live" }
      });
    }) as typeof fetch,
    certificateExpiry: async () => new Date("2027-01-01T00:00:00.000Z"),
    appOrigin: () => "https://app.lodesta.example",
    syntheticFormSiteId: () => "site_live"
  });
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 25, 12, minutes));

  const first = await monitor.runDueChecks(at(0));
  assert.deepEqual(first.map((check) => `${check.siteId}:${check.kind}:${check.ok}`), ["site_live:site:true", "site_live:form:true", "site_off:site:true"],
    "A live site, its form, and an offline site answering 503 are all healthy; drafts are not probed.");
  assert(requested.includes("https://www.crawford.example/"), "A site with a live domain is probed at its domain.");
  assert.deepEqual(syntheticPosts.map((post) => post.internal), [true], "The synthetic inquiry is labelled as Lodesta's own traffic.");
  assert.equal((await monitor.runDueChecks(at(3))).length, 0, "Checks are not repeated before they are due.");

  healthy = false;
  assert.equal((await monitor.runDueChecks(at(5))).find((check) => check.kind === "site")?.ok, false);
  assert.equal((await alerts.list()).length, 0, "One failed check does not alert.");
  await monitor.runDueChecks(at(10));
  const episode = await alerts.list();
  assert.deepEqual(episode.map((alert) => [alert.kind, alert.audience, alert.siteId]), [["site_unreachable", "operator", "site_live"]]);
  await monitor.runDueChecks(at(15));
  assert.equal((await alerts.list()).filter((alert) => alert.kind === "site_unreachable").length, 1, "A continuing failure alerts once.");

  healthy = true;
  await monitor.runDueChecks(at(20));
  healthy = false;
  await monitor.runDueChecks(at(25));
  await monitor.runDueChecks(at(30));
  assert.equal((await alerts.list()).filter((alert) => alert.kind === "site_unreachable").length, 2, "A new failure episode alerts again.");

  console.log(JSON.stringify({ ok: true, probes: "site-form-offline", alerts: "once-per-episode", synthetic: "labelled" }));
} finally {
  await rm(directory, { recursive: true, force: true });
}

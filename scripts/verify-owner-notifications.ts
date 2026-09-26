import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalOwnerNotificationRepository, createOwnerNotificationService } from "../packages/owner-notifications";
import type { PlatformSiteRecord, SiteAgentRun } from "../packages/site-contracts";

const directory = await mkdtemp(join(tmpdir(), "lodesta-owner-notifications-"));
try {
  const notifications = createLocalOwnerNotificationRepository(join(directory, "notifications.json"));
  const sites: Record<string, Partial<PlatformSiteRecord>> = {
    site_owned: { id: "site_owned", slug: "haynes-pest", ownerUserId: "user_owner" },
    site_unconfirmed: { id: "site_unconfirmed", slug: "unconfirmed", ownerUserId: "user_unconfirmed" },
    site_prospect: { id: "site_prospect", slug: "prospect" }
  };
  const runs: Record<string, Partial<SiteAgentRun>> = {};
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  let sendResult: "sent" | "failed" = "sent";
  let operatorEmail: string | undefined = "alerts@team.example";
  const savedSubmissions: Array<{ id: string; siteId: string; inquiryId: string; metadata: Record<string, unknown> }> = [];
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 25, 12, minutes));
  const service = createOwnerNotificationService({
    notifications,
    platform: {
      getSite: async (id) => sites[id] as PlatformSiteRecord | undefined,
      getAgentRun: async (id) => runs[id] as SiteAgentRun | undefined
    },
    capabilities: {
      getInquiry: async (siteId, inquiryId) => ({ id: inquiryId, siteId, contactName: "Dana R.", contactPhone: "(863) 555-0142", contactEmail: "dana@visitor.example" }) as never,
      listInquiryEvents: async (inquiryId) => [{ id: `${inquiryId}_event`, inquiryId, messageText: "Ants in the kitchen." }] as never,
      listRecentFormSubmissions: async () => savedSubmissions as never
    },
    domains: {
      getDomainById: async (id) => id === "domain_1" ? { id, siteId: "site_owned", hostname: "www.haynespest.example", status: "attention_required" } as never : null
    },
    reports: {
      getProspectReportLead: async (id) => id === "lead_1" ? { id, reportId: "report_1", email: "asker@visitor.example", createdAt: at(0).toISOString() } : null,
      getProspectReport: async (id) => id === "report_1" ? { id, status: "completed", result: { siteUnderstanding: { businessName: "Haynes Pest" } } } as never : null
    },
    reportAccessLink: async (reportId, leadId) => `https://app.lodesta.example/website-health-report/${reportId}#access=secret-for-${leadId}`,
    // Only the account's confirmed sign-in email is ever a recipient.
    accountEmail: async (userId) => userId === "user_owner" ? "owner@account.example" : undefined,
    send: async (message) => {
      if (sendResult === "failed") return { status: "failed", error: "email_provider_status_503" };
      sent.push(message);
      return { status: "sent" };
    },
    appOrigin: () => "https://app.lodesta.example",
    operatorEmail: () => operatorEmail
  });


  // A lead reaches the owner's account email once, with its contact details and an inbox link.
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_1", eventId: "inq_1_event" }, at(0));
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_1", eventId: "inq_1_event" }, at(0));
  assert.deepEqual((await service.deliverDue({ workerId: "w", now: at(0) })).map((item) => item.status), ["sent"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "owner@account.example");
  assert.equal(sent[0]!.subject, "New inquiry from Dana R.");
  assert.match(sent[0]!.text, /\(863\) 555-0142/);
  assert.match(sent[0]!.text, /Ants in the kitchen\./);
  assert.match(sent[0]!.text, /https:\/\/app\.lodesta\.example\/workspace\/haynes-pest\/leads/);

  // Owner tests are labelled; synthetic checks are recorded but email nobody.
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_2", eventId: "inq_2_event", submissionKind: "owner_test" }, at(0));
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_3", eventId: "inq_3_event", submissionKind: "synthetic" }, at(0));
  await service.deliverDue({ workerId: "w", now: at(1) });
  assert.equal(sent.find((item) => item.subject.startsWith("[Test] "))?.to, "owner@account.example");
  assert.equal(sent.filter((item) => item.to === "alerts@team.example").length, 0);
  assert.equal((await notifications.list({ statuses: ["suppressed"] })).find((item) => item.kind === "lead")?.suppressedReason, "synthetic_check");

  // Unowned prospect sites, unconfirmed accounts and an unset team address notify nobody.
  operatorEmail = undefined;
  await service.enqueueLead({ siteId: "site_prospect", inquiryId: "inq_4", eventId: "inq_4_event" }, at(0));
  await service.enqueueLead({ siteId: "site_unconfirmed", inquiryId: "inq_5", eventId: "inq_5_event" }, at(0));
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_6", eventId: "inq_6_event", submissionKind: "synthetic" }, at(0));
  const before = sent.length;
  assert.deepEqual((await service.deliverDue({ workerId: "w", now: at(2) })).map((item) => item.status), ["suppressed", "suppressed", "suppressed"]);
  assert.equal(sent.length, before);
  const suppressed = await notifications.list({ statuses: ["suppressed"] });
  assert.deepEqual(suppressed.map((item) => item.suppressedReason).sort(), ["owner_email_unconfirmed", "site_unowned", "synthetic_check", "synthetic_check"]);

  // Provider failures retry with backoff, then fail visibly without losing the record.
  sendResult = "failed";
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_7", eventId: "inq_7_event" }, at(0));
  const outcomes: string[] = [];
  for (const minute of [3, 5, 11, 42, 163]) {
    outcomes.push(...(await service.deliverDue({ workerId: "w", now: at(minute) })).map((item) => item.status));
  }
  assert.deepEqual(outcomes, ["retry", "retry", "retry", "retry", "failed"]);
  const failed = (await notifications.list({ statuses: ["failed"] }))[0];
  assert.equal(failed?.attempts, 5);
  assert.equal(failed?.lastError, "email_provider_status_503");
  sendResult = "sent";

  // A worker that dies mid-send does not strand the notification.
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_8", eventId: "inq_8_event" }, at(0));
  assert.equal((await notifications.claimDue("crashed", 10, at(200))).length, 1);
  assert.equal((await service.deliverDue({ workerId: "w", now: at(202) })).length, 0);
  assert.deepEqual((await service.deliverDue({ workerId: "w", now: at(206) })).map((item) => item.status), ["sent"]);

  // Each run outcome notifies once; in-progress runs notify nobody.
  const run = (id: string, patch: Partial<SiteAgentRun>) => (runs[id] = { id, siteId: "site_owned", kind: "edit", executionNumber: 1, ...patch }) as SiteAgentRun;
  assert.equal(await service.enqueueRun(run("run_ready", { status: "succeeded", candidateVersionId: "version_1" }), at(299)), true);
  assert.equal(await service.enqueueRun(run("run_ready", { status: "succeeded", candidateVersionId: "version_1" }), at(299)), false);
  assert.equal(await service.enqueueRun(run("run_noop", { status: "succeeded", candidateVersionId: "version_1", kind: "edit", exactParentRevisionId: "revision_1", outputRevisionId: "revision_1" }), at(299)), false,
    "An edit that changed nothing announced a change to review.");
  assert.equal(await service.enqueueRun(run("run_question", { status: "needs_input", inputQuestion: "Which phone number should customers call?" }), at(299)), true);
  assert.equal(await service.enqueueRun(run("run_failed", { status: "failed", retryableByOwner: true }), at(299)), true);
  assert.equal(await service.enqueueRun(run("run_active", { status: "running" }), at(299)), false);
  const runSent = sent.length;
  await service.deliverDue({ workerId: "w", now: at(300) });
  const runMessages = sent.slice(runSent);
  assert.deepEqual(runMessages.map((item) => item.subject).sort(), [
    "Your website change didn't finish",
    "Your website change is ready to review",
    "Your website needs a quick answer"
  ]);
  assert(runMessages.every((item) => item.to === "owner@account.example"));
  assert.match(runMessages.find((item) => item.subject.includes("answer"))!.text, /Which phone number should customers call\?/);
  assert.match(runMessages.find((item) => item.subject.includes("didn't"))!.text, /Your live website has not changed\./);

  // A saved inquiry whose notification was never recorded is picked up by reconciliation, once.
  savedSubmissions.push({ id: "inq_9_event", siteId: "site_owned", inquiryId: "inq_9", metadata: {} });
  assert.equal(await service.reconcileLeads(at(500), at(500)), 1);
  assert.equal(await service.reconcileLeads(at(500), at(500)), 0, "Reconciliation never duplicates a lead notification.");
  const reconciledSent = sent.length;
  await service.deliverDue({ workerId: "w", now: at(501) });
  assert.equal(sent[reconciledSent]?.subject, "New inquiry from Dana R.");

  // Reconciliation pages through every submission in its window, not only the newest batch.
  {
    const many = Array.from({ length: 1_203 }, (_, index) => ({
      id: `bulk_${index}_event`, siteId: "site_owned", inquiryId: `bulk_${index}`, metadata: {},
      createdAt: new Date(Date.UTC(2026, 8, 25, 11, 0, 0, 0) - index * 1_000).toISOString()
    }));
    const paged = createOwnerNotificationService({
      notifications: createLocalOwnerNotificationRepository(join(directory, "paged.json")),
      platform: { getSite: async () => undefined, getAgentRun: async () => undefined },
      capabilities: {
        getInquiry: async () => null, listInquiryEvents: async () => [],
        listRecentFormSubmissions: async (_since, limit, before) => many.filter((event) => !before || event.createdAt < before).slice(0, limit) as never
      },
      domains: { getDomainById: async () => null },
      reports: { getProspectReportLead: async () => null, getProspectReport: async () => null },
      reportAccessLink: async () => "",
      accountEmail: async () => undefined,
      send: async () => ({ status: "sent" }),
      appOrigin: () => "https://app.lodesta.example",
      operatorEmail: () => undefined
    });
    assert.equal(await paged.reconcileLeads(at(0), at(0)), 1_203, "Reconciliation stopped at the first page.");
  }

  // A live domain that stops pointing to Lodesta is reported once per episode.
  assert.equal(await service.enqueueDomainAttention({ id: "domain_1", siteId: "site_owned", attentionRequiredAt: "2026-09-25T12:00:00.000Z" }, at(399)), true);
  assert.equal(await service.enqueueDomainAttention({ id: "domain_1", siteId: "site_owned", attentionRequiredAt: "2026-09-25T12:00:00.000Z" }, at(399)), false);
  const domainSent = sent.length;
  await service.deliverDue({ workerId: "w", now: at(400) });
  assert.equal(sent[domainSent]?.subject, "www.haynespest.example isn't pointing to your website");
  assert.match(sent[domainSent]!.text, /workspace\/haynes-pest\/settings#domain/);

  console.log(JSON.stringify({ ok: true, lead: "owner-account-only", dedupe: "pass", retries: "bounded", staleClaims: "recovered", runs: "once-per-outcome" }));
  // A report access email goes to the address typed into the report form, with
  // a link minted at send time; each request sends, and it belongs to no site.
  {
    const before = sent.length;
    assert.equal(await service.enqueueReportAccess("lead_1", at(0)), true);
    assert.equal(await service.enqueueReportAccess("lead_1", at(0)), true, "A resend was deduplicated away.");
    assert.equal(await service.enqueueReportAccess("lead_missing", at(0)), true);
    assert.deepEqual((await service.deliverDue({ workerId: "w", now: at(0) })).map((item) => item.status).sort(), ["sent", "sent", "suppressed"]);
    const reportEmails = sent.slice(before);
    assert.deepEqual(reportEmails.map((message) => message.to), ["asker@visitor.example", "asker@visitor.example"]);
    assert.equal(reportEmails[0]!.subject, "Your Website Health Report for Haynes Pest");
    assert.match(reportEmails[0]!.text, /#access=secret-for-lead_1/);
    assert.ok((await notifications.list({ statuses: ["sent"] })).some((item) => item.kind === "report_access" && item.siteId === undefined));
  }

} finally {
  await rm(directory, { recursive: true, force: true });
}

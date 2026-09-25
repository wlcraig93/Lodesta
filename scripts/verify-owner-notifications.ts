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
  const service = createOwnerNotificationService({
    notifications,
    platform: {
      getSite: async (id) => sites[id] as PlatformSiteRecord | undefined,
      getAgentRun: async (id) => runs[id] as SiteAgentRun | undefined
    },
    capabilities: {
      getInquiry: async (siteId, inquiryId) => ({ id: inquiryId, siteId, contactName: "Dana R.", contactPhone: "(863) 555-0142", contactEmail: "dana@visitor.example" }) as never,
      listInquiryEvents: async (inquiryId) => [{ id: `${inquiryId}_event`, inquiryId, messageText: "Ants in the kitchen." }] as never
    },
    domains: {
      getDomainById: async (id) => id === "domain_1" ? { id, siteId: "site_owned", hostname: "www.haynespest.example", status: "attention_required" } as never : null
    },
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
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 25, 12, minutes));

  // A lead reaches the owner's account email once, with its contact details and an inbox link.
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_1", eventId: "inq_1_event" });
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_1", eventId: "inq_1_event" });
  assert.deepEqual((await service.deliverDue({ workerId: "w", now: at(0) })).map((item) => item.status), ["sent"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "owner@account.example");
  assert.equal(sent[0]!.subject, "New inquiry from Dana R.");
  assert.match(sent[0]!.text, /\(863\) 555-0142/);
  assert.match(sent[0]!.text, /Ants in the kitchen\./);
  assert.match(sent[0]!.text, /https:\/\/app\.lodesta\.example\/workspace\/haynes-pest\/leads/);

  // Owner tests are labelled; synthetic checks go only to the team address.
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_2", eventId: "inq_2_event", submissionKind: "owner_test" });
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_3", eventId: "inq_3_event", submissionKind: "synthetic" });
  await service.deliverDue({ workerId: "w", now: at(1) });
  assert.equal(sent.find((item) => item.subject.startsWith("[Test] "))?.to, "owner@account.example");
  assert.equal(sent.filter((item) => item.to === "alerts@team.example").length, 1);

  // Unowned prospect sites, unconfirmed accounts and an unset team address notify nobody.
  operatorEmail = undefined;
  await service.enqueueLead({ siteId: "site_prospect", inquiryId: "inq_4", eventId: "inq_4_event" });
  await service.enqueueLead({ siteId: "site_unconfirmed", inquiryId: "inq_5", eventId: "inq_5_event" });
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_6", eventId: "inq_6_event", submissionKind: "synthetic" });
  const before = sent.length;
  assert.deepEqual((await service.deliverDue({ workerId: "w", now: at(2) })).map((item) => item.status), ["suppressed", "suppressed", "suppressed"]);
  assert.equal(sent.length, before);
  const suppressed = await notifications.list({ statuses: ["suppressed"] });
  assert.deepEqual(suppressed.map((item) => item.suppressedReason).sort(), ["operator_email_unset", "owner_email_unconfirmed", "site_unowned"]);

  // Provider failures retry with backoff, then fail visibly without losing the record.
  sendResult = "failed";
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_7", eventId: "inq_7_event" });
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
  await service.enqueueLead({ siteId: "site_owned", inquiryId: "inq_8", eventId: "inq_8_event" });
  assert.equal((await notifications.claimDue("crashed", 10, at(200))).length, 1);
  assert.equal((await service.deliverDue({ workerId: "w", now: at(202) })).length, 0);
  assert.deepEqual((await service.deliverDue({ workerId: "w", now: at(206) })).map((item) => item.status), ["sent"]);

  // Each run outcome notifies once; in-progress runs notify nobody.
  const run = (id: string, patch: Partial<SiteAgentRun>) => (runs[id] = { id, siteId: "site_owned", kind: "edit", executionNumber: 1, ...patch }) as SiteAgentRun;
  assert.equal(await service.enqueueRun(run("run_ready", { status: "succeeded", candidateVersionId: "version_1" })), true);
  assert.equal(await service.enqueueRun(run("run_ready", { status: "succeeded", candidateVersionId: "version_1" })), false);
  assert.equal(await service.enqueueRun(run("run_question", { status: "needs_input", inputQuestion: "Which phone number should customers call?" })), true);
  assert.equal(await service.enqueueRun(run("run_failed", { status: "failed", retryableByOwner: true })), true);
  assert.equal(await service.enqueueRun(run("run_active", { status: "running" })), false);
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

  // A live domain that stops pointing to Lodesta is reported once per episode.
  assert.equal(await service.enqueueDomainAttention({ id: "domain_1", siteId: "site_owned", attentionRequiredAt: "2026-09-25T12:00:00.000Z" }), true);
  assert.equal(await service.enqueueDomainAttention({ id: "domain_1", siteId: "site_owned", attentionRequiredAt: "2026-09-25T12:00:00.000Z" }), false);
  const domainSent = sent.length;
  await service.deliverDue({ workerId: "w", now: at(400) });
  assert.equal(sent[domainSent]?.subject, "www.haynespest.example isn't pointing to your website");
  assert.match(sent[domainSent]!.text, /workspace\/haynes-pest\/settings#domain/);

  console.log(JSON.stringify({ ok: true, lead: "owner-account-only", dedupe: "pass", retries: "bounded", staleClaims: "recovered", runs: "once-per-outcome" }));
} finally {
  await rm(directory, { recursive: true, force: true });
}

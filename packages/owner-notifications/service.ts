import { configuredAppOriginOrDefault } from "@/lib/app-origin";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { sendTransactionalEmail, type TransactionalEmailResult } from "@/lib/transactional-email";
import { siteCapabilityRepository, type SiteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import { issueProspectReportAccessGrant, prospectReportEmailLink } from "@/packages/acquisition/report-access";
import { platformOperationsRepository, type PlatformOperationsRepository } from "@/packages/platform-operations";
import type { PlatformSiteRecord, SiteAgentRun } from "@/packages/site-contracts";
import { ownerNotificationRepository, type OwnerNotification, type OwnerNotificationRepository } from "./repository";

/** Retry delays after each failed attempt; the notification fails for good after the last. */
const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export type OwnerNotificationDependencies = {
  notifications: OwnerNotificationRepository;
  platform: Pick<SitePlatformRepository, "getSite" | "getAgentRun">;
  capabilities: Pick<SiteCapabilityRepository, "getInquiry" | "listInquiryEvents" | "listRecentFormSubmissions">;
  domains: Pick<PlatformOperationsRepository, "getDomainById">;
  reports: Pick<PlatformOperationsRepository, "getProspectReport" | "getProspectReportLead">;
  /** A fresh report access link for a lead; the secret exists only in the email. */
  reportAccessLink(reportId: string, leadId: string): Promise<string>;
  /** The confirmed sign-in email of an account, or undefined when it has none. */
  accountEmail(userId: string): Promise<string | undefined>;
  send(input: { to: string; subject: string; text: string }): Promise<TransactionalEmailResult>;
  appOrigin(): string;
  operatorEmail(): string | undefined;
};

export function createOwnerNotificationService(deps: OwnerNotificationDependencies) {
  return {
    /**
     * Records a report access email for the address a requester typed into the
     * report form. Each request is its own email, so a resend always sends.
     */
    enqueueReportAccess(leadId: string, now = new Date()) {
      return deps.notifications.enqueue({
        kind: "report_access",
        subjectId: leadId,
        dedupeKey: `report_access:${leadId}:${crypto.randomUUID()}`,
        audience: "requester",
        test: false
      }, now);
    },

    /**
     * Records a lead notification. Never throws: the inquiry is already saved,
     * and a notification problem must not change what the visitor sees.
     */
    async enqueueLead(input: { siteId: string; inquiryId: string; eventId: string; submissionKind?: "owner_test" | "synthetic" }, now = new Date()) {
      try {
        await recordLead(input, now);
      } catch (error) {
        // reconcileLeads records it on the worker's next pass.
        console.error(JSON.stringify({ event: "owner_notification_enqueue_failed", kind: "lead", siteId: input.siteId, inquiryId: input.inquiryId, error: String(error) }));
      }
    },

    /**
     * Records a lead notification for every recent visitor submission that has
     * none, so a failed enqueue after a saved inquiry is never final.
     */
    async reconcileLeads(since: Date, now = new Date()) {
      let recorded = 0;
      // Page through every submission in the window, not just the newest batch.
      let before: string | undefined;
      for (;;) {
        const page = await deps.capabilities.listRecentFormSubmissions(since.toISOString(), 500, before);
        for (const event of page) {
          const kind = event.metadata?.submissionKind;
          const submissionKind = kind === "owner_test" || kind === "synthetic" ? kind : undefined;
          if (await recordLead({ siteId: event.siteId, inquiryId: event.inquiryId, eventId: event.id, submissionKind }, now)) recorded += 1;
        }
        if (page.length < 500) return recorded;
        before = page.at(-1)!.createdAt;
      }
    },

    /**
     * Owners start builds and edits themselves and see the outcome in the
     * editor, so no run outcome is ever emailed to them. The one run email is
     * the operator alert for a failure the owner cannot retry, because the
     * owner is told Lodesta will look into it. Re-engaging owners who left an
     * unpublished site is a separate lifecycle feature, not a builder email.
     */
    async enqueueRun(run: SiteAgentRun, now = new Date()) {
      if (run.status !== "failed" || run.retryableByOwner) return false;
      return deps.notifications.enqueue({
        siteId: run.siteId,
        kind: "run_failed",
        subjectId: run.id,
        dedupeKey: `operator:run_failed:${run.id}:${run.executionNumber}`,
        audience: "operator",
        test: false
      }, now);
    },

    /** Records one notice each time a live domain starts needing attention. */
    async enqueueDomainAttention(domain: { id: string; siteId: string; attentionRequiredAt?: string }, now = new Date()) {
      return deps.notifications.enqueue({
        siteId: domain.siteId,
        kind: "domain_attention",
        subjectId: domain.id,
        dedupeKey: `domain_attention:${domain.id}:${domain.attentionRequiredAt ?? "unknown"}`,
        audience: "owner",
        test: false
      }, now);
    },

    async deliverDue(input: { workerId: string; limit?: number; now?: Date }) {
      const claimed = await deps.notifications.claimDue(input.workerId, input.limit ?? 20, input.now);
      const outcomes: Array<{ id: string; status: "sent" | "suppressed" | "retry" | "failed" }> = [];
      for (const notification of claimed) {
        outcomes.push({ id: notification.id, status: await deliver(notification, input.now ?? new Date()) });
      }
      return outcomes;
    }
  };

  function recordLead(input: { siteId: string; inquiryId: string; eventId: string; submissionKind?: "owner_test" | "synthetic" }, now: Date) {
    return deps.notifications.enqueue({
      siteId: input.siteId,
      kind: "lead",
      // The inquiry event is the subject, so a repeat inquiry from the same person notifies again.
      subjectId: `${input.inquiryId}/${input.eventId}`,
      dedupeKey: `lead:${input.eventId}`,
      audience: input.submissionKind === "synthetic" ? "operator" : "owner",
      test: Boolean(input.submissionKind)
    }, now);
  }

  async function deliver(notification: OwnerNotification, now: Date): Promise<"sent" | "suppressed" | "retry" | "failed"> {
    try {
      if (notification.audience === "requester") return await deliverReportAccess(notification, now);
      const site = notification.siteId ? await deps.platform.getSite(notification.siteId) : undefined;
      if (!site) {
        await deps.notifications.markSuppressed(notification.id, "site_missing", now);
        return "suppressed";
      }
      if (notification.kind === "lead" && notification.audience === "operator") {
        // Lodesta's own synthetic check: recording it proves the pipeline; nobody is emailed.
        await deps.notifications.markSuppressed(notification.id, "synthetic_check", now);
        return "suppressed";
      }
      const recipient = notification.audience === "operator"
        ? deps.operatorEmail()
        : site.ownerUserId ? await deps.accountEmail(site.ownerUserId) : undefined;
      if (!recipient) {
        // Unowned prospect sites have nobody to tell; business contact data is never a recipient.
        const reason = notification.audience === "operator" ? "operator_email_unset" : site.ownerUserId ? "owner_email_unconfirmed" : "site_unowned";
        await deps.notifications.markSuppressed(notification.id, reason, now);
        return "suppressed";
      }
      const message = await compose(notification, site);
      if (!message) {
        await deps.notifications.markSuppressed(notification.id, "subject_missing", now);
        return "suppressed";
      }
      return await send(notification, recipient, message, now);
    } catch (error) {
      return scheduleRetry(notification, error instanceof Error ? error.message : String(error), now);
    }
  }

  /** The recipient is the address typed into the report form, never business contact data. */
  async function deliverReportAccess(notification: OwnerNotification, now: Date) {
    const lead = await deps.reports.getProspectReportLead(notification.subjectId);
    const report = lead ? await deps.reports.getProspectReport(lead.reportId) : null;
    if (!lead || !report || report.status !== "completed" || !report.result) {
      await deps.notifications.markSuppressed(notification.id, "subject_missing", now);
      return "suppressed" as const;
    }
    const businessName = report.result.siteUnderstanding.businessName;
    return send(notification, lead.email, {
      subject: `Your Website Health Report${businessName ? ` for ${businessName}` : ""}`,
      text: [
        "Your Lodesta Website Health Report is ready.",
        "",
        "Open the complete report on any device:",
        await deps.reportAccessLink(report.id, lead.id),
        "",
        "This email delivers the report you requested. It does not subscribe you to marketing messages.",
        "",
        "The access link expires in 30 days."
      ].join("\n")
    }, now);
  }

  async function send(notification: OwnerNotification, recipient: string, message: { subject: string; text: string }, now: Date): Promise<"sent" | "suppressed" | "retry" | "failed"> {
    try {
      const result = await deps.send({ to: recipient, ...message });
      if (result.status === "sent") {
        await deps.notifications.markSent(notification.id, now);
        return "sent";
      }
      if (result.status === "skipped") {
        await deps.notifications.markSuppressed(notification.id, result.reason, now);
        return "suppressed";
      }
      return scheduleRetry(notification, result.error, now);
    } catch (error) {
      return scheduleRetry(notification, error instanceof Error ? error.message : String(error), now);
    }
  }

  async function scheduleRetry(notification: OwnerNotification, error: string, now: Date) {
    const delay = retryDelaysMs[notification.attempts - 1];
    await deps.notifications.markFailed(notification.id, error, delay === undefined ? null : new Date(now.getTime() + delay), now);
    if (delay === undefined) {
      console.error(JSON.stringify({ event: "owner_notification_failed", notificationId: notification.id, siteId: notification.siteId, kind: notification.kind, attempts: notification.attempts, error }));
      return "failed";
    }
    return "retry";
  }

  async function compose(notification: OwnerNotification, site: PlatformSiteRecord) {
    const workspace = `${deps.appOrigin()}/workspace/${encodeURIComponent(site.slug)}`;
    const test = notification.test ? "[Test] " : "";
    if (notification.kind === "lead") {
      const events = await findInquiryEvent(site.id, notification.subjectId);
      if (!events) return undefined;
      const { inquiry, event } = events;
      const who = inquiry.contactName || inquiry.contactEmail || inquiry.contactPhone || "a visitor";
      return {
        subject: `${test}New inquiry from ${who}`,
        text: [
          notification.test ? "This is a test submission from your own account." : "Someone contacted your business through your website.",
          "",
          ...(inquiry.contactName ? [`Name: ${inquiry.contactName}`] : []),
          ...(inquiry.contactPhone ? [`Phone: ${inquiry.contactPhone}`] : []),
          ...(inquiry.contactEmail ? [`Email: ${inquiry.contactEmail}`] : []),
          ...(event.messageText ? ["", event.messageText] : []),
          "",
          `See it in your inbox: ${workspace}/leads`
        ].join("\n")
      };
    }
    if (notification.kind === "site_unreachable" || notification.kind === "form_unreachable") {
      const what = notification.kind === "site_unreachable" ? "published site" : "inquiry form";
      return {
        subject: `[Lodesta monitor] ${site.slug}: ${what} failing`,
        text: [
          `Two checks in a row failed for the ${what} of ${site.slug}.`,
          `Details and history: ${deps.appOrigin()}/admin/sites/${encodeURIComponent(site.slug)}`
        ].join("\n\n")
      };
    }
    if (notification.kind === "domain_attention") {
      const domain = await deps.domains.getDomainById(notification.subjectId);
      if (!domain || domain.status !== "attention_required") return undefined;
      return {
        subject: `${domain.hostname} isn't pointing to your website`,
        text: [
          `${domain.hostname} has stopped pointing to your Lodesta website for more than a day, so visitors may not reach it.`,
          "This usually means a DNS record changed at your domain provider. Your Lodesta address still works.",
          `Check the records here: ${workspace}/settings#domain`
        ].join("\n\n")
      };
    }
    // Run outcomes reach only the operator; owners see them in the editor.
    const run = notification.audience === "operator" ? await deps.platform.getAgentRun(notification.subjectId) : undefined;
    if (!run) return undefined;
    return {
      subject: `[Lodesta monitor] ${site.slug}: ${run.kind.replaceAll("_", " ")} failed (${run.failureCode ?? "unknown"})`,
      text: [
        `Run ${run.id} failed and the owner can't retry it.`,
        run.failureReason ? `Reason: ${run.failureReason}` : "",
        `Run details: ${deps.appOrigin()}/admin/runs/${encodeURIComponent(run.id)}`
      ].filter(Boolean).join("\n\n")
    };
  }

  async function findInquiryEvent(siteId: string, subjectId: string) {
    const [inquiryId, eventId] = subjectId.split("/");
    if (!inquiryId || !eventId) return undefined;
    const inquiry = await deps.capabilities.getInquiry(siteId, inquiryId);
    const event = inquiry ? (await deps.capabilities.listInquiryEvents(inquiryId)).find((item) => item.id === eventId) : undefined;
    return inquiry && event ? { inquiry, event } : undefined;
  }
}

async function confirmedAccountEmail(userId: string) {
  const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(userId);
  if (error) throw new Error(`Load account email: ${error.message}`);
  return data.user?.email && data.user.email_confirmed_at ? data.user.email : undefined;
}

export const ownerNotificationService = createOwnerNotificationService({
  notifications: ownerNotificationRepository,
  platform: sitePlatformRepository,
  capabilities: siteCapabilityRepository,
  domains: platformOperationsRepository,
  reports: platformOperationsRepository,
  reportAccessLink: async (reportId, leadId) => prospectReportEmailLink(configuredAppOriginOrDefault(), reportId, (await issueProspectReportAccessGrant({ reportId, leadId })).secret),
  accountEmail: confirmedAccountEmail,
  send: sendTransactionalEmail,
  appOrigin: configuredAppOriginOrDefault,
  operatorEmail: () => process.env.LODESTA_OPERATOR_ALERT_EMAIL?.trim() || undefined
});

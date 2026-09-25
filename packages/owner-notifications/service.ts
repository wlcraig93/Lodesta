import { configuredAppOriginOrDefault } from "@/lib/app-origin";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { sendTransactionalEmail, type TransactionalEmailResult } from "@/lib/transactional-email";
import { siteCapabilityRepository, type SiteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository, type PlatformOperationsRepository } from "@/packages/platform-operations";
import type { PlatformSiteRecord, SiteAgentRun } from "@/packages/site-contracts";
import { ownerNotificationRepository, type OwnerNotification, type OwnerNotificationRepository } from "./repository";

/** Retry delays after each failed attempt; the notification fails for good after the last. */
const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export type OwnerNotificationDependencies = {
  notifications: OwnerNotificationRepository;
  platform: Pick<SitePlatformRepository, "getSite" | "getAgentRun">;
  capabilities: Pick<SiteCapabilityRepository, "getInquiry" | "listInquiryEvents">;
  domains: Pick<PlatformOperationsRepository, "getDomainById">;
  /** The confirmed sign-in email of an account, or undefined when it has none. */
  accountEmail(userId: string): Promise<string | undefined>;
  send(input: { to: string; subject: string; text: string }): Promise<TransactionalEmailResult>;
  appOrigin(): string;
  operatorEmail(): string | undefined;
};

export function createOwnerNotificationService(deps: OwnerNotificationDependencies) {
  return {
    /**
     * Records a lead notification. Never throws: the inquiry is already saved,
     * and a notification problem must not change what the visitor sees.
     */
    async enqueueLead(input: { siteId: string; inquiryId: string; eventId: string; submissionKind?: "owner_test" | "synthetic" }) {
      try {
        await deps.notifications.enqueue({
          siteId: input.siteId,
          kind: "lead",
          // The inquiry event is the subject, so a repeat inquiry from the same person notifies again.
          subjectId: `${input.inquiryId}/${input.eventId}`,
          dedupeKey: `lead:${input.eventId}`,
          audience: input.submissionKind === "synthetic" ? "operator" : "owner",
          test: Boolean(input.submissionKind)
        });
      } catch (error) {
        console.error(JSON.stringify({ event: "owner_notification_enqueue_failed", kind: "lead", siteId: input.siteId, inquiryId: input.inquiryId, error: String(error) }));
      }
    },

    /** Records the notification a run's current state calls for, once per state. */
    async enqueueRun(run: SiteAgentRun) {
      const kind = run.status === "needs_input" ? "run_needs_input"
        : run.status === "failed" ? "run_failed"
        : run.status === "succeeded" && run.candidateVersionId ? "run_ready"
        : undefined;
      if (!kind) return false;
      if (kind === "run_failed" && !run.retryableByOwner) {
        // The owner is told Lodesta will look into it, so an operator must hear about it.
        await deps.notifications.enqueue({
          siteId: run.siteId,
          kind,
          subjectId: run.id,
          dedupeKey: `operator:${kind}:${run.id}:${run.executionNumber}`,
          audience: "operator",
          test: false
        });
      }
      return deps.notifications.enqueue({
        siteId: run.siteId,
        kind,
        subjectId: run.id,
        dedupeKey: `${kind}:${run.id}:${run.executionNumber}`,
        audience: "owner",
        test: false
      });
    },

    /** Records one notice each time a live domain starts needing attention. */
    async enqueueDomainAttention(domain: { id: string; siteId: string; attentionRequiredAt?: string }) {
      return deps.notifications.enqueue({
        siteId: domain.siteId,
        kind: "domain_attention",
        subjectId: domain.id,
        dedupeKey: `domain_attention:${domain.id}:${domain.attentionRequiredAt ?? "unknown"}`,
        audience: "owner",
        test: false
      });
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

  async function deliver(notification: OwnerNotification, now: Date): Promise<"sent" | "suppressed" | "retry" | "failed"> {
    try {
      const site = await deps.platform.getSite(notification.siteId);
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
    const run = await deps.platform.getAgentRun(notification.subjectId);
    if (!run) return undefined;
    const editor = `${workspace}/editor`;
    if (notification.audience === "operator") {
      return {
        subject: `[Lodesta monitor] ${site.slug}: ${run.kind.replaceAll("_", " ")} failed (${run.failureCode ?? "unknown"})`,
        text: [
          `Run ${run.id} failed and the owner can't retry it.`,
          run.failureReason ? `Reason: ${run.failureReason}` : "",
          `Run details: ${deps.appOrigin()}/admin/runs/${encodeURIComponent(run.id)}`
        ].filter(Boolean).join("\n\n")
      };
    }
    if (notification.kind === "run_ready") {
      return {
        subject: run.kind === "initial_build" ? "Your new website is ready to review" : "Your website change is ready to review",
        text: [`Your ${run.kind === "initial_build" ? "website" : "requested change"} is ready. Review it and publish when you're happy:`, editor].join("\n\n")
      };
    }
    if (notification.kind === "run_needs_input") {
      return {
        subject: "Your website needs a quick answer",
        text: [run.inputQuestion ?? "We need one detail from you to continue.", `Answer here: ${editor}`].join("\n\n")
      };
    }
    return {
      subject: "Your website change didn't finish",
      text: [
        "Your live website has not changed.",
        run.retryableByOwner ? "You can try again from the editor:" : "We're looking into it. You can check the editor for details:",
        editor
      ].join("\n\n")
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
  accountEmail: confirmedAccountEmail,
  send: sendTransactionalEmail,
  appOrigin: configuredAppOriginOrDefault,
  operatorEmail: () => process.env.LODESTA_OPERATOR_ALERT_EMAIL?.trim() || undefined
});

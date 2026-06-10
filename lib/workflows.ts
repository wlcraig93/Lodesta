import type { Inquiry, InquiryDelivery, InquiryEvent, SiteBundle, WorkflowDefinition } from "./models";
import { publicInquiry, publicInquiryEvent, workflowTarget } from "./inquiries";
import { validatePublicFetchUrl } from "./url-safety";

type DeliveryInput = Omit<InquiryDelivery, "id" | "createdAt">;
type WorkflowRecorder = (delivery: DeliveryInput) => Promise<InquiryDelivery>;

export async function executeInquiryNotificationWorkflows(
  bundle: SiteBundle,
  inquiry: Inquiry,
  event: InquiryEvent | undefined,
  recordDelivery: WorkflowRecorder
) {
  const workflows = bundle.extensionModel.workflows.filter((workflow) => workflow.trigger === "inquiry_created");
  const deliveries: InquiryDelivery[] = [];

  if (!workflows.length) {
    deliveries.push(
      await recordDelivery({
        siteId: inquiry.siteId,
        inquiryId: inquiry.id,
        eventId: event?.id,
        workflowId: "inquiry_notification_default",
        destination: "crm_placeholder",
        target: "none",
        status: "skipped",
        message: "No inquiry notification workflows are configured."
      })
    );
    return deliveries;
  }

  for (const workflow of workflows) {
    const delivery = await executeWorkflow(bundle, inquiry, event, workflow, recordDelivery);
    deliveries.push(delivery);
  }

  return deliveries;
}

export function aggregateNotificationState(deliveries: InquiryDelivery[]): Inquiry["notificationState"] {
  if (!deliveries.length) return "skipped";
  const sent = deliveries.filter((delivery) => delivery.status === "sent").length;
  const failed = deliveries.filter((delivery) => delivery.status === "failed").length;
  const skipped = deliveries.filter((delivery) => delivery.status === "skipped").length;
  if (failed === 0) return sent > 0 || skipped > 0 ? "completed" : "skipped";
  if (sent > 0 || skipped > 0) return "partial";
  return "failed";
}

async function executeWorkflow(
  bundle: SiteBundle,
  inquiry: Inquiry,
  event: InquiryEvent | undefined,
  workflow: WorkflowDefinition,
  recordDelivery: WorkflowRecorder
) {
  const base = {
    siteId: inquiry.siteId,
    inquiryId: inquiry.id,
    eventId: event?.id,
    workflowId: workflow.id,
    destination: workflow.destination
  };

  try {
    if (workflow.destination === "email") {
      return recordDelivery({
        ...base,
        ...(await deliverEmail(bundle, inquiry, event, workflow))
      });
    }

    if (workflow.destination === "webhook") {
      return recordDelivery({
        ...base,
        ...(await deliverWebhook(bundle, inquiry, event, workflow))
      });
    }

    return recordDelivery({
      ...base,
      target: String(workflow.config.name ?? "CRM"),
      status: "skipped",
      message: "CRM workflow destination is configured as a placeholder for V1."
    });
  } catch (error) {
    return recordDelivery({
      ...base,
      target: workflowTarget(workflow, { fallbackEmail: bundle.businessProfile.email }),
      status: "failed",
      message: "Inquiry notification workflow failed.",
      error: error instanceof Error ? error.message : "Unknown workflow error"
    });
  }
}

async function deliverEmail(bundle: SiteBundle, inquiry: Inquiry, event: InquiryEvent | undefined, workflow: WorkflowDefinition) {
  const target = workflowTarget(workflow, { fallbackEmail: bundle.businessProfile.email });
  if (!target) {
    return {
      target,
      status: "skipped" as const,
      message: "Email workflow skipped because no recipient is configured."
    };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = "Lodesta <notifications@mail.lodesta.com>";
  if (!apiKey) {
    return {
      target,
      status: "skipped" as const,
      message: "Email workflow logged only. Set RESEND_API_KEY to send inquiry notifications."
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: workflowTimeoutSignal(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: target,
      subject: `New inquiry for ${bundle.businessProfile.name}`,
      text: inquirySummaryText(bundle, inquiry, event)
    })
  });

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  return {
    target,
    status: response.ok ? ("sent" as const) : ("failed" as const),
    responseStatus: response.status,
    providerMessageId: payload?.id,
    message: response.ok ? "Inquiry notification email sent." : "Inquiry notification email request failed.",
    error: response.ok ? undefined : JSON.stringify(payload) || (await response.text().catch(() => undefined))
  };
}

async function deliverWebhook(bundle: SiteBundle, inquiry: Inquiry, event: InquiryEvent | undefined, workflow: WorkflowDefinition) {
  const target = workflowTarget(workflow, { fallbackEmail: bundle.businessProfile.email });
  if (!target) {
    return {
      target,
      status: "skipped" as const,
      message: "Webhook workflow skipped because no URL is configured."
    };
  }
  const safeTarget = await validatePublicFetchUrl(target);
  if (!safeTarget.ok) {
    return {
      target,
      status: "failed" as const,
      message: "Webhook delivery blocked by URL safety guardrails.",
      error: safeTarget.error
    };
  }

  const response = await fetch(safeTarget.url, {
    method: "POST",
    signal: workflowTimeoutSignal(),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "inquiry_created",
      siteId: inquiry.siteId,
      siteName: bundle.businessProfile.name,
      inquiry: publicInquiry(inquiry),
      event: event ? publicInquiryEvent(event) : undefined
    })
  });

  return {
    target,
    status: response.ok ? ("sent" as const) : ("failed" as const),
    responseStatus: response.status,
    message: response.ok ? "Inquiry webhook delivered." : "Inquiry webhook request failed.",
    error: response.ok ? undefined : await response.text().catch(() => undefined)
  };
}

function inquirySummaryText(bundle: SiteBundle, inquiry: Inquiry, event: InquiryEvent | undefined) {
  return [
    `New inquiry for ${bundle.businessProfile.name}`,
    `Inquiry: ${inquiry.id}`,
    `Status: ${inquiry.status}`,
    inquiry.contactName ? `Name: ${inquiry.contactName}` : undefined,
    inquiry.contactEmail ? `Email: ${inquiry.contactEmail}` : undefined,
    inquiry.contactPhone ? `Phone: ${inquiry.contactPhone}` : undefined,
    event?.formId ? `Form: ${event.formId}` : undefined,
    event?.createdAt ? `Submitted: ${event.createdAt}` : undefined,
    event?.sourceUrl ? `Source: ${event.sourceUrl}` : undefined,
    "",
    event?.messageText ? event.messageText : undefined,
    event?.payload ? JSON.stringify(event.payload, null, 2) : undefined
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function workflowTimeoutSignal() {
  return AbortSignal.timeout(workflowTimeoutMs());
}

function workflowTimeoutMs() {
  const parsed = Number(process.env.LODESTA_WORKFLOW_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5000;
  return Math.min(Math.max(Math.trunc(parsed), 1000), 30000);
}

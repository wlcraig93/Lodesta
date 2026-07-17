import type { WorkflowDefinition } from "./models";
import { validatePublicHostname } from "./url-safety";

export type UpdateInquiryRoutingInput = {
  siteId: string;
  formId: string;
  notificationEmail?: string;
  webhookUrl?: string;
};

export function applyInquiryRoutingUpdate(workflows: WorkflowDefinition[], input: UpdateInquiryRoutingInput) {
  const webhook = validateWebhookUrl(input.webhookUrl);
  if (!webhook.ok) return webhook;
  return { ok: true as const, workflows: updateNotificationWorkflows(workflows, input, webhook.url) };
}

function updateNotificationWorkflows(workflows: WorkflowDefinition[], input: UpdateInquiryRoutingInput, webhookUrl?: string) {
  const next = workflows.filter((workflow) => workflow.trigger !== "inquiry_created" || workflow.destination === "crm_placeholder");
  const email = cleanString(input.notificationEmail);
  if (email) {
    next.push({
      id: `workflow_${input.formId}_email`,
      trigger: "inquiry_created",
      destination: "email",
      config: { to: email }
    });
  }

  if (webhookUrl) {
    next.push({
      id: `workflow_${input.formId}_webhook`,
      trigger: "inquiry_created",
      destination: "webhook",
      config: { url: webhookUrl }
    });
  }

  return next;
}

function validateWebhookUrl(value: string | undefined): { ok: true; url?: string } | { ok: false; reason: string } {
  const cleaned = cleanString(value);
  if (!cleaned) return { ok: true };

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return { ok: false, reason: "Webhook URL must be a valid absolute URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Webhook URL must use HTTPS or HTTP." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Webhook URL credentials are not allowed." };
  }

  const hostnameCheck = validatePublicHostname(url.hostname);
  if (!hostnameCheck.ok) return { ok: false, reason: `Webhook URL is not allowed: ${hostnameCheck.error}` };
  return { ok: true, url: url.href };
}

function cleanString(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

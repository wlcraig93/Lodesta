import type { FormDefinition, SiteBundle, WorkflowDefinition } from "./models";
import { validatePublicHostname } from "./url-safety";

export type FormFieldSettingsInput = {
  id: string;
  label: string;
  type: FormDefinition["fields"][number]["type"];
  required: boolean;
  options?: string[];
};

export type UpdateFormSettingsInput = {
  siteId: string;
  formId: string;
  name?: string;
  submitLabel?: string;
  fields: FormFieldSettingsInput[];
  notificationEmail?: string;
  webhookUrl?: string;
};

export type UpdateFormSettingsResult =
  | { ok: true; bundle: SiteBundle; form: FormDefinition; workflows: WorkflowDefinition[] }
  | { ok: false; reason: string };

const allowedFieldTypes = new Set<FormFieldSettingsInput["type"]>(["text", "email", "phone", "textarea", "select"]);
const sensitiveFieldPattern = /\b(password|passcode|ssn|social security|credit card|card number|bank account|routing|token|secret)\b/i;

export function applyFormSettingsUpdate(bundle: SiteBundle, input: UpdateFormSettingsInput): UpdateFormSettingsResult {
  const formIndex = bundle.extensionModel.forms.findIndex((form) => form.id === input.formId);
  if (formIndex === -1) return { ok: false, reason: "Form not found." };

  const cleanedFields = cleanFields(input.fields);
  if (cleanedFields.length === 0) return { ok: false, reason: "At least one form field is required." };
  if (cleanedFields.length > 12) return { ok: false, reason: "Launch forms support up to 12 managed fields." };
  if (!cleanedFields.some((field) => field.type === "email" || field.type === "phone")) {
    return { ok: false, reason: "Keep at least one email or phone field so leads remain contactable." };
  }
  if (cleanedFields.some((field) => sensitiveFieldPattern.test(field.label))) {
    return { ok: false, reason: "Forms cannot collect sensitive credentials, government IDs, cards, bank details, tokens, or secrets." };
  }
  const webhook = validateWebhookUrl(input.webhookUrl);
  if (!webhook.ok) return { ok: false, reason: webhook.reason };

  const existing = bundle.extensionModel.forms[formIndex];
  const updatedForm: FormDefinition = {
    ...existing,
    name: cleanString(input.name) || existing.name,
    submitLabel: cleanString(input.submitLabel) || existing.submitLabel,
    fields: cleanedFields
  };
  bundle.extensionModel.forms[formIndex] = updatedForm;
  bundle.extensionModel.workflows = updateNotificationWorkflows(bundle.extensionModel.workflows, input, webhook.url);

  return {
    ok: true,
    bundle,
    form: updatedForm,
    workflows: bundle.extensionModel.workflows
  };
}

function cleanFields(fields: FormFieldSettingsInput[]) {
  const seen = new Set<string>();
  return fields
    .map((field, index) => {
      const label = cleanString(field.label);
      const id = uniqueFieldId(cleanFieldId(field.id || label || `field_${index + 1}`), seen);
      const type = allowedFieldTypes.has(field.type) ? field.type : "text";
      const options = type === "select" ? cleanOptions(field.options ?? []) : undefined;
      return label
        ? {
            id,
            label,
            type,
            required: Boolean(field.required),
            ...(options?.length ? { options } : {})
          }
        : undefined;
    })
    .filter((field): field is FormDefinition["fields"][number] => Boolean(field));
}

function updateNotificationWorkflows(workflows: WorkflowDefinition[], input: UpdateFormSettingsInput, webhookUrl?: string) {
  const next = workflows.filter((workflow) => workflow.trigger !== "form_submission" || workflow.destination === "crm_placeholder");
  const email = cleanString(input.notificationEmail);
  if (email) {
    next.push({
      id: `workflow_${input.formId}_email`,
      trigger: "form_submission",
      destination: "email",
      config: { to: email }
    });
  }

  if (webhookUrl) {
    next.push({
      id: `workflow_${input.formId}_webhook`,
      trigger: "form_submission",
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

function cleanFieldId(value: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "field";
}

function uniqueFieldId(id: string, seen: Set<string>) {
  if (!seen.has(id)) {
    seen.add(id);
    return id;
  }
  let index = 2;
  while (seen.has(`${id}_${index}`)) index += 1;
  const next = `${id}_${index}`;
  seen.add(next);
  return next;
}

function cleanOptions(options: string[]) {
  return Array.from(new Set(options.map(cleanString).filter(Boolean))).slice(0, 12);
}

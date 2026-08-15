import assert from "node:assert/strict";
import { extractInquiryContact, inquiryMessageText } from "../lib/inquiries";
import { validateFormSubmission } from "../lib/form-validation";
import { managerToolArguments } from "../packages/site-agent/contracts";
import { formDefinitionSchema } from "../packages/site-contracts";
import { leadFieldAutocomplete } from "../workers/site-sandbox/scaffold/platform/sdk";

const createdAt = "2026-07-30T00:00:00.000Z";
const form = formDefinitionSchema.parse({
  schemaVersion: 1,
  id: "form_contact_current",
  siteId: "site_lead_test",
  key: "primary_lead",
  revision: 2,
  name: "Contact request",
  status: "candidate_only",
  destination: "lead_inbox",
  fields: [
    { id: "who", label: "Your details", role: "contact_name", type: "text", required: true },
    { id: "reply", label: "Best reply", role: "contact_email", type: "email", required: true },
    { id: "topic", label: "Project type", role: "custom", type: "radio", required: true, options: ["Repair", "Replacement"] },
    { id: "consent", label: "I agree", role: "custom", type: "checkbox", required: true },
    { id: "details", label: "Anything else?", role: "message", type: "textarea", required: false }
  ],
  submitLabel: "Send request",
  successMessage: "Thanks. We will follow up.",
  createdAt
});

const payload = {
  who: "Avery Owner",
  reply: "avery@example.com",
  topic: "Repair",
  consent: "true",
  details: "The labels are intentionally non-semantic."
};
const validation = validateFormSubmission(form, payload);
assert.equal(validation.ok, true);
const contact = extractInquiryContact(form, payload);
assert.equal(contact.contactName, "Avery Owner");
assert.equal(contact.contactEmailNormalized, "avery@example.com");
assert.equal(inquiryMessageText(form, payload), payload.details);

assert.throws(() => formDefinitionSchema.parse({
  ...form,
  id: "form_invalid_email_role",
  fields: form.fields.map((field) =>
    field.role === "contact_email" ? { ...field, type: "text" } : field
  )
}));
assert.throws(() => formDefinitionSchema.parse({
  ...form,
  id: "form_invalid_radio",
  fields: form.fields.map((field) =>
    field.type === "radio" ? { ...field, options: undefined } : field
  )
}));
assert.throws(() => formDefinitionSchema.parse({
  ...form,
  id: "form_duplicate_field",
  fields: [
    { id: "contact", label: "Name", role: "contact_name", type: "text", required: true },
    { id: "contact", label: "Email", role: "contact_email", type: "email", required: true }
  ]
}), /field IDs must be unique/);

const configured = managerToolArguments.configure_lead_form.parse({
  key: form.key,
  name: form.name,
  fields: form.fields.map((field) => ({
    ...field,
    options: field.options ?? null,
    placeholder: field.placeholder ?? null,
    helpText: field.helpText ?? null
  })),
  submitLabel: form.submitLabel,
  successMessage: form.successMessage,
  expectedRevision: 1
});
assert.equal(configured.fields.find((field) => field.id === "who")?.options, undefined);
assert.equal(configured.expectedRevision, 1);

assert.equal(leadFieldAutocomplete("contact_name"), "name");
assert.equal(leadFieldAutocomplete("contact_email"), "email");
assert.equal(leadFieldAutocomplete("contact_phone"), "tel");
assert.equal(leadFieldAutocomplete("message"), undefined);
assert.equal(leadFieldAutocomplete("custom"), undefined);

process.stdout.write(`${JSON.stringify({
  ok: true,
  semanticLeadMapping: "pass",
  immutableSchemaValidation: "pass",
  flexibleFieldTypes: "pass",
  browserAutocomplete: "pass",
  sharedConfigurationTool: "pass"
})}\n`);

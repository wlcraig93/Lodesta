import type { FormDefinition } from "./models";

export type FormSubmissionValidationIssue = {
  id: string;
  label: string;
  reason: string;
};

export type FormSubmissionValidationResult =
  | {
      ok: true;
      payload: Record<string, string>;
      ignoredFields: string[];
    }
  | {
      ok: false;
      error: string;
      missingFields: string[];
      invalidFields: FormSubmissionValidationIssue[];
      ignoredFields: string[];
    };

const maxTextLength = 500;
const maxTextareaLength = 5000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFormSubmission(
  form: FormDefinition,
  payload: Record<string, unknown>
): FormSubmissionValidationResult {
  const configuredFieldIds = new Set(form.fields.map((field) => field.id));
  const missingFields: string[] = [];
  const invalidFields: FormSubmissionValidationIssue[] = [];
  const cleanedPayload: Record<string, string> = {};
  const ignoredFields = Object.keys(payload).filter((key) => !configuredFieldIds.has(key));

  for (const field of form.fields) {
    const normalized = normalizeFieldValue(payload[field.id]);
    const blank = normalized.length === 0;

    if (field.required && blank) {
      missingFields.push(field.id);
      continue;
    }

    if (blank) continue;

    const issue = validateFieldValue(field, normalized);
    if (issue) {
      invalidFields.push(issue);
      continue;
    }

    cleanedPayload[field.id] = normalized;
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      error: "Required form fields are missing.",
      missingFields,
      invalidFields,
      ignoredFields
    };
  }

  if (invalidFields.length > 0) {
    return {
      ok: false,
      error: "Form submission contains invalid fields.",
      missingFields,
      invalidFields,
      ignoredFields
    };
  }

  return { ok: true, payload: cleanedPayload, ignoredFields };
}

function validateFieldValue(field: FormDefinition["fields"][number], value: string): FormSubmissionValidationIssue | null {
  if ((field.type === "text" || field.type === "email" || field.type === "phone" || field.type === "select") && value.length > maxTextLength) {
    return issue(field, "Value is too long.");
  }

  if (field.type === "textarea" && value.length > maxTextareaLength) {
    return issue(field, "Value is too long.");
  }

  if (field.type === "email" && !emailPattern.test(value)) {
    return issue(field, "Enter a valid email address.");
  }

  if (field.type === "phone" && digits(value).length < 7) {
    return issue(field, "Enter a valid phone number.");
  }

  if (field.type === "select" && field.options?.length && !field.options.includes(value)) {
    return issue(field, "Choose one of the configured options.");
  }

  return null;
}

function normalizeFieldValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function issue(field: FormDefinition["fields"][number], reason: string): FormSubmissionValidationIssue {
  return {
    id: field.id,
    label: field.label,
    reason
  };
}

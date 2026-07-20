import type {
  CapabilityFormDefinition,
  Inquiry,
  InquiryEvent,
  InquiryStatus
} from "@/packages/site-capabilities/contracts";
import { hmacSha256Hex } from "./hash-secret";

export type InquiryFormDefinition = CapabilityFormDefinition;

export type ContactExtractionStatus = "complete" | "partial" | "missing" | "ambiguous";

export type ExtractedInquiryContact = {
  contactName?: string;
  contactEmail?: string;
  contactEmailNormalized?: string;
  contactPhone?: string;
  contactPhoneNormalized?: string;
  status: ContactExtractionStatus;
  notes: string[];
};

export type CreateInquiryFromFormInput = {
  siteId: string;
  form: InquiryFormDefinition;
  pageId?: string;
  visitorId?: string;
  payload: Record<string, string>;
  metadata?: Record<string, string | number | boolean>;
  sourceUrl?: string;
  userAgent?: string;
  ipHash?: string;
};

export type CreateInquiryFromFormResult = {
  inquiry: Inquiry;
  event: InquiryEvent;
  duplicate: boolean;
};

export type PublicInquiry = Omit<Inquiry, "aiEnrichment"> & {
  aiEnrichment?: Inquiry["aiEnrichment"];
};

const nameFieldPattern = /\b(name|full_name|fullname|first_name|firstname|last_name|lastname|your_name|contact_name)\b/i;

export function extractInquiryContact(form: InquiryFormDefinition, payload: Record<string, string>): ExtractedInquiryContact {
  const emailFields = form.fields.filter((field) => field.type === "email" && payload[field.id]);
  const phoneFields = form.fields.filter((field) => field.type === "phone" && payload[field.id]);
  const nameFields = form.fields.filter((field) => nameFieldPattern.test(`${field.id} ${field.label}`) && payload[field.id]);
  const notes: string[] = [];

  if (emailFields.length > 1) notes.push("Multiple email fields were present.");
  if (phoneFields.length > 1) notes.push("Multiple phone fields were present.");
  if (nameFields.length > 1) notes.push("Multiple name-like fields were present.");

  const contactEmail = firstPayloadValue(payload, emailFields[0]?.id);
  const contactPhone = firstPayloadValue(payload, phoneFields[0]?.id);
  const contactName = nameFields.length ? nameFields.map((field) => firstPayloadValue(payload, field.id)).filter(Boolean).join(" ") : undefined;
  const found = [contactName, contactEmail, contactPhone].filter(Boolean).length;

  return {
    contactName,
    contactEmail,
    contactEmailNormalized: normalizeEmail(contactEmail),
    contactPhone,
    contactPhoneNormalized: normalizePhone(contactPhone),
    status: emailFields.length > 1 || phoneFields.length > 1 || nameFields.length > 2
      ? "ambiguous"
      : found >= 2
        ? "complete"
        : found === 1
          ? "partial"
          : "missing",
    notes
  };
}

export function inquiryMessageText(form: InquiryFormDefinition, payload: Record<string, string>) {
  const messageField =
    form.fields.find((field) => field.type === "textarea" && payload[field.id]) ??
    form.fields.find((field) => /message|comment|question|details|description|request/i.test(`${field.id} ${field.label}`) && payload[field.id]);
  return messageField ? payload[messageField.id] : undefined;
}

export function inquiryDedupeKey(input: {
  siteId: string;
  formId: string;
  contactEmailNormalized?: string;
  contactPhoneNormalized?: string;
  payload: Record<string, string>;
}) {
  const payloadEntries = Object.entries(input.payload)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, normalizeDedupeValue(value)]);
  return `v1:${hmacSha256Hex(
    JSON.stringify({
      siteId: input.siteId,
      formId: input.formId,
      email: input.contactEmailNormalized ?? "",
      phone: input.contactPhoneNormalized ?? "",
      payload: payloadEntries
    })
  )}`;
}

export function publicInquiry(inquiry: Inquiry): PublicInquiry {
  return inquiry;
}

export function publicInquiryEvent(event: InquiryEvent) {
  const { metadata, ...rest } = event;
  return {
    ...rest,
    metadata: sanitizeEventMetadata(metadata)
  };
}

export function inquirySourceHost(inquiry: Inquiry, events: InquiryEvent[] = []) {
  const firstEvent = events.find((event) => event.inquiryId === inquiry.id);
  const referrerHost = stringMetadata(firstEvent?.metadata, "referrerHost");
  if (referrerHost) return referrerHost;
  if (!firstEvent?.sourceUrl) return undefined;
  try {
    return new URL(firstEvent.sourceUrl).hostname;
  } catch {
    return undefined;
  }
}

export function normalizedInquiryStatus(value: string): InquiryStatus | undefined {
  if (
    value === "new" ||
    value === "needs_reply" ||
    value === "replied" ||
    value === "booked" ||
    value === "won" ||
    value === "lost" ||
    value === "spam" ||
    value === "archived"
  ) {
    return value;
  }
  return undefined;
}

function firstPayloadValue(payload: Record<string, string>, key: string | undefined) {
  if (!key) return undefined;
  const value = payload[key]?.trim();
  return value || undefined;
}

function normalizeEmail(value: string | undefined) {
  return value?.trim().toLowerCase() || undefined;
}

function normalizePhone(value: string | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || undefined;
}

function normalizeDedupeValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeEventMetadata(metadata: InquiryEvent["metadata"]) {
  if (!metadata) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "ipHash" || key === "visitorId" || key === "userAgent") continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function stringMetadata(metadata: InquiryEvent["metadata"], key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

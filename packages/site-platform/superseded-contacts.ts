import type { SitePublicBuildInput } from "@/packages/site-contracts";

type ContactInput = Pick<SitePublicBuildInput, "business" | "publicFacts">;

/**
 * Phones and emails any earlier build input used that the current input no
 * longer has. The owner replaced them, so they stay unsupported on every
 * later edit, not only the one right after the change.
 */
export function supersededContactValues(current: ContactInput, earlier: ContactInput[]) {
  const now = contactValues(current);
  const before = earlier.map(contactValues);
  return {
    phones: [...new Set(before.flatMap((item) => item.phones))].filter((phone) => !now.phones.includes(phone)),
    emails: [...new Set(before.flatMap((item) => item.emails))].filter((email) => !now.emails.includes(email))
  };
}

function contactValues(input: ContactInput) {
  return {
    phones: [input.business.contacts.phone, ...input.publicFacts.filter((fact) => fact.kind === "phone").map((fact) => String(fact.value))]
      .filter((value): value is string => Boolean(value)).map((value) => value.replace(/\D/g, "").slice(-10)),
    emails: [input.business.contacts.email, ...input.publicFacts.filter((fact) => fact.kind === "email").map((fact) => String(fact.value))]
      .filter((value): value is string => Boolean(value)).map((value) => value.trim().toLowerCase())
  };
}

import { isRequiredCustomerDestination } from "@/packages/site-contracts/functional-links";
import type { SitePublicBuildInput } from "@/packages/site-contracts";

export type PublishSummary = {
  details: Array<{ label: string; value: string }>;
  actions: string[];
};

/** The business details and customer actions a site goes live with, for the owner to check. */
export function publishSummary(input: Pick<SitePublicBuildInput, "business" | "forms">): PublishSummary {
  const { business } = input;
  const locations = business.locations ?? [];
  const location = locations[0];
  const address = location ? [location.street, [location.city, location.region].filter(Boolean).join(", "), location.postalCode].filter(Boolean).join(" ") : "";
  const details = [
    { label: "Business", value: business.name },
    ...(business.contacts?.phone ? [{ label: "Phone", value: business.contacts.phone }] : []),
    ...(business.contacts?.email ? [{ label: "Email", value: business.contacts.email }] : []),
    ...(address ? [{ label: locations.length > 1 ? `Address (1 of ${locations.length})` : "Address", value: address }] : [])
  ];
  const actions = [
    ...(business.contacts?.phone ? [`Call ${business.contacts.phone}`] : []),
    ...(input.forms?.length ? ["Contact form (inquiries go to your Lodesta inbox)"] : []),
    ...(business.links ?? [])
      .filter((link) => link.publicEligible && isRequiredCustomerDestination(link))
      .map((link) => `${link.label} (${hostLabel(link.url)})`)
  ];
  return { details, actions };
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

import { isCustomerPortalLink, type SitePublicBuildInput } from "../../../packages/site-contracts";

export const requiredDestinationsSourcePath = "src/required-destinations.tsx";

export function requiredDestinationsSource(input: SitePublicBuildInput) {
  const destinations = input.business.links.filter((link) =>
    link.publicEligible && isCustomerPortalLink(link.url, link.label)
  );
  const body = destinations.length
    ? `<>
    ${destinations.map((link) => (
      `<SafeLink id=${JSON.stringify(link.id)}>{${JSON.stringify(link.label)}}</SafeLink>`
    )).join("\n    ")}
  </>`
    : "null";
  return `/* Lodesta materialized owner-authoritative destinations. Preserve this source unless the owner explicitly removes a destination. */
import { SafeLink } from "#lodesta-sdk";

export function RequiredDestinations() {
  return ${body};
}
`;
}

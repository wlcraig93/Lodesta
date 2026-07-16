import type { SiteBundle } from "./models";
import { applyVerifiedFacts } from "./fact-verification";
import { createBusinessFactGraph } from "./business-fact-graph";
import { markRegenerableArtifactProvenanceStaleV1 } from "./regenerable-artifact-provenance";

export type BusinessProfileUpdateInput = {
  siteId: string;
  phone?: string;
  email?: string;
  services?: string[];
  credentials?: string[];
  offers?: string[];
  serviceAreas?: string[];
  bookingLinks?: string[];
  orderingLinks?: string[];
  socialLinks?: string[];
  pressLinks?: string[];
  hours?: Record<string, string>;
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
};

export function applyBusinessProfileUpdate(bundle: SiteBundle, input: BusinessProfileUpdateInput) {
  const changedFacts: string[] = [];
  const profile = bundle.businessProfile;

  if (input.phone !== undefined) {
    profile.phone = blankToUndefined(input.phone);
    changedFacts.push("phone");
  }
  if (input.email !== undefined) {
    profile.email = blankToUndefined(input.email);
    changedFacts.push("email");
  }
  if (input.address !== undefined) {
    profile.address = pruneAddress(input.address);
    changedFacts.push("address");
  }
  if (input.hours !== undefined) {
    profile.hours = pruneHours(input.hours);
    changedFacts.push("hours");
  }
  if (input.services !== undefined) {
    profile.services = cleanList(input.services);
    changedFacts.push("services");
  }
  if (input.credentials !== undefined) {
    profile.credentials = cleanList(input.credentials);
    changedFacts.push("credentials");
  }
  if (input.offers !== undefined) {
    profile.offers = cleanList(input.offers);
    changedFacts.push("offers");
  }
  if (input.serviceAreas !== undefined) {
    profile.serviceAreas = cleanList(input.serviceAreas);
    changedFacts.push("service_areas");
  }
  if (input.bookingLinks !== undefined) {
    profile.bookingLinks = cleanList(input.bookingLinks);
    changedFacts.push("bookingLinks");
  }
  if (input.orderingLinks !== undefined) {
    profile.orderingLinks = cleanList(input.orderingLinks);
    changedFacts.push("orderingLinks");
  }
  if (input.socialLinks !== undefined) {
    profile.socialLinks = cleanList(input.socialLinks);
    changedFacts.push("socialLinks");
  }
  if (input.pressLinks !== undefined) {
    profile.pressLinks = cleanList(input.pressLinks);
    changedFacts.push("pressLinks");
  }

  applyVerifiedFacts(profile, changedFacts);
  if (changedFacts.length) {
    const staleReason = `Owner business facts changed: ${changedFacts.join(", ")}`;
    bundle.presenceAssessment.businessUnderstanding = bundle.presenceAssessment.businessUnderstanding
      ? {
          ...bundle.presenceAssessment.businessUnderstanding,
          provenance: markRegenerableArtifactProvenanceStaleV1(
            bundle.presenceAssessment.businessUnderstanding.provenance,
            staleReason
          )
        }
      : undefined;
    bundle.presenceAssessment.businessFactGraph = createBusinessFactGraph({
      business: profile,
      presence: bundle.presenceAssessment
    });
    bundle.presenceAssessment.generationPlan = bundle.presenceAssessment.generationPlan
      ? {
          ...bundle.presenceAssessment.generationPlan,
          provenance: markRegenerableArtifactProvenanceStaleV1(bundle.presenceAssessment.generationPlan.provenance, staleReason)!
        }
      : undefined;
    bundle.presenceAssessment.siteCopy = bundle.presenceAssessment.siteCopy
      ? {
          ...bundle.presenceAssessment.siteCopy,
          provenance: markRegenerableArtifactProvenanceStaleV1(bundle.presenceAssessment.siteCopy.provenance, staleReason)!
        }
      : undefined;
    bundle.presenceAssessment.technicalNotes.push(
      `Owner business facts changed (${changedFacts.join(", ")}); explicit site regeneration is required.`
    );
  }
  return bundle;
}

function blankToUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 24);
}

function pruneAddress(address: NonNullable<BusinessProfileUpdateInput["address"]>) {
  const pruned = {
    street: blankToUndefined(address.street ?? ""),
    city: blankToUndefined(address.city ?? ""),
    region: blankToUndefined(address.region ?? ""),
    postalCode: blankToUndefined(address.postalCode ?? ""),
    country: blankToUndefined(address.country ?? "")
  };
  return Object.values(pruned).some(Boolean) ? pruned : undefined;
}

function pruneHours(hours: Record<string, string>) {
  const pruned = Object.fromEntries(
    Object.entries(hours)
      .map(([day, value]) => [day, value.trim()])
      .filter(([, value]) => Boolean(value))
  );
  return Object.keys(pruned).length ? pruned : undefined;
}

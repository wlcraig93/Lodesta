import type {
  GenerationInputSnapshotV1,
  ResolvedBusinessSnapshotV1,
  VerticalPackV1
} from "../control-plane-contracts";
import {
  siteCopySchemaVersion,
  type GenerationPlan,
  type SiteCopy
} from "../generation-contracts";
import { createRegenerableArtifactProvenanceV1 } from "../regenerable-artifact-provenance";
import { offeringNamesForGeneration, verticalPackFor } from "../vertical-packs";

export function createTestSiteCopy(
  plan: GenerationPlan,
  snapshot: GenerationInputSnapshotV1,
  createdAt?: string
): SiteCopy {
  const business = snapshot.business;
  const pack = verticalPackFor(business.vertical);
  assertPlanUsesPack(plan, pack);
  const services = offeringNamesForGeneration(snapshot);
  const serviceForPage = new Map(
    plan.pages
      .filter((page) => page.purpose === "service_landing")
      .map((page) => [page.id, page.title])
  );
  const slots = plan.pages.flatMap((page) => page.sections.flatMap((section) => section.copySlots.map((spec) => ({
    slotId: spec.slotId,
    value: testValue(spec.slotId, spec.role, business, services, pack, serviceForPage.get(page.id)),
    evidenceIds: []
  }))));
  return {
    schemaVersion: siteCopySchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "create-test-site-copy",
      producerVersion: siteCopySchemaVersion,
      createdAt,
      inputs: { plan, inputSnapshotId: snapshot.id }
    }),
    slots
  };
}

function assertPlanUsesPack(plan: GenerationPlan, pack: VerticalPackV1) {
  if (plan.verticalPack.id !== pack.id || plan.verticalPack.version !== pack.version) {
    throw new Error(`Generation plan pack ${plan.verticalPack.id}@${plan.verticalPack.version} does not match selected pack ${pack.id}@${pack.version}.`);
  }
}

function testValue(
  slotId: string,
  role: string,
  business: ResolvedBusinessSnapshotV1,
  services: string[],
  pack: VerticalPackV1,
  pageService?: string
) {
  const location = business.address?.city ?? business.serviceAreas[0];
  const index = Number(slotId.match(/\.(\d+)\.(?:title|body|question|answer)$/)?.[1] ?? 0);
  const service = pageService ?? services[index % Math.max(services.length, 1)] ?? "Service";
  if (slotId.endsWith("hero.eyebrow")) return pageService ? `${business.name} service` : business.name;
  if (slotId.endsWith("hero.heading")) {
    if (pageService) return location ? `${pageService} in ${location}` : `${pageService} from ${business.name}`;
    return location ? `${business.name} in ${location}` : business.name;
  }
  if (slotId.endsWith("hero.body")) return pageService ? `Learn what to expect and how to take the next step for ${pageService.toLowerCase()} at ${business.name}.` : `${business.name} provides ${services.slice(0, 3).join(", ").toLowerCase()} with a clear next step.`;
  if (slotId.includes("services") && slotId.endsWith("heading")) return "Services for the work you need";
  if (slotId.includes("services") && slotId.endsWith(".title")) return service;
  if (slotId.includes("services") && /\.\d+\.body$/.test(slotId)) return `Discuss your needs, available options, and next step for ${service.toLowerCase()}.`;
  if (slotId.endsWith("services.body")) return "Start with the service you need and the business can explain the available next step.";
  if (slotId.includes("process") && slotId.endsWith("heading")) return "What to expect";
  if (slotId.includes("process") && slotId.endsWith(".title")) return pack.defaultProcessSteps[index]?.title ?? "Confirm the next step";
  if (slotId.includes("process") && /\.\d+\.body$/.test(slotId)) return pack.defaultProcessSteps[index]?.body ?? "Confirm the details with the business.";
  if (slotId.endsWith("process.body")) return "A clear sequence keeps decisions and expectations visible from first contact through completion.";
  if (slotId.includes("testimonials") && slotId.endsWith("heading")) return "What customers said";
  if (slotId.includes("testimonials")) return "Exact comments retained from the business website.";
  if (slotId.includes("location") && slotId.endsWith("heading")) return location ? `Visit in ${location}` : `Visit ${business.name}`;
  if (slotId.includes("location")) return "Check the address, hours, and best way to reach the business before you go.";
  if (slotId.includes("faq") && slotId.endsWith("heading")) return pageService ? `${pageService} questions` : "Questions before you get started";
  if (slotId.includes("faq") && slotId.endsWith(".body")) return "Direct answers about preparation, options, timing, and next steps.";
  if (slotId.includes("faq") && slotId.endsWith("question")) return ["How do I get started?", "What information should I provide?", "What determines timing?", "How will I know the next step?"][index] ?? `What should I know about ${service.toLowerCase()}?`;
  if (slotId.includes("faq") && slotId.endsWith("answer")) return ["Contact the business with the available details so it can recommend the next step.", "Share the relevant context and ask what else is needed before work begins.", "Timing depends on the service, availability, and the final scope.", "Confirm the communication and completion process before work begins."][index] ?? `The exact approach depends on the needs confirmed during the first conversation.`;
  if (slotId.includes("detail") && slotId.endsWith("heading")) return `What ${service.toLowerCase()} may include`;
  if (slotId.includes("detail") && slotId.endsWith(".title")) return ["Review the need", "Confirm the scope", "Complete the work"][index] ?? "Plan the next step";
  if (slotId.includes("detail") && /\.\d+\.body$/.test(slotId)) return ["The first review identifies the relevant needs and constraints.", "The business explains the proposed work and approval path.", "The completed work is reviewed before the final handoff.", "Questions can be resolved before work begins."][index] ?? `The exact ${service.toLowerCase()} process follows the needs confirmed at the start.`;
  if (slotId.endsWith("detail.body")) return `The business reviews the request before confirming the work needed for ${service.toLowerCase()}.`;
  if (slotId.includes("contact") && slotId.endsWith("heading")) return pageService ? `Ask about ${pageService.toLowerCase()}` : pack.primaryCtaLabel;
  if (slotId.includes("contact")) return business.phone ? `Call ${business.phone} or send the relevant details to discuss the next step.` : "Send the relevant details to discuss the next step.";
  return role === "heading" ? business.name : `Contact ${business.name} for source-backed service details.`;
}

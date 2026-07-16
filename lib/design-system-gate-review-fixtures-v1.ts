import type { DesignSystemGateComparatorIdV1 } from "./design-system-gate-review-v1";

export type DesignSystemGateReviewCaptureV1 = {
  id: DesignSystemGateComparatorIdV1;
  label: string;
  description: string;
  imageFileName: string;
  mediaType: "image/jpeg" | "image/png";
  sourceLabel: string;
  sourceUrl?: string;
};

export type DesignSystemGateReviewFixtureV1 = {
  fixtureId: string;
  candidateId: string;
  currentPipelineCandidateId: string;
  businessName: string;
  pilotVertical: "auto_body";
  designSystemId: string;
  pricePrompt: string;
  captureDirectory: string;
  captures: DesignSystemGateReviewCaptureV1[];
};

const menciaAutoBodyFixtureV1: DesignSystemGateReviewFixtureV1 = {
  fixtureId: "mencia-auto-body",
  candidateId: "sitecand_3ea7dd87394843b09f2e7fff48937d7f",
  currentPipelineCandidateId: "sitecand_82426b26_preserved_capture",
  businessName: "Mencia Auto Body & Paint",
  pilotVertical: "auto_body",
  designSystemId: "auto_body_premium_no_media",
  pricePrompt: "$30-$100/month, with the decision weighted toward the low end",
  captureDirectory: "mencia",
  captures: [
    {
      id: "pilot_design_system",
      label: "Pilot design system",
      description: "Deterministic planner and the auto-body system under review",
      imageFileName: "pilot-design-system-desktop.png",
      mediaType: "image/png",
      sourceLabel: "Pilot candidate"
    },
    {
      id: "current_pipeline",
      label: "Previous pipeline",
      description: "Preserved V3 output from before the generation simplification",
      imageFileName: "current-pipeline-desktop.png",
      mediaType: "image/png",
      sourceLabel: "Preserved candidate"
    },
    {
      id: "existing_site",
      label: "Existing business site",
      description: "The business's current public website",
      imageFileName: "existing-site-desktop.png",
      mediaType: "image/jpeg",
      sourceLabel: "menciaautoshop.com",
      sourceUrl: "https://www.menciaautoshop.com/"
    },
    {
      id: "local_competitor",
      label: "Local competitor",
      description: "Quality Auto Body in the same Austin market",
      imageFileName: "local-competitor-desktop.png",
      mediaType: "image/jpeg",
      sourceLabel: "qualitybodyshopaustin.com",
      sourceUrl: "https://www.qualitybodyshopaustin.com/"
    }
  ]
};

export const designSystemGateReviewFixturesV1 = [menciaAutoBodyFixtureV1] as const;

export function designSystemGateReviewFixtureByCandidateIdV1(candidateId: string) {
  return designSystemGateReviewFixturesV1.find((fixture) => fixture.candidateId === candidateId);
}

export function designSystemGateReviewFixtureByIdV1(fixtureId: string) {
  return designSystemGateReviewFixturesV1.find((fixture) => fixture.fixtureId === fixtureId);
}

export function designSystemGateReviewCaptureV1(fixtureId: string, captureId: string) {
  const fixture = designSystemGateReviewFixtureByIdV1(fixtureId);
  return fixture?.captures.find((capture) => capture.id === captureId);
}

import type { SitePublicBuildInput, SourceSnapshot } from "@/packages/site-contracts";
import { SiteAuthoringTerminalError } from "./failures";

export const maximumAuthoringContextCharacters = 160_000;

export type AuthoringContextPacket = {
  kind: "authoring-context-packet";
  authorities: {
    publicBuildInputId: string;
    businessStateRevision: number;
    siteIntentRevision: number;
    sourceSnapshotIds: string[];
  };
  crawl: {
    coverage?: string;
    blocks: Array<{
      id: string;
      sourceUrl: string;
      displayText: string;
      evidenceClass: "first_party" | "third_party" | "unknown";
    }>;
  };
  research?: {
    report?: string;
    sources: string[];
    coverage?: string;
    provenance?: Record<string, unknown>;
  };
  truncated: boolean;
};

export function createAuthoringContextPacket(input: {
  buildInput: SitePublicBuildInput;
  snapshots: SourceSnapshot[];
}): AuthoringContextPacket {
  const website = input.snapshots.find((snapshot) => snapshot.sourceType === "website");
  const research = input.snapshots.find((snapshot) => snapshot.sourceType === "web_research");
  const ingestion = objectValue(website?.payload.ingestion);
  const rawBlocks = Array.isArray(ingestion?.modelBlocks) ? ingestion.modelBlocks : [];
  const blocks = rawBlocks.flatMap((value) => {
    const block = objectValue(value);
    if (
      !block
      || typeof block.id !== "string"
      || typeof block.sourceUrl !== "string"
      || typeof block.displayText !== "string"
      || !["first_party", "third_party", "unknown"].includes(String(block.evidenceClass))
    ) return [];
    return [{
      id: block.id,
      sourceUrl: block.sourceUrl,
      displayText: block.displayText,
      evidenceClass: block.evidenceClass as "first_party" | "third_party" | "unknown"
    }];
  });
  const researchPayload = objectValue(research?.payload);
  const researchSources = Array.isArray(researchPayload?.sources)
    ? researchPayload.sources.filter((source): source is string => typeof source === "string")
    : [];
  const required: AuthoringContextPacket = {
    kind: "authoring-context-packet",
    authorities: {
      publicBuildInputId: input.buildInput.id,
      businessStateRevision: input.buildInput.businessStateRevision,
      siteIntentRevision: input.buildInput.siteIntentRevision,
      sourceSnapshotIds: input.buildInput.sourceSnapshotIds
    },
    crawl: {
      coverage: typeof ingestion?.coverage === "string" ? ingestion.coverage : undefined,
      blocks: []
    },
    research: researchPayload ? {
      sources: researchSources,
      coverage: typeof researchPayload.coverage === "string" ? researchPayload.coverage : undefined,
      provenance: objectValue(researchPayload.provenance)
    } : undefined,
    truncated: false
  };
  if (JSON.stringify({ buildInput: input.buildInput, packet: required }).length > maximumAuthoringContextCharacters) {
    throw new SiteAuthoringTerminalError(
      "input_budget_exhausted",
      "budget",
      false,
      "authoring_required_context_exceeds_160000_characters"
    );
  }

  const packet = structuredClone(required);
  for (const block of blocks) {
    packet.crawl.blocks.push(block);
    if (JSON.stringify({ buildInput: input.buildInput, packet }).length > maximumAuthoringContextCharacters) {
      packet.crawl.blocks.pop();
      packet.truncated = true;
      break;
    }
  }
  if (researchPayload && typeof researchPayload.report === "string") {
    packet.research = { ...packet.research!, report: researchPayload.report };
    if (JSON.stringify({ buildInput: input.buildInput, packet }).length > maximumAuthoringContextCharacters) {
      delete packet.research.report;
      packet.truncated = true;
    }
  }
  return packet;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

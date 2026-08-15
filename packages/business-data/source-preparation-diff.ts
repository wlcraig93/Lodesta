import type {
  BusinessFact,
  BusinessState,
  SourceSnapshot
} from "@/packages/site-contracts";
import { stableJson } from "./hash";
import type {
  SourcePreparationDiagnostics,
  SourcePreparationFactDiagnostic
} from "./website-ingestion";

export type SourcePreparationChangeClassification =
  | "deduplication"
  | "invalid_value_filtering"
  | "conflict_suppression"
  | "changed_public_eligibility"
  | "unexplained_loss";

export type SourcePreparationFactChange = {
  kind: BusinessFact["kind"];
  change: "added" | "removed" | "changed";
  before?: CanonicalFactSummary;
  after?: CanonicalFactSummary;
  classification?: SourcePreparationChangeClassification;
  explanation: string;
};

export type CanonicalFactSummary = {
  id: string;
  value: unknown;
  publicEligible: boolean;
  provenance: {
    sourceSnapshotId: string;
    sourceUrl?: string;
    evidenceClass?: "first_party" | "third_party" | "unknown";
    confidence: number;
    ownerConfirmed: boolean;
  };
};

export type SourcePreparationDiff = {
  schemaVersion: 1;
  before: {
    sourceSnapshotId: string;
    sourceSnapshotHash: string;
    businessStateRevision: number;
    businessStateHash: string;
  };
  after: {
    sourceSnapshotId: string;
    sourceSnapshotHash: string;
    businessStateRevision: number;
    businessStateHash: string;
  };
  counts: {
    added: number;
    removed: number;
    changed: number;
    unexplained: number;
  };
  changes: SourcePreparationFactChange[];
  comparisonEligible: boolean;
  limitations: string[];
};

const singularKinds = new Set<BusinessFact["kind"]>([
  "business_name",
  "description",
  "phone",
  "email",
  "address",
  "hours"
]);

export function compareRetainedSourcePreparations(input: {
  beforeSnapshot: SourceSnapshot;
  beforeState: BusinessState;
  afterSnapshot: SourceSnapshot;
  afterState: BusinessState;
}): SourcePreparationDiff {
  assertPreparationPair(input.beforeSnapshot, input.beforeState, "before");
  assertPreparationPair(input.afterSnapshot, input.afterState, "after");
  const beforeByKind = groupFacts(input.beforeState.facts);
  const afterByKind = groupFacts(input.afterState.facts);
  const afterDiagnostics = preparationDiagnostics(input.afterSnapshot);
  const changes: SourcePreparationFactChange[] = [];
  const kinds = new Set<BusinessFact["kind"]>([
    ...beforeByKind.keys(),
    ...afterByKind.keys()
  ]);

  for (const kind of [...kinds].sort()) {
    const before = beforeByKind.get(kind) ?? [];
    const after = afterByKind.get(kind) ?? [];
    const beforeUnmatched = before.filter((fact) =>
      !after.some((candidate) => factIdentity(candidate) === factIdentity(fact))
    );
    const afterUnmatched = after.filter((fact) =>
      !before.some((candidate) => factIdentity(candidate) === factIdentity(fact))
    );
    if (singularKinds.has(kind) && beforeUnmatched.length === 1 && afterUnmatched.length === 1) {
      const classification = classifyRemoval(beforeUnmatched[0], afterDiagnostics);
      changes.push({
        kind,
        change: "changed",
        before: summarize(beforeUnmatched[0]),
        after: summarize(afterUnmatched[0]),
        classification,
        explanation: explanationFor("changed", classification)
      });
      continue;
    }
    for (const fact of beforeUnmatched) {
      const classification = classifyRemoval(fact, afterDiagnostics);
      changes.push({
        kind,
        change: "removed",
        before: summarize(fact),
        classification,
        explanation: explanationFor("removed", classification)
      });
    }
    for (const fact of afterUnmatched) {
      changes.push({
        kind,
        change: "added",
        after: summarize(fact),
        explanation: "The later retained preparation introduced this canonical fact."
      });
    }
  }

  const unexplained = changes.filter((change) =>
    change.classification === "unexplained_loss"
  ).length;
  const limitations = [
    ...(afterDiagnostics
      ? []
      : ["The later SourceSnapshot predates retained fact-exclusion provenance."]),
    ...(unexplained
      ? [`${unexplained} removed or changed fact(s) lacked an explained preparation disposition.`]
      : [])
  ];
  return {
    schemaVersion: 1,
    before: preparationIdentity(input.beforeSnapshot, input.beforeState),
    after: preparationIdentity(input.afterSnapshot, input.afterState),
    counts: {
      added: changes.filter((change) => change.change === "added").length,
      removed: changes.filter((change) => change.change === "removed").length,
      changed: changes.filter((change) => change.change === "changed").length,
      unexplained
    },
    changes,
    comparisonEligible: unexplained === 0 && Boolean(afterDiagnostics),
    limitations
  };
}

function classifyRemoval(
  fact: BusinessFact,
  diagnostics: SourcePreparationDiagnostics | undefined
): SourcePreparationChangeClassification {
  const candidate = diagnostics?.facts.find((item) =>
    item.kind === fact.kind
    && factIdentityValue(item.value) === factIdentityValue(fact.value)
    && item.disposition !== "accepted"
  );
  if (!candidate || candidate.disposition === "accepted") return "unexplained_loss";
  return candidate.disposition;
}

function preparationDiagnostics(snapshot: SourceSnapshot) {
  const candidate = snapshot.payload.factPreparation;
  if (!candidate || typeof candidate !== "object") return undefined;
  const value = candidate as Partial<SourcePreparationDiagnostics>;
  if (value.schemaVersion !== 1 || !Array.isArray(value.facts)) return undefined;
  const valid = value.facts.every(isPreparationFactDiagnostic);
  return valid ? value as SourcePreparationDiagnostics : undefined;
}

function isPreparationFactDiagnostic(value: unknown): value is SourcePreparationFactDiagnostic {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SourcePreparationFactDiagnostic>;
  return (item.kind === "hours" || item.kind === "service_area")
    && typeof item.reason === "string"
    && Array.isArray(item.sourceUrls)
    && Array.isArray(item.evidenceClasses)
    && [
      "accepted",
      "deduplication",
      "invalid_value_filtering",
      "conflict_suppression",
      "changed_public_eligibility",
      "unexplained_loss"
    ].includes(item.disposition ?? "");
}

function assertPreparationPair(
  snapshot: SourceSnapshot,
  state: BusinessState,
  label: string
) {
  const referenced = state.facts.length === 0
    || state.facts.some((fact) => fact.source.sourceSnapshotId === snapshot.id);
  if (!referenced) {
    throw new Error(`${label} source preparation contains a fact without retained source provenance.`);
  }
  if (snapshot.businessId !== state.businessId) {
    throw new Error(`${label} SourceSnapshot and BusinessState belong to different businesses.`);
  }
}

function groupFacts(facts: BusinessFact[]) {
  const grouped = new Map<BusinessFact["kind"], BusinessFact[]>();
  for (const fact of facts) {
    const values = grouped.get(fact.kind) ?? [];
    values.push(fact);
    grouped.set(fact.kind, values);
  }
  return grouped;
}

function summarize(fact: BusinessFact): CanonicalFactSummary {
  return {
    id: fact.id,
    value: fact.value,
    publicEligible: fact.publicEligible,
    provenance: {
      sourceSnapshotId: fact.source.sourceSnapshotId,
      sourceUrl: fact.source.sourceUrl,
      evidenceClass: fact.source.evidenceClass,
      confidence: fact.source.confidence,
      ownerConfirmed: fact.source.ownerConfirmed
    }
  };
}

function preparationIdentity(snapshot: SourceSnapshot, state: BusinessState) {
  return {
    sourceSnapshotId: snapshot.id,
    sourceSnapshotHash: snapshot.contentHash,
    businessStateRevision: state.revision,
    businessStateHash: state.stateHash
  };
}

function factIdentity(fact: BusinessFact) {
  return `${fact.kind}:${factIdentityValue(fact.value)}:${fact.publicEligible}`;
}

function factIdentityValue(value: unknown) {
  return stableJson(value);
}

function explanationFor(
  change: "removed" | "changed",
  classification: SourcePreparationChangeClassification
) {
  const subject = change === "changed" ? "The earlier value changed" : "The earlier value was removed";
  return {
    deduplication: `${subject} because the later preparation retained an equivalent canonical value once.`,
    invalid_value_filtering: `${subject} because deterministic validation rejected it as invalid.`,
    conflict_suppression: `${subject} because conflicting retained evidence prevented a single reliable value.`,
    changed_public_eligibility: `${subject} because publication eligibility changed.`,
    unexplained_loss: `${subject}, but retained preparation provenance did not explain why.`
  }[classification];
}

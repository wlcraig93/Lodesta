import { createHash } from "node:crypto";
import type {
  ClaimCategoryV2,
  GenerationQaBlocker,
  GenerationQaReadiness
} from "./models";

export function deriveGenerationQaReadinessV2(input: {
  blockers: GenerationQaBlocker[];
  checked: boolean;
  unavailable?: boolean;
}): GenerationQaReadiness {
  if (input.unavailable) return "unavailable";
  if (!input.checked) return "pending";
  return input.blockers.some((blocker) => blocker.severity !== "warning") ? "blocked" : "ready";
}

export function normalizeClaimTextV2(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?'"()\[\]{}]+|[.,;:!?'"()\[\]{}]+$/g, "")
    .toLowerCase();
}

export function claimIdV2(input: {
  sourceFactIds: string[];
  category: ClaimCategoryV2;
  normalizedClaimValue: string;
}) {
  const payload = JSON.stringify({
    sourceFactIds: [...input.sourceFactIds].sort(),
    category: input.category,
    normalizedClaimValue: normalizeClaimTextV2(input.normalizedClaimValue)
  });
  return `claim_${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}

import { sha256 } from "@/packages/business-data";

export type RecipeProvenance = {
  id: "mobile-navigation" | "managed-lead-form";
  version: number;
  templateHash: `sha256:${string}`;
};

export type RecipeSourceClassification =
  | { status: "untouched"; provenance: RecipeProvenance; currentHash: `sha256:${string}` }
  | { status: "customized"; provenance?: RecipeProvenance; currentHash: `sha256:${string}`; reason: "missing_header" | "invalid_header" | "body_changed" };

const recipeHeaderPattern = /^\/\* @lodesta-recipe (\{[^\r\n]+\}) \*\/(?:\r?\n)/;

export function classifyRecipeSource(source: string): RecipeSourceClassification {
  const match = source.match(recipeHeaderPattern);
  if (!match) {
    return { status: "customized", currentHash: sha256(source), reason: "missing_header" };
  }
  const body = source.slice(match[0].length);
  const currentHash = sha256(body);
  const provenance = parseRecipeProvenance(match[1]);
  if (!provenance) return { status: "customized", currentHash, reason: "invalid_header" };
  if (provenance.templateHash !== currentHash) {
    return { status: "customized", provenance, currentHash, reason: "body_changed" };
  }
  return { status: "untouched", provenance, currentHash };
}

function parseRecipeProvenance(value: string): RecipeProvenance | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if ((parsed.id !== "mobile-navigation" && parsed.id !== "managed-lead-form")
      || !Number.isInteger(parsed.version) || Number(parsed.version) < 1
      || typeof parsed.templateHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(parsed.templateHash)) {
      return undefined;
    }
    return parsed as RecipeProvenance;
  } catch {
    return undefined;
  }
}

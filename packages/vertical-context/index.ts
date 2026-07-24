import { verticalContextModuleSchema, type VerticalContextModule } from "@/packages/site-contracts";
import { autoBodyContextModule } from "./auto-body";
import { plumbingContextModule } from "./plumbing";
import { syntheticContextModule } from "./synthetic";

const productionModules = new Map<string, VerticalContextModule>([
  [autoBodyContextModule.id, verticalContextModuleSchema.parse(autoBodyContextModule)],
  [plumbingContextModule.id, verticalContextModuleSchema.parse(plumbingContextModule)]
]);

const testModules = new Map<string, VerticalContextModule>([
  ...productionModules,
  [syntheticContextModule.id, verticalContextModuleSchema.parse(syntheticContextModule)]
]);

export function verticalContextFor(verticalId: string, options: { includeTestModules?: boolean } = {}) {
  const module = (options.includeTestModules ? testModules : productionModules).get(verticalId);
  if (!module) throw new Error(`Domain context ${verticalId} is not registered.`);
  return structuredClone(module);
}

export function listProductionVerticalContexts() {
  return [...productionModules.values()].map((module) => structuredClone(module));
}

export function matchVerticalContext(
  sourceText: string,
  options: { includeTestModules?: boolean } = {}
) {
  const normalizedSource = normalize(sourceText);
  const modules = [...(options.includeTestModules ? testModules : productionModules).values()]
    .filter((module) => module.status !== "tombstoned");
  const matches = modules.map((module) => {
    const strongTerms = unique([
      module.id.replaceAll("_", " "),
      ...module.aliases,
      ...module.offeringCatalog.flatMap((offering) => [offering.name, ...offering.aliases])
    ]);
    const supportingTerms = unique(Object.values(module.terminology).flat());
    const strongMatches = strongTerms.filter((term) => includesPhrase(normalizedSource, term)).length;
    const supportingMatches = supportingTerms.filter((term) => includesPhrase(normalizedSource, term)).length;
    return { module, score: strongMatches * 4 + supportingMatches, strongMatches };
  }).filter((match) => match.strongMatches > 0 && match.score >= 4)
    .sort((left, right) => right.score - left.score || left.module.id.localeCompare(right.module.id));

  if (!matches[0] || (matches[1] && matches[0].score === matches[1].score)) return undefined;
  return structuredClone(matches[0].module);
}

function includesPhrase(source: string, value: string) {
  const phrase = normalize(value);
  return phrase.length >= 3 && ` ${source} `.includes(` ${phrase} `);
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

export { autoBodyContextModule, plumbingContextModule, syntheticContextModule };

export type ServiceDefinition = {
  id: string;
  vertical: "auto_body";
  slug: string;
  name: string;
  category?: string;
  aliases: string[];
  defaultQuestions: string[];
  pageStrategy: "auto" | "always" | "never";
  retired: boolean;
};

function definition(
  slug: string,
  name: string,
  aliases: string[],
  defaultQuestions: string[],
  pageStrategy: ServiceDefinition["pageStrategy"] = "auto"
): ServiceDefinition {
  return {
    id: `svc_auto_body_${slug}`,
    vertical: "auto_body",
    slug,
    name,
    aliases,
    defaultQuestions,
    pageStrategy,
    retired: false
  };
}

/** Stable append-only catalog. Retire entries; never rename or reuse IDs. */
export const serviceCatalog: ServiceDefinition[] = [
  definition("collision-repair", "Collision Repair", ["collision repair", "collision", "accident repair"], ["What information helps after a collision?", "How does a repair estimate begin?"]),
  definition("dent-repair", "Dent Repair", ["dent repair", "paintless dent repair", "pdr", "dents"], ["Can dents be repaired without repainting?"]),
  definition("auto-paint", "Auto Paint", ["paint", "refinish", "repaint", "paint matching"], ["How is paint color matching handled?"]),
  definition("auto-glass", "Auto Glass", ["auto glass", "windshield", "glass replacement"], ["Do you repair chips or replace glass?"]),
  definition("bumper-repair", "Bumper Repair", ["bumper repair", "bumper"], ["Can a damaged bumper be repaired?"]),
  definition("hail-damage", "Hail Damage Repair", ["hail damage", "storm damage", "hail repair"], ["What photos help document hail damage?"]),
  definition("frame-repair", "Frame & Structural Repair", ["frame repair", "frame straightening", "structural repair", "unibody"], ["How is structural damage inspected?"]),
  definition("repair-estimates", "Repair Estimates", ["estimate", "free estimate", "repair quote", "quote"], ["What should I bring for an estimate?"]),
  definition("insurance-claims", "Insurance Claim Support", ["insurance", "insurance claim", "claim support"], ["What information helps when insurance is involved?"]),
  definition("custom-paint", "Custom Paint", ["custom paint", "custom painting", "paint work", "custom refinish"], ["What details help plan custom paint work?"])
];

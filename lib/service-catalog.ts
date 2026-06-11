import type { Vertical } from "./models";

/**
 * Canonical per-vertical service catalog (Phase 1). Code-defined so playbooks
 * and FAQ seeds version with the generation system; the service_definitions
 * table holds owner-created custom definitions. Stable slugs are SEO surface —
 * do not rename existing slugs.
 */

export type ServiceDefinition = {
  /** Stable id: svc_{vertical}_{slug}. */
  id: string;
  vertical: Vertical;
  slug: string;
  name: string;
  category?: string;
  /** Lowercased match strings for mapping discovered services onto the catalog. */
  aliases: string[];
  /** Seed questions for FAQ generation when this service is active. */
  defaultQuestions: string[];
  /** auto = anti-doorway rules decide; always/never override. */
  pageStrategy: "auto" | "always" | "never";
};

function definition(
  vertical: Vertical,
  slug: string,
  name: string,
  aliases: string[],
  defaultQuestions: string[],
  pageStrategy: ServiceDefinition["pageStrategy"] = "auto",
  category?: string
): ServiceDefinition {
  return { id: `svc_${vertical}_${slug}`, vertical, slug, name, aliases, defaultQuestions, pageStrategy, category };
}

export const serviceCatalog: ServiceDefinition[] = [
  // --- auto_services (launch vertical, full catalog) ---
  definition("auto_services", "flat-repair", "Flat Repair", ["flat repair", "flat tire", "tire patch", "tire plug", "puncture repair"], [
    "Can my flat tire be repaired instead of replaced?",
    "How long does a flat repair take?"
  ]),
  definition("auto_services", "used-tires", "Used Tires", ["used tires", "used tire"], [
    "How much tread do your used tires have?",
    "Do used tires come with any guarantee?"
  ]),
  definition("auto_services", "new-tires", "New Tires", ["new tires", "tire sales", "tire shop", "tire replacement"], [
    "Which tire brands do you carry?",
    "Do you price match on new tires?"
  ]),
  definition("auto_services", "tire-rotation", "Tire Rotation", ["tire rotation", "rotation"], [
    "How often should tires be rotated?"
  ]),
  definition("auto_services", "wheel-balancing", "Wheel Balancing", ["wheel balancing", "tire balancing", "balance"], [
    "How do I know if my wheels need balancing?"
  ]),
  definition("auto_services", "wheel-alignment", "Wheel Alignment", ["wheel alignment", "alignment"], [
    "What are the signs my car needs an alignment?"
  ]),
  definition("auto_services", "tpms-service", "TPMS Service", ["tpms", "tire pressure sensor", "tire pressure monitoring"], [
    "Why is my tire pressure light on?"
  ]),
  definition("auto_services", "oil-change", "Oil Change", ["oil change", "oil service"], [
    "How long does an oil change take?"
  ]),
  definition("auto_services", "brake-service", "Brake Service", ["brake repair", "brake service", "brakes", "brake pads"], [
    "How do I know when my brakes need service?"
  ]),
  definition("auto_services", "tire-delivery", "Tire Delivery", ["tire delivery", "delivery", "mobile tire"], [
    "Do you deliver and install tires on site?"
  ]),
  // --- auto_body ---
  definition("auto_body", "collision-repair", "Collision Repair", ["collision repair", "collision", "accident repair"], [
    "Do you work with insurance claims?"
  ]),
  definition("auto_body", "dent-repair", "Dent Repair", ["dent repair", "paintless dent repair", "pdr", "dents"], [
    "Can dents be fixed without repainting?"
  ]),
  definition("auto_body", "auto-paint", "Auto Paint", ["paint", "refinish", "repaint", "paint matching"], [
    "Can you match my factory paint color?"
  ]),
  definition("auto_body", "auto-glass", "Auto Glass", ["auto glass", "windshield", "glass replacement"], [
    "Do you repair chips or only replace glass?"
  ]),
  definition("auto_body", "bumper-repair", "Bumper Repair", ["bumper repair", "bumper"], [
    "Can plastic bumpers be repaired?"
  ]),
  // --- home_services ---
  definition("home_services", "plumbing-repair", "Plumbing Repair", ["plumbing repair", "plumbing", "plumber"], [
    "Do you charge for estimates?"
  ]),
  definition("home_services", "drain-cleaning", "Drain Cleaning", ["drain cleaning", "clogged drain", "drains"], [
    "What causes recurring drain clogs?"
  ]),
  definition("home_services", "water-heaters", "Water Heaters", ["water heater", "water heaters", "tankless"], [
    "Should I repair or replace my water heater?"
  ]),
  definition("home_services", "leak-detection", "Leak Detection", ["leak detection", "leak", "leaks"], [
    "How do you find hidden leaks?"
  ]),
  definition("home_services", "emergency-service", "Emergency Service", ["emergency", "24/7", "after hours"], [
    "Do you answer emergency calls on weekends?"
  ]),
  // --- restaurant (page strategy: never — menu over landing pages) ---
  definition("restaurant", "dine-in", "Dine-In", ["dine in", "dine-in", "dining"], [], "never"),
  definition("restaurant", "takeout", "Takeout", ["takeout", "take-out", "to go", "pickup"], [], "never"),
  definition("restaurant", "catering", "Catering", ["catering", "caterer"], ["How far in advance should I book catering?"], "auto"),
  definition("restaurant", "delivery", "Delivery", ["delivery"], [], "never"),
  // --- beauty_salon ---
  definition("beauty_salon", "haircuts", "Haircuts", ["haircut", "haircuts", "cut"], []),
  definition("beauty_salon", "color", "Color", ["color", "coloring", "highlights", "balayage"], [
    "How long does a full color appointment take?"
  ]),
  definition("beauty_salon", "styling", "Styling", ["styling", "blowout", "updo"], []),
  definition("beauty_salon", "treatments", "Treatments", ["treatment", "treatments", "keratin", "conditioning"], [])
];

const catalogByVertical = new Map<Vertical, ServiceDefinition[]>();
for (const entry of serviceCatalog) {
  const list = catalogByVertical.get(entry.vertical) ?? [];
  list.push(entry);
  catalogByVertical.set(entry.vertical, list);
}

export function serviceDefinitionsForVertical(vertical: Vertical): ServiceDefinition[] {
  return catalogByVertical.get(vertical) ?? [];
}

/**
 * Map a discovered service name onto the catalog. Alias containment matching:
 * "10 Minute Flat Repair" → flat-repair. Returns undefined for custom services.
 */
export function matchServiceDefinition(vertical: Vertical, serviceName: string): ServiceDefinition | undefined {
  const lower = serviceName.toLowerCase();
  let best: { definition: ServiceDefinition; length: number } | undefined;
  for (const entry of serviceDefinitionsForVertical(vertical)) {
    for (const alias of entry.aliases) {
      if (lower.includes(alias) && (!best || alias.length > best.length)) {
        best = { definition: entry, length: alias.length };
      }
    }
  }
  return best?.definition;
}

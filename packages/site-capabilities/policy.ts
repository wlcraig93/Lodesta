export type UnsupportedCapabilityDemandV1 = {
  capability: "authentication" | "commerce" | "scheduling" | "uploads" | "custom_backend" | "live_chat";
  label: string;
};

const capabilityTerms: Array<UnsupportedCapabilityDemandV1 & { pattern: RegExp }> = [
  { capability: "authentication", label: "authentication or customer accounts", pattern: /\b(?:auth(?:entication)?|log[ -]?in|sign[ -]?in|user accounts?|customer accounts?|member portal)\b/i },
  { capability: "commerce", label: "payments or ecommerce", pattern: /\b(?:payments?|checkout|e[ -]?commerce|online store|shopping cart|sell online)\b/i },
  { capability: "scheduling", label: "online scheduling or booking", pattern: /\b(?:online booking|appointment booking|appointment schedul(?:ing|er)|booking calendar|calendar integration)\b/i },
  { capability: "uploads", label: "visitor file uploads", pattern: /\b(?:file uploads?|photo uploads?|document uploads?|upload portal)\b/i },
  { capability: "custom_backend", label: "a custom backend or database", pattern: /\b(?:custom backend|custom api|server[- ]side api|database|websocket|server function)\b/i },
  { capability: "live_chat", label: "live chat or a chatbot", pattern: /\b(?:live chat|customer chat|support chat|chatbot)\b/i }
];

const demandPattern = /\b(?:add|build|create|enable|implement|integrate|install|set up|support|need|want|allow(?: customers?| users?| visitors?)? to use|let(?: customers?| users?| visitors?))\b/i;
const negationPattern = /\b(?:do not|don't|does not|doesn't|without|avoid|remove|disable|no need for|not need)\b/i;

export function unsupportedCapabilityDemands(instruction: string): UnsupportedCapabilityDemandV1[] {
  const normalized = instruction.replace(/\s+/g, " ").trim();
  if (!normalized || !demandPattern.test(normalized)) return [];
  const findings: UnsupportedCapabilityDemandV1[] = [];
  for (const definition of capabilityTerms) {
    const match = definition.pattern.exec(normalized);
    if (!match) continue;
    const window = normalized.slice(Math.max(0, match.index - 90), Math.min(normalized.length, match.index + match[0].length + 40));
    if (negationPattern.test(window)) continue;
    findings.push({ capability: definition.capability, label: definition.label });
  }
  return findings;
}

export function unsupportedCapabilityMessage(findings: UnsupportedCapabilityDemandV1[]) {
  return findings.length
    ? `This request requires unsupported V1 capability: ${findings.map((finding) => finding.label).join(", ")}. Lodesta can change website content and presentation, but cannot generate arbitrary application backends.`
    : undefined;
}

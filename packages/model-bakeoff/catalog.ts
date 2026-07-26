import type { ModelBakeoffCandidate, ModelBakeoffSource } from "./contracts";

export const denverPlumberBakeoffId = "bakeoff_denver_plumbers_2026_07";

export const denverPlumberBakeoffSources: ModelBakeoffSource[] = [
  {
    key: "prime_plumbing",
    label: "Prime Plumbing & Heating",
    profile: "Rich multi-page source with broad service and location coverage.",
    url: "https://www.primeplumbingheating.com/"
  },
  {
    key: "colorado_plumbing",
    label: "Colorado Plumbing",
    profile: "Content-dense source with pricing, service, and SEO signals.",
    url: "https://colorado-plumbing.com/"
  },
  {
    key: "mr_plumber_denver",
    label: "Mr. Plumber Denver",
    profile: "Sparse legacy source that requires stronger synthesis and hierarchy.",
    url: "https://mrplumberdenver.com/"
  }
];

export const denverPlumberBakeoffCandidates: ModelBakeoffCandidate[] = [
  {
    key: "gpt_5_6_sol",
    label: "GPT-5.6 Sol",
    apiProvider: "openai",
    modelId: "gpt-5.6-sol"
  },
  {
    key: "gpt_5_6_terra",
    label: "GPT-5.6 Terra",
    apiProvider: "openai",
    modelId: "gpt-5.6-terra"
  },
  {
    key: "claude_opus_5",
    label: "Claude Opus 5",
    apiProvider: "openrouter",
    modelId: "anthropic/claude-opus-5"
  },
  {
    key: "kimi_k3",
    label: "Kimi K3",
    apiProvider: "openrouter",
    modelId: "moonshotai/kimi-k3"
  }
];

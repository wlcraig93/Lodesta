export const establishedOpenRouterAuthoringRoutes = {
  "anthropic/claude-opus-5": {
    routeFamily: "openrouter_anthropic" as const,
    contextWindowTokens: 1_000_000,
    eligibleZdrUpstreams: ["amazon-bedrock", "google-vertex"] as const
  },
  "moonshotai/kimi-k3": {
    routeFamily: "openrouter_moonshot" as const,
    contextWindowTokens: 1_048_576,
    eligibleZdrUpstreams: ["moonshotai"] as const
  }
} as const;

export type EstablishedOpenRouterAuthoringRoute = keyof typeof establishedOpenRouterAuthoringRoutes;

export function isEstablishedOpenRouterAuthoringRoute(
  modelId: string
): modelId is EstablishedOpenRouterAuthoringRoute {
  return Object.hasOwn(establishedOpenRouterAuthoringRoutes, modelId);
}

# Model routing

Lodesta can run the website manager either directly through OpenAI or through OpenRouter. The canonical default remains:

- API provider: `openai`
- website manager model: `gpt-5.6-sol`
- business-ingestion provider: direct OpenAI

Adding OpenRouter does not change an active route. An operator must configure `OPENROUTER_API_KEY` and explicitly save `openrouter` plus a provider-qualified model slug in **Operator settings → Runtime settings**. `LODESTA_SITE_AGENT_PROVIDER` and `LODESTA_SITE_AGENT_MODEL` remain operator-only environment overrides.

## Request policy

OpenRouter website-manager requests use its OpenAI-compatible Responses endpoint. Each request:

- sends the complete stateless manager history;
- uses the run ID as the OpenRouter session key for upstream affinity and prompt-cache locality;
- requires an upstream that supports the request parameters;
- denies data-collection endpoints and requires zero-data-retention routing;
- enables OpenRouter routing metadata for provider attribution.

The website manager does not configure cross-model fallbacks. OpenRouter may choose or fail over among compatible upstream endpoints for the one requested model.

OpenRouter documents its Responses API as beta. Treat switching an active model route as an operator rollout: exercise the exact model’s tool calling, structured output, encrypted reasoning, context length, and output-token limits before changing the setting.

## Usage and cost telemetry

Every model-request event within an authoring run records:

- API provider (`openai` or `openrouter`);
- requested and served model IDs;
- selected upstream provider when OpenRouter reports it;
- provider request ID;
- input, cached-input, reasoning, and output tokens;
- model duration;
- effective cost in USD and its provenance;
- upstream inference cost when reported.

`costSource` has four values:

- `provider_reported`: billed cost returned by the API provider. OpenRouter usage accounting is the primary example.
- `catalog_estimate`: token-based estimate from Lodesta’s versioned local price catalog.
- `mixed`: a run includes more than one provenance or has incomplete cost coverage.
- `unavailable`: neither provider billing nor catalog pricing was available.

Dashboards display `provider_reported` cost as billed and `catalog_estimate` cost as estimated. They never present a catalog estimate as an invoice amount.

## References

- [OpenRouter Responses API](https://openrouter.ai/docs/api_reference/responses/overview)
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter router metadata](https://openrouter.ai/docs/guides/features/router-metadata)

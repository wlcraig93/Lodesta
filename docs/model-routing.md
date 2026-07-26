# Model routing

Lodesta can run the website manager either directly through OpenAI or through OpenRouter. The canonical default remains:

- API provider: `openai`
- website manager model: `gpt-5.6-sol`
- business-ingestion provider: direct OpenAI

The direct OpenAI website-manager picker intentionally exposes the canonical GPT-5.6 family plus GPT-5.5 as a prior-generation baseline, all with locally verified pricing:

| Model | Intended use | Input / cached input / output per 1M tokens |
| --- | --- | --- |
| `gpt-5.6-sol` | Highest capability | $5.00 / $0.50 / $30.00 |
| `gpt-5.6-terra` | Balance of intelligence and cost | $2.50 / $0.25 / $15.00 |
| `gpt-5.6-luna` | Cost-sensitive, high-volume work | $1.00 / $0.10 / $6.00 |
| `gpt-5.5` | Prior-generation comparison or fallback | $5.00 / $0.50 / $30.00 |

The `gpt-5.6` alias is not separately listed because it routes to `gpt-5.6-sol`; Lodesta stores the canonical model ID.

During the pre-launch comparison experiment, private website setup uses an authenticated, searchable OpenRouter catalog for the initial website-manager build. The catalog is scoped to text models available to Lodesta’s OpenRouter account and only exposes concrete models that advertise tool calls, tool choice, reasoning, and structured-output support. Mutable `~provider/*-latest` aliases and OpenRouter’s virtual auto/free routers are omitted because they do not identify one stable comparison model. Setup retains both `openrouter` and the exact provider-qualified model ID, pins that route on the queued run, and shows the model as initial-build provenance on the Websites page. Business ingestion remains on the operator-configured ingestion model, and later owner edits continue to use the active website-manager setting, so the control isolates the first authoring pass rather than changing the entire pipeline.

Adding OpenRouter does not change an active route. An operator must configure `OPENROUTER_API_KEY` and explicitly save `openrouter` plus a provider-qualified model slug in **Operator settings → Runtime settings**. `LODESTA_SITE_AGENT_PROVIDER` and `LODESTA_SITE_AGENT_MODEL` remain operator-only environment overrides.

## Request policy

The model ID does not encode reasoning effort or output verbosity. Website-manager and discussion requests currently use one quality-first runtime profile for every approved model:

- reasoning effort: `high`;
- text verbosity: `low`;
- standard reasoning mode (not Pro mode);
- required, sequential workspace tool calls for authoring;
- API storage disabled.

The authoring loop manually replays the full response history, including encrypted reasoning content, so it can preserve reasoning while using `store: false`. Programmatic Tool Calling and GPT-5.6 multi-agent mode are not enabled.

OpenRouter website-manager requests use its OpenAI-compatible Responses endpoint. Each request:

- sends the complete stateless manager history;
- uses the run ID as the OpenRouter session key for upstream affinity and prompt-cache locality;
- requires an upstream that supports the request parameters;
- denies data-collection endpoints and requires zero-data-retention routing;
- enables OpenRouter routing metadata for provider attribution.

The website manager does not configure cross-model fallbacks or pin an upstream provider. OpenRouter may choose or fail over among compatible upstream endpoints for the one requested model. Because authoring requests include tools, OpenRouter's default Auto Exacto routing favors endpoints with stronger tool-calling and throughput signals. Lodesta does not force `provider.sort: "price"`; its privacy and parameter-compatibility filters apply before OpenRouter routes the request.

OpenRouter documents its Responses API as beta. Treat switching an active model route as an operator rollout: exercise the exact model’s tool calling, structured output, encrypted reasoning, context length, output-token limits, and cost reporting before changing the setting.

Authoring runs do not have cumulative input or output token budgets. Initial builds have a 60-minute absolute deadline and $15 metered-cost fuse; edits and rebases have a 25-minute deadline and $8 fuse. Research, Responses API authoring, and GPT Image asset generation count toward the same fuse. A successful final response is retained even when it crosses the fuse, but no additional model request begins afterward. Three consecutive identical deterministic release failures stop the run.

## Usage and cost telemetry

Every Responses model-request event, and every metered GPT Image tool event, records:

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
- `mixed`: a run includes more than one non-missing cost provenance.
- `unavailable`: neither provider billing nor catalog pricing was available.

Dashboards display `provider_reported` cost as billed and `catalog_estimate` cost as estimated. They never present a catalog estimate as an invoice amount. A Responses API authoring run stops with `cost_telemetry_unavailable` rather than continuing without enforceable cost accounting.

GPT Image 2 uses the Image API's returned token breakdown and the local standard-rate catalog: $5 per million text-input tokens, $8 per million image-input tokens, and $30 per million image-output tokens. The generated asset retains its provider/model provenance, while the tool event retains its own token and cost telemetry.

## References

- [OpenAI GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6-sol)
- [OpenAI GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [OpenAI GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [OpenAI GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)
- [OpenAI image-generation cost guidance](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)
- [OpenAI API pricing](https://openai.com/api/pricing/)
- [OpenRouter Responses API](https://openrouter.ai/docs/api_reference/responses/overview)
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter Auto Exacto](https://openrouter.ai/docs/guides/routing/auto-exacto)
- [OpenRouter router metadata](https://openrouter.ai/docs/guides/features/router-metadata)

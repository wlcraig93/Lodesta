# Model routing

Lodesta can run the website manager either directly through OpenAI or through OpenRouter. The canonical default remains:

- API provider: `openai`
- website manager model: `gpt-5.6-luna`
- business-ingestion provider: direct OpenAI

Initial builds use `gpt-5.6-luna` at high reasoning for both the exhaustive
architecture request and the workspace author. Architecture and authoring usage
share the same run deadline and cost fuse. Edits and rebases go directly to the
configured website manager without another architecture request. The approved
decision and canary evidence are recorded in
`docs/decisions/2026-08-03-luna-architecture-authoring-workflow.md`.

The direct OpenAI website-manager picker exposes the GPT-5.6 family, GPT-5.5 as a prior-generation baseline, and GPT-6 Astra for an operator-controlled quality experiment. Adding an option does not change the canonical default. Standard short-context pricing was checked against the official API table on September 5, 2026:

| Model | Intended use | Input / cached input / output per 1M tokens |
| --- | --- | --- |
| `gpt-6-astra` | Unpromoted operator quality comparison | $10.00 / $1.00 / $50.00 |
| `gpt-5.6-sol` | Operator comparison or focused high-capability work | $4.00 / $0.40 / $20.00 |
| `gpt-5.6-terra` | Balance of intelligence and cost | $2.00 / $0.20 / $12.00 |
| `gpt-5.6-luna` | Canonical architecture and website authoring | $0.20 / $0.02 / $1.20 |
| `gpt-5.5` | Prior-generation comparison or fallback | $5.00 / $0.50 / $30.00 |

For these models, more than 272,000 total input tokens applies 2× input/cache and 1.5× output pricing to the whole request. Cache writes reported by the API add 25% of the uncached input rate for those tokens. Provider-reported cost takes precedence. These are standard-rate estimates, not invoices; historical run usage is never recomputed after catalog updates. Sol's current price is promotional, available at least through November 21, 2026.

Astra uses the existing stateless, serial Responses authoring path, with the same high reasoning, low verbosity, tools, native inspection images, 200K compaction threshold and normal run fuse. Production-schema and bounded request probes accepted all 21 schemas and returned a valid `inspect_site` call; no tool was executed by those probes. They establish parameter compatibility, not site quality, actual compaction or warm-cache performance. Fresh hosted evaluation and the fixed multi-business screen are required before any canonical model change. No critic, async tools, multi-agent runtime, special Astra prompt, or additional retry is introduced.

A subsequent synthetic two-request probe accepted complete stateless function-output replay and reported cached input on both requests at service tier `default`. Because the same cached-token count was already present on the first request, this does not isolate new explicit-prefix reuse or prove long-run cache efficiency. No reasoning item was emitted by that trivial fixture. Probe evidence and limits are retained in `.design/v4-production-readiness-2026-09-04/ASTRA_MODEL_EXPERIMENT.md`.

The `gpt-5.6` alias is not separately listed because it routes to `gpt-5.6-sol`; Lodesta stores the canonical model ID.

Owner onboarding is model-agnostic. The website-manager workflow resolves the canonical configured creation route server-side, and the resulting run retains provider and model provenance for operators. Owners direct the website outcome; model-provider configuration remains an operator concern.

The admin **New site** form is model-agnostic, just like owner onboarding. Model experiments are selected through the backend operator setting or environment override, so a new site, a retry, and later edits all begin from one canonical route instead of carrying a hidden per-site exception.

Adding OpenRouter does not change an active route. An operator must configure `OPENROUTER_API_KEY` and explicitly save `openrouter` plus a provider-qualified model slug in **Operator settings → Runtime settings**. `LODESTA_SITE_AGENT_PROVIDER` and `LODESTA_SITE_AGENT_MODEL` remain operator-only environment overrides.

## Request policy

The model ID does not encode reasoning effort or output verbosity. Website-manager and discussion requests currently use one quality-first runtime profile for every approved model:

- reasoning effort: `high`;
- retained reasoning context: `all_turns` on direct OpenAI;
- text verbosity: `low`;
- standard reasoning mode (not Pro mode);
- required, sequential workspace tool calls for authoring;
- API storage disabled.

The direct OpenAI authoring loop manually replays every response output, including encrypted reasoning content, so it preserves reasoning while using `store: false`. Server-side Responses compaction is enabled at 200,000 rendered tokens. When OpenAI emits an opaque compaction item, Lodesta retains it unchanged and drops older input items before that boundary. Prompt caching and compaction remain separate: caching lowers repeated-prefix cost and latency, while compaction keeps long-running context focused and below capacity.

OpenRouter routes do not receive the OpenAI-only `context_management` field. They continue to use their established provider-specific reasoning replay and caching behavior. Programmatic Tool Calling and GPT-5.6 multi-agent mode are not enabled.

The initial context includes bounded labeled contact sheets of retained source media and canonical assets, plus the asset index. The manager can inspect additional promising assets through `inspect_assets` and retained source-resource tools. Website inspection supplies native viewport frames; source-media sheets and rendered-site frames serve different purposes.

For a targeted edit, the manager proceeds directly to `finish` after the source change unless concrete visual uncertainty warrants `inspect_site`. `inspect_site` builds dirty source itself and automatically focuses the supplied owner selection when inspecting that route; `finish` independently builds and performs hard release verification. Neither `build_preview` nor visual inspection is a routine pre-finish ceremony.

OpenRouter authoring is restricted to route/transport pairs that Lodesta has probed with the production tool schema, privacy policy, cost telemetry, and caching behavior:

- `anthropic/claude-opus-5` uses OpenRouter's native Anthropic Messages endpoint. Internal stable and rolling cache markers become native Anthropic `cache_control` blocks, strict tools use the Anthropic structured-output beta, and signed thinking blocks are replayed exactly.
- `moonshotai/kimi-k3` uses OpenRouter's Responses endpoint and Moonshot's provider-managed prefix caching. Anthropic-only cache controls and headers are not sent.

Both routes:

- send the complete append-only, stateless manager history;
- uses the run ID as the OpenRouter session key for upstream affinity and prompt-cache locality;
- deny data-collection endpoints and require zero-data-retention routing;
- restrict routing to the route descriptor's established ZDR-capable upstreams;
- require provider-reported usage and cost on every response;
- retain OpenRouter routing metadata for provider attribution.

Production authoring does not pin one upstream: OpenRouter may choose or fail over only among the established upstreams for the exact requested model. An upstream change is recorded as a routing diagnostic, not treated as a model change. Transport probes pin one upstream and disable fallbacks so cache and tool behavior can be attributed to a single endpoint.

`provider.require_parameters` is deliberately omitted. OpenRouter's Responses route excluded otherwise viable tool-capable Bedrock endpoints when it was enabled, and the Anthropic Messages transport establishes strict tool behavior directly. Adding an OpenRouter model requires a route descriptor plus a retained transport and warm-cache probe; unestablished catalog models are not selectable.

OpenRouter documents its Responses API as beta. Treat switching an active model route as an operator rollout: exercise the exact model and transport's tool calling, structured output, reasoning replay, context length, output-token limits, cost reporting, and warm-cache behavior before changing the setting.

Authoring runs do not have cumulative input or output token budgets. Initial builds have a 60-minute absolute deadline and $15 metered-cost fuse; edits and rebases have a 25-minute deadline and $8 fuse. Architecture, research, Responses API authoring, and GPT Image asset generation count toward the same fuse. A successful final response is retained even when it crosses the fuse, but no additional model request begins afterward. Three consecutive identical deterministic release failures stop the run.

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

- [OpenAI GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [OpenAI GPT-6 Astra migration guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)
- [OpenAI current API pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6-sol)
- [OpenAI Responses compaction](https://developers.openai.com/api/docs/guides/compaction)
- [OpenAI GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [OpenAI GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [OpenAI GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)
- [OpenAI image-generation cost guidance](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)
- [OpenAI API pricing](https://openai.com/api/pricing/)
- [OpenRouter Responses API](https://openrouter.ai/docs/api_reference/responses/overview)
- [OpenRouter Anthropic Messages API](https://openrouter.ai/docs/api-reference/anthropic-messages/create-messages)
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter Auto Exacto](https://openrouter.ai/docs/guides/routing/auto-exacto)
- [OpenRouter router metadata](https://openrouter.ai/docs/guides/features/router-metadata)

import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  assertOpenAiStrictFunctionTools,
  websiteManagerTools
} from "../packages/site-agent";

const apiKey = process.env.OPENAI_API_KEY?.trim();
assert(apiKey, "OPENAI_API_KEY is required for the live OpenAI tool-schema probe.");

const model = process.env.LODESTA_OPENAI_TOOL_SCHEMA_PROBE_MODEL?.trim() || "gpt-5.6-sol";
assertOpenAiStrictFunctionTools(websiteManagerTools);

const response = await new OpenAI({ apiKey }).responses.create({
  model,
  input: "Reply with OK. Do not call a tool.",
  tools: websiteManagerTools,
  tool_choice: "none",
  max_output_tokens: 16,
  store: false
});

console.log(JSON.stringify({
  ok: true,
  model,
  responseId: response.id,
  toolCount: websiteManagerTools.length
}));

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { externalMcpToolNames } from "@/packages/external-authoring";

const endpoint = process.env.LODESTA_EXTERNAL_AUTHORING_MCP_URL?.trim();
const bearer = process.env.LODESTA_MCP_BEARER_TOKEN?.trim();
if (!endpoint || !bearer) {
  throw new Error("LODESTA_EXTERNAL_AUTHORING_MCP_URL and LODESTA_MCP_BEARER_TOKEN are required.");
}
const url = new URL(endpoint);
if (!url.pathname.endsWith("/")) {
  throw new Error("LODESTA_EXTERNAL_AUTHORING_MCP_URL must use the canonical trailing-slash endpoint so authorization is not lost to a redirect.");
}

const missing = await fetch(url, { method: "GET" });
const invalid = await fetch(url, {
  method: "GET",
  headers: { authorization: "Bearer invalid-connectivity-token" }
});
assert.equal(missing.status, 401, "Missing MCP credential was accepted.");
assert.equal(invalid.status, 401, "Invalid MCP credential was accepted.");

const client = new Client({ name: "lodesta-connectivity-gate", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(url, {
  sessionId: `connectivity-${randomUUID()}`,
  requestInit: {
    headers: { authorization: `Bearer ${bearer}` }
  }
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const actual = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(actual, [...externalMcpToolNames].sort(), "MCP tool discovery differs from the strict allowlist.");
  for (const tool of tools.tools) {
    assert(tool.annotations, `${tool.name} does not expose MCP annotations.`);
  }
  process.stdout.write(`MCP initialized and discovered ${actual.length} allowlisted tools.\n`);

  if (process.argv.includes("--claim-fixture")) {
    const result = await client.callTool({
      name: "claim_next_site",
      arguments: { workerKey: `connectivity-gate-${randomUUID()}` }
    });
    process.stdout.write(`Fixture claim response: ${JSON.stringify(result.content)}\n`);
  }
} finally {
  await transport.close();
}

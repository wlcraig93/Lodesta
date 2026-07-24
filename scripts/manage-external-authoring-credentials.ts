import {
  createExternalAuthoringCredential,
  externalAuthoringRepository
} from "@/packages/external-authoring";

const [operation, argument] = process.argv.slice(2);

if (!operation || operation === "help" || operation === "--help") {
  help();
  process.exit(operation ? 0 : 1);
}

if (operation === "create") {
  const label = argument?.trim();
  if (!label) throw new Error("Credential label is required.");
  const { credential, token } = await createExternalAuthoringCredential(label);
  process.stdout.write(`Created ${credential.id} (${credential.label}).\n`);
  process.stdout.write("Copy this bearer token now. Lodesta stores only its hash and cannot recover it:\n\n");
  process.stdout.write(`${token}\n`);
} else if (operation === "list") {
  const credentials = await externalAuthoringRepository.listCredentials();
  if (!credentials.length) {
    process.stdout.write("No external authoring credentials.\n");
  } else {
    for (const credential of credentials) {
      process.stdout.write([
        credential.id,
        credential.status,
        credential.label,
        `created=${credential.createdAt}`,
        `last_used=${credential.lastUsedAt ?? "never"}`
      ].join("\t") + "\n");
    }
  }
} else if (operation === "revoke") {
  if (!argument) throw new Error("Credential ID is required.");
  const credential = (await externalAuthoringRepository.listCredentials()).find((item) => item.id === argument);
  if (!credential) throw new Error("Credential not found.");
  await externalAuthoringRepository.revokeCredential(credential.id, new Date().toISOString());
  process.stdout.write(`Revoked ${credential.id}.\n`);
} else {
  help();
  throw new Error(`Unknown operation: ${operation}`);
}

function help() {
  process.stdout.write("Manage hashed bearer credentials for the operator-only Lodesta MCP server.\n\n");
  process.stdout.write("npm run access:external-authoring -- create \"Personal Codex\"\n");
  process.stdout.write("npm run access:external-authoring -- list\n");
  process.stdout.write("npm run access:external-authoring -- revoke <credential-id>\n");
}

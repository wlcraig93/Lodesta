const supportedStringFormats = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "uuid"
]);

const supportedSchemaKeywords = new Set([
  "$defs",
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type"
]);

const unsupportedCompositionKeywords = new Set([
  "allOf",
  "dependentRequired",
  "dependentSchemas",
  "else",
  "if",
  "not",
  "oneOf",
  "patternProperties",
  "then"
]);

const supportedTypes = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string"
]);

const maximumSchemaDepth = 10;
const maximumObjectProperties = 5_000;
const maximumEnumValues = 1_000;

export class OpenAiStrictToolSchemaError extends Error {
  readonly name = "OpenAiStrictToolSchemaError";
}

/**
 * Checks the documented JSON Schema subset accepted by OpenAI strict function
 * tools. Domain validation still belongs in the runtime Zod contract.
 */
export function assertOpenAiStrictFunctionSchema(schema: unknown, toolName: string) {
  assertOpenAiStrictJsonSchema(schema, toolName);
}

export function assertOpenAiStrictJsonSchema(schema: unknown, schemaName: string) {
  const counters = { properties: 0 };
  const root = schemaRecord(schema, schemaName);

  if (root.type !== "object") {
    fail(schemaName, "the root schema must have type \"object\"");
  }
  if ("anyOf" in root) {
    fail(schemaName, "the root schema cannot use anyOf");
  }

  visitSchema(root, schemaName, 1, counters);
}

export function assertOpenAiStrictFunctionTools(tools: readonly unknown[]) {
  for (const [index, value] of tools.entries()) {
    const candidate = schemaRecord(value, `tools[${index}]`);
    if (candidate.type !== "function") continue;
    const name = typeof candidate.name === "string" && candidate.name.length > 0
      ? candidate.name
      : `tools[${index}]`;
    if (candidate.strict !== true) {
      fail(name, "authoring function tools must enable strict mode");
    }
    assertOpenAiStrictFunctionSchema(candidate.parameters, name);
  }
}

function visitSchema(
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  counters: { properties: number }
) {
  if (depth > maximumSchemaDepth) {
    fail(path, `schema nesting exceeds ${maximumSchemaDepth} levels`);
  }

  for (const keyword of Object.keys(schema)) {
    if (unsupportedCompositionKeywords.has(keyword)) {
      fail(path, `unsupported composition keyword "${keyword}"`);
    }
    if (!supportedSchemaKeywords.has(keyword)) {
      fail(path, `unsupported schema keyword "${keyword}"`);
    }
  }

  if ("$ref" in schema) {
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) {
      fail(path, "$ref must be a local schema reference");
    }
  }

  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0 || types.some((type) => typeof type !== "string" || !supportedTypes.has(type))) {
      fail(path, "type contains an unsupported JSON Schema type");
    }
  } else if (!("$ref" in schema) && !("anyOf" in schema) && !("enum" in schema) && !("const" in schema)) {
    fail(path, "schema nodes must declare type, $ref, anyOf, enum, or const");
  }

  if ("format" in schema) {
    if (typeof schema.format !== "string" || !supportedStringFormats.has(schema.format)) {
      fail(path, `unsupported string format "${String(schema.format)}"`);
    }
  }

  if ("enum" in schema) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      fail(path, "enum must contain at least one value");
    }
    if (schema.enum.length > maximumEnumValues) {
      fail(path, `enum contains more than ${maximumEnumValues} values`);
    }
  }

  if ("anyOf" in schema) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      fail(path, "anyOf must contain at least one schema");
    }
    for (const [index, option] of schema.anyOf.entries()) {
      visitSchema(schemaRecord(option, `${path}.anyOf[${index}]`), `${path}.anyOf[${index}]`, depth + 1, counters);
    }
  }

  if ("$defs" in schema) {
    const definitions = schemaRecord(schema.$defs, `${path}.$defs`);
    for (const [name, definition] of Object.entries(definitions)) {
      visitSchema(schemaRecord(definition, `${path}.$defs.${name}`), `${path}.$defs.${name}`, depth + 1, counters);
    }
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) {
    if (schema.additionalProperties !== false) {
      fail(path, "object schemas must set additionalProperties to false");
    }
    const properties = schemaRecord(schema.properties, `${path}.properties`);
    const propertyNames = Object.keys(properties);
    counters.properties += propertyNames.length;
    if (counters.properties > maximumObjectProperties) {
      fail(path, `tool schema contains more than ${maximumObjectProperties} object properties`);
    }
    if (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== "string")) {
      fail(path, "object schemas must declare a string required array");
    }
    const required = schema.required as string[];
    if (
      required.length !== propertyNames.length
      || new Set(required).size !== required.length
      || required.some((name) => !Object.hasOwn(properties, name))
    ) {
      fail(path, "strict object schemas must require every declared property exactly once");
    }
    for (const [name, property] of Object.entries(properties)) {
      visitSchema(schemaRecord(property, `${path}.${name}`), `${path}.${name}`, depth + 1, counters);
    }
  }

  if (types.includes("array")) {
    if (!("items" in schema)) {
      fail(path, "array schemas must declare items");
    }
    visitSchema(schemaRecord(schema.items, `${path}[]`), `${path}[]`, depth + 1, counters);
  }
}

function schemaRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected a JSON Schema object");
  }
  return value as Record<string, unknown>;
}

function fail(path: string, message: string): never {
  throw new OpenAiStrictToolSchemaError(`Invalid OpenAI strict tool schema at ${path}: ${message}.`);
}

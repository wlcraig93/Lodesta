import "./load-env";

import {
  defaultOpenAiRuntimeEditableSettings,
  seedOpenAiRuntimeSettings,
  validateOpenAiRuntimeSettingsInput
} from "../lib/operator-settings";

const flags = parseFlags(process.argv.slice(2));
const candidate = {
  ...defaultOpenAiRuntimeEditableSettings(),
  generationModel: flags["generation-model"] ?? defaultOpenAiRuntimeEditableSettings().generationModel,
  visualQaModel: flags["visual-qa-model"] ?? defaultOpenAiRuntimeEditableSettings().visualQaModel,
  imageModel: flags["image-model"] ?? defaultOpenAiRuntimeEditableSettings().imageModel,
  imageSize: flags["image-size"] ?? defaultOpenAiRuntimeEditableSettings().imageSize,
  imageQuality: flags["image-quality"] ?? defaultOpenAiRuntimeEditableSettings().imageQuality,
  mockupLimit: flags["mockup-limit"] ?? defaultOpenAiRuntimeEditableSettings().mockupLimit
};

const parsed = validateOpenAiRuntimeSettingsInput(candidate);
if (!parsed.ok) {
  throw new Error(`Invalid OpenAI runtime settings: ${parsed.issues.join("; ")}`);
}

const result = await seedOpenAiRuntimeSettings({
  settings: parsed.settings,
  changedBy: "seed:openai-settings"
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      changed: result.changed,
      version: result.snapshot.version,
      source: result.snapshot.source,
      settings: result.snapshot.settings
    },
    null,
    2
  )}\n`
);

function parseFlags(args: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      parsed[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${withoutPrefix}`);
    }
    parsed[withoutPrefix] = next;
    index += 1;
  }
  return parsed;
}

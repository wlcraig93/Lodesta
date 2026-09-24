export const generationCrawlerProductToken = "LodestaBot";
export const generationCrawlerUserAgent = `${generationCrawlerProductToken}/1.0 (+https://lodesta.com/bot)`;
// Site owners who opted out under the previous product token keep that opt-out.
export const generationCrawlerRobotsTokens = [generationCrawlerProductToken, "LodestaWebsiteCrawler"] as const;

export type RobotsRule = {
  kind: "allow" | "disallow";
  pattern: string;
};

export type RobotsPolicy = {
  rules: RobotsRule[];
  sitemaps: string[];
};

type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

export function parseRobotsPolicy(
  text: string,
  productToken: string | readonly string[] = generationCrawlerRobotsTokens
): RobotsPolicy {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | undefined;

  const flush = () => {
    if (current?.agents.length) groups.push(current);
    current = undefined;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      if (current?.rules.length) flush();
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (current?.rules.length) flush();
      current ??= { agents: [], rules: [] };
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }
    if ((field === "allow" || field === "disallow") && current?.agents.length && value) {
      current.rules.push({ kind: field, pattern: value });
    }
  }
  flush();

  return {
    rules: selectRules(groups, productToken),
    sitemaps: [...new Set(sitemaps)]
  };
}

export function robotsAllows(url: string, rules: RobotsRule[]) {
  const parsed = new URL(url);
  const target = `${parsed.pathname}${parsed.search}`;
  const matches = rules
    .filter((rule) => robotsPatternMatches(rule.pattern, target))
    .map((rule) => ({ ...rule, specificity: ruleSpecificity(rule.pattern) }));
  if (!matches.length) return true;
  const strongest = Math.max(...matches.map((rule) => rule.specificity));
  return matches.some((rule) => rule.specificity === strongest && rule.kind === "allow");
}

// Tokens are tried in priority order: the first token with a specifically matching group
// decides, so a LodestaBot group outranks a group written for an earlier token.
function selectRules(groups: RobotsGroup[], productToken: string | readonly string[]) {
  const tokens = typeof productToken === "string" ? [productToken] : productToken;
  for (const token of tokens) {
    const selected = selectRulesForToken(groups, token.toLowerCase());
    if (selected.specific) return selected.rules;
  }
  return groups.filter((group) => group.agents.includes("*")).flatMap((group) => group.rules);
}

function selectRulesForToken(groups: RobotsGroup[], normalizedProduct: string) {
  const ranked = groups.map((group) => ({
    group,
    specificity: Math.max(
      -1,
      ...group.agents.map((agent) => {
        if (agent === "*") return 0;
        return normalizedProduct.startsWith(agent) ? agent.length : -1;
      })
    )
  }));
  const strongestSpecific = Math.max(-1, ...ranked.map((entry) => entry.specificity));
  return {
    specific: strongestSpecific > 0,
    rules: ranked
      .filter((entry) => entry.specificity === strongestSpecific)
      .flatMap((entry) => entry.group.rules)
  };
}

function robotsPatternMatches(pattern: string, target: string) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(target);
}

function ruleSpecificity(pattern: string) {
  return pattern.replace(/\$$/, "").replaceAll("*", "").length;
}

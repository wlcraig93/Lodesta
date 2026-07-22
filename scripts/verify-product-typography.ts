import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const fontFiles = [
  { path: "app/fonts/InterVariable.woff2", family: "Inter", minimumSize: 300_000 },
  { path: "app/fonts/InterVariable-Italic.woff2", family: "Inter", minimumSize: 300_000 },
  { path: "app/fonts/Figtree[wght].woff2", family: "Figtree", minimumSize: 20_000 },
  { path: "app/fonts/Figtree-Italic[wght].woff2", family: "Figtree", minimumSize: 20_000 }
];

const licensePaths = ["app/fonts/Inter-OFL.txt", "app/fonts/Figtree-OFL.txt"];

for (const path of [...fontFiles.map(({ path }) => path), ...licensePaths]) {
  await access(path);
}

for (const { path, family, minimumSize } of fontFiles) {
  const details = await stat(path);
  assert(details.size > minimumSize, `${path} does not look like a complete ${family} variable font`);
}

const [fontModule, layout, marketingShell, globals, tokens, interLicense, figtreeLicense, designLanguage] = await Promise.all([
  readFile("app/fonts.ts", "utf8"),
  readFile("app/layout.tsx", "utf8"),
  readFile("components/MarketingShell.tsx", "utf8"),
  readFile("app/globals.css", "utf8"),
  readFile("app/product-tokens.css", "utf8"),
  readFile("app/fonts/Inter-OFL.txt", "utf8"),
  readFile("app/fonts/Figtree-OFL.txt", "utf8"),
  readFile("docs/design/lodesta-product-design-language.md", "utf8")
]);

assert(fontModule.includes('from "next/font/local"'), "The local fonts are not configured with next/font/local");
assert(fontModule.includes('variable: "--font-lodesta-product-sans"'), "Inter does not expose --font-lodesta-product-sans");
assert(fontModule.includes('variable: "--font-lodesta-brand-sans"'), "Figtree does not expose --font-lodesta-brand-sans");
assert((fontModule.match(/weight: "100 900"/g) ?? []).length === 4, "Both variable families must configure normal and italic weight ranges");
assert(layout.includes('className={lodestaProductSans.variable}'), "The Inter product variable is not applied in the root layout");
assert(marketingShell.includes("lodestaBrandSans.variable"), "The Figtree brand variable is not scoped to the marketing shell");
assert(interLicense.includes("SIL OPEN FONT LICENSE Version 1.1"), "The bundled Inter OFL license is missing or invalid");
assert(figtreeLicense.includes("SIL OPEN FONT LICENSE Version 1.1"), "The bundled Figtree OFL license is missing or invalid");

const productCss = [
  ["app/globals.css", globals],
  ["app/product-tokens.css", tokens]
] as const;

const forbiddenFontPatterns = [
  /fonts\.googleapis\.com/i,
  /@import\s+url\([^)]*font/i,
  /--product-font-(?:display|body)\b/,
  /--font-(?:display|body)\b/,
  /--font-lodesta-sans\b/,
  /\b(?:Aptos|Avenir Next)\b/
];

for (const [path, source] of productCss) {
  for (const pattern of forbiddenFontPatterns) {
    assert(!pattern.test(source), `${path} contains forbidden typography source ${pattern}`);
  }
}

assert(tokens.includes("--product-font-sans: var(--font-lodesta-product-sans, ui-sans-serif)"), "The canonical Inter product token or its resilient fallback is missing");
assert(tokens.includes("--brand-font-sans: var(--font-lodesta-brand-sans, var(--font-lodesta-product-sans, ui-sans-serif))"), "The canonical Figtree brand token or its resilient fallback is missing");
assert(globals.includes(".marketing-shell {\n  --brand-font-sans: var(--font-lodesta-brand-sans, var(--font-lodesta-product-sans, ui-sans-serif))"), "The Figtree token is not resolved inside its scoped marketing boundary");
assert(tokens.includes("--product-font-weight-regular: 400"), "The regular weight token must be 400");
assert(tokens.includes("--product-font-weight-medium: 500"), "The medium weight token must be 500");
assert(tokens.includes("--product-font-weight-strong: 600"), "The strong weight token must be 600");

for (const match of globals.matchAll(/^\s*font-weight:\s*([^;]+);/gm)) {
  assert(
    /^var\(--product-font-weight-(?:regular|medium|strong)\)$/.test(match[1].trim()),
    `app/globals.css uses a noncanonical font weight: ${match[1].trim()}`
  );
}

const allowedFamilies = new Set([
  "var(--product-font-sans)",
  "var(--brand-font-sans)",
  "var(--product-font-mono)",
  'Roboto, "Segoe UI", ui-sans-serif, system-ui, sans-serif'
]);

for (const match of globals.matchAll(/^\s*font-family:\s*([^;]+);/gm)) {
  assert(allowedFamilies.has(match[1].trim()), `app/globals.css uses a noncanonical font family: ${match[1].trim()}`);
}

for (const path of await collectFiles(["app", "components"], new Set([".css", ".tsx"]))) {
  const source = await readFile(path, "utf8");
  assert(!/fontWeight\s*[:=]/.test(source), `${path} bypasses the CSS typography contract with an inline fontWeight`);
}

assert(designLanguage.includes("| Product page title | 30px desktop / 26px mobile | 500 | 1.15 |"), "The canonical typography role matrix is missing");
assert(designLanguage.includes("Inter is the product family"), "The Inter product-family boundary is undocumented");
assert(designLanguage.includes("Figtree is the brand family"), "The Figtree brand-family boundary is undocumented");
assert(designLanguage.includes("Generated customer websites and all content rendered inside preview iframes are explicitly outside this contract."), "The customer-site typography exclusion is missing");

console.log("Product typography verification passed.");

async function collectFiles(roots: string[], extensions: Set<string>): Promise<string[]> {
  const files: string[] = [];

  for (const root of roots) {
    await walk(root);
  }

  return files;

  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (extensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        files.push(child);
      }
    }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

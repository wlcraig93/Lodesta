import ts from "typescript";
import { sandboxSourcePolicyVersion } from "../version-manifest";

export type WorkspaceSourcePolicyFindingV1 = {
  id: string;
  path: string;
  message: string;
};

export const workspaceSourcePolicyVersion = sandboxSourcePolicyVersion;

export type WorkspaceSourcePolicyFileV1 = { path: string; content: string };

const requiredPaths = new Set(["src/site.tsx", "src/styles.css"]);
const allowedImports = new Set(["react", "../platform/sdk"]);
const forbiddenReferences = new Map<string, string>([
  ["fetch", "network"], ["XMLHttpRequest", "network"], ["WebSocket", "network"], ["EventSource", "network"],
  ["process", "runtime_environment"], ["globalThis", "runtime_environment"], ["Deno", "runtime_environment"], ["Bun", "runtime_environment"],
  ["window", "browser_runtime"], ["document", "browser_runtime"], ["navigator", "browser_runtime"],
  ["localStorage", "browser_runtime"], ["sessionStorage", "browser_runtime"]
]);
const forbiddenCalls = new Map<string, string>([
  ["require", "commonjs"], ["eval", "code_generation"], ["Function", "code_generation"],
  ["setTimeout", "timers"], ["setInterval", "timers"], ["queueMicrotask", "timers"]
]);
const forbiddenJsxElements = new Set(["link", "script", "style"]);
const forbiddenCss: Array<[string, RegExp]> = [
  ["import", /@import\b/i],
  ["font_face", /@font-face\b/i],
  ["external_url", /url\s*\(/i],
  ["executable", /(?:expression|javascript\s*:|behavior\s*:|-moz-binding)\b/i]
];

export function validateWorkspaceSourcePolicy(files: WorkspaceSourcePolicyFileV1[]) {
  const findings: WorkspaceSourcePolicyFindingV1[] = [];
  const paths = new Set(files.map((file) => file.path));
  for (const path of requiredPaths) {
    if (!paths.has(path)) findings.push({ id: "source.required_file", path, message: `Required source file ${path} is missing.` });
  }
  for (const file of files) {
    if (!requiredPaths.has(file.path)) {
      findings.push({ id: "source.path", path: file.path, message: "Generated source is outside the two-file workspace allowlist." });
      continue;
    }
    if (file.path === "src/styles.css") {
      for (const [id, pattern] of forbiddenCss) {
        if (pattern.test(file.content)) findings.push({ id: `source.css_${id}`, path: file.path, message: `Generated CSS uses forbidden ${id.replaceAll("_", " ")} syntax.` });
      }
      continue;
    }

    findings.push(...validateTsx(file));
  }
  return dedupe(findings);
}

export function assertWorkspaceSourcePolicy(files: WorkspaceSourcePolicyFileV1[]) {
  const findings = validateWorkspaceSourcePolicy(files);
  if (!findings.length) return;
  const error = new Error(findings.map((finding) => `${finding.path}: ${finding.message}`).join("\n"));
  Object.assign(error, { code: "source_policy_violation", findings });
  throw error;
}

function validateTsx(file: WorkspaceSourcePolicyFileV1) {
  const findings: WorkspaceSourcePolicyFindingV1[] = [];
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imported = new Set<string>();
  const add = (id: string, message: string) => findings.push({ id: `source.${id}`, path: file.path, message });

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleId = statement.moduleSpecifier.text;
      imported.add(moduleId);
      if (!statement.importClause) add("import_syntax", "Only explicit static imports from the source allowlist are permitted.");
      if (!allowedImports.has(moduleId)) add("import_module", `Import from ${moduleId} is not allowlisted.`);
    } else if (ts.isImportEqualsDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier)) {
      add("import_syntax", "Only static imports from the source allowlist are permitted.");
    }
  }
  if (!imported.has("react") || !imported.has("../platform/sdk")) {
    add("import_required", "The workspace must import React and the Lodesta SDK explicitly.");
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && /&(?:#\d+|#x[a-f0-9]+|[a-z][a-z0-9]+);/i.test(node.getText(source))) {
      add("escaped_entity", "Generated JSX contains an HTML entity source sequence; write the intended Unicode or ASCII punctuation directly.");
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source).toLowerCase();
      if (forbiddenJsxElements.has(tag)) {
        add("executable_markup", `Generated source uses forbidden <${tag}> markup; document metadata and executable resources are platform-owned.`);
      }
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "React"
      && node.expression.name.text === "createElement"
      && node.arguments[0]
      && ts.isStringLiteralLike(node.arguments[0])
      && forbiddenJsxElements.has(node.arguments[0].text.toLowerCase())
    ) {
      add("executable_markup", `Generated source uses forbidden <${node.arguments[0].text.toLowerCase()}> markup; document metadata and executable resources are platform-owned.`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add("dynamic_import", "Generated source uses forbidden dynamic import behavior.");
    }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) {
      const category = forbiddenCalls.get(node.expression.text);
      if (category) add(category, `Generated source uses forbidden ${category.replaceAll("_", " ")} behavior.`);
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "constructor") {
      add("code_generation", "Generated source uses forbidden code generation behavior.");
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const property = staticString(node.argumentExpression);
      if (property === undefined && !ts.isNumericLiteral(node.argumentExpression)) {
        add("computed_property", "Generated source uses a dynamic computed property access, which is outside the source allowlist.");
      } else if (property === "constructor" || forbiddenReferences.has(property ?? "") || forbiddenCalls.has(property ?? "")) {
        add("code_generation", `Generated source uses forbidden computed property ${JSON.stringify(property)}.`);
      }
    }
    if (ts.isIdentifier(node) && !isPropertyName(node)) {
      const category = forbiddenReferences.get(node.text);
      if (category) add(category, `Generated source uses forbidden ${category.replaceAll("_", " ")} behavior.`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function staticString(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  return undefined;
}

function isPropertyName(node: ts.Identifier) {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isMethodSignature(parent) && parent.name === node)
    || (ts.isJsxAttribute(parent) && parent.name === node)
    || ts.isImportSpecifier(parent)
    || ts.isImportClause(parent)
    || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent);
}

function dedupe(findings: WorkspaceSourcePolicyFindingV1[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.id}:${finding.path}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

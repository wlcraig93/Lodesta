import ts from "typescript";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import { sandboxSourcePolicyIdentity } from "../component-manifest";

export type WorkspaceSourcePolicyFinding = {
  id: string;
  path: string;
  message: string;
};

export const workspaceSourcePolicyIdentity = sandboxSourcePolicyIdentity;

export type WorkspaceSourcePolicyFile = { path: string; content: string };

const requiredPaths = new Set(["src/site.tsx", "src/styles.css"]);
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
export function validateWorkspaceSourcePolicy(files: WorkspaceSourcePolicyFile[]) {
  const findings: WorkspaceSourcePolicyFinding[] = [];
  const paths = new Set(files.map((file) => file.path));
  for (const path of requiredPaths) {
    if (!paths.has(path)) findings.push({ id: "source.required_file", path, message: `Required source file ${path} is missing.` });
  }
  for (const file of files) {
    if (!isAllowedSourcePath(file.path)) {
      findings.push({ id: "source.path", path: file.path, message: "Source must be a safe .ts, .tsx, or .css file beneath src/." });
      continue;
    }
    if (file.path.endsWith(".css")) {
      findings.push(...validateCss(file));
      continue;
    }

    findings.push(...validateTypeScript(file));
  }
  if (files.length > 80) findings.push({ id: "source.file_limit", path: "src", message: "A workspace may contain at most 80 source files." });
  if (files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) > 4_000_000) {
    findings.push({ id: "source.byte_limit", path: "src", message: "Workspace source may contain at most 4 MB." });
  }
  return dedupe(findings);
}

function validateCss(file: WorkspaceSourcePolicyFile) {
  const findings: WorkspaceSourcePolicyFinding[] = [];
  try {
    const root = postcss.parse(file.content);
    root.walkAtRules((rule) => {
      const name = decodeCssEscapes(rule.name).toLowerCase();
      if (name === "import" || name === "font-face") {
        const id = name === "font-face" ? "font_face" : name;
        findings.push({
          id: `source.css_${id}`,
          path: file.path,
          message: `Generated CSS uses forbidden ${id.replaceAll("_", " ")} syntax.`
        });
      }
    });
    root.walkDecls((declaration) => {
      const property = decodeCssEscapes(declaration.prop).toLowerCase();
      const decodedValue = decodeCssEscapes(declaration.value);
      const parsedValue = valueParser(decodedValue);
      let executable = property === "behavior" || property === "-moz-binding" || /javascript\s*:/i.test(decodedValue);
      parsedValue.walk((node) => {
        if (node.type === "function" && decodeCssEscapes(node.value).toLowerCase() === "expression") executable = true;
      });
      if (executable) {
        findings.push({
          id: "source.css_executable",
          path: file.path,
          message: "Generated CSS uses forbidden executable syntax."
        });
      }
      parsedValue.walk((node) => {
        if (node.type !== "function" || decodeCssEscapes(node.value).toLowerCase() !== "url") return;
        const raw = valueParser.stringify(node.nodes).trim().replace(/^(['"])(.*)\1$/, "$2");
        const decoded = decodeCssEscapes(raw);
        if (!/^asset:\/\/[a-zA-Z0-9_.:-]+$/.test(decoded)) {
          findings.push({
            id: "source.css_external_url",
            path: file.path,
            message: `Generated CSS URL must use an asset:// ID, received ${JSON.stringify(decoded)}.`
          });
        }
      });
    });
  } catch (error) {
    findings.push({
      id: "source.css_parse",
      path: file.path,
      message: `Generated CSS could not be parsed safely: ${error instanceof Error ? error.message : String(error)}`
    });
  }
  return findings;
}

function decodeCssEscapes(value: string) {
  return value.replace(/\\([0-9a-f]{1,6})(?:\s)?|\\(.)/gi, (_match, hex: string | undefined, escaped: string | undefined) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : escaped ?? "");
}

export function assertWorkspaceSourcePolicy(files: WorkspaceSourcePolicyFile[]) {
  const findings = validateWorkspaceSourcePolicy(files);
  if (!findings.length) return;
  const error = new Error(findings.map((finding) => `${finding.path}: ${finding.message}`).join("\n"));
  Object.assign(error, { code: "source_policy_violation", findings });
  throw error;
}

function validateTypeScript(file: WorkspaceSourcePolicyFile) {
  const findings: WorkspaceSourcePolicyFinding[] = [];
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (id: string, message: string) => findings.push({ id: `source.${id}`, path: file.path, message });

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleId = statement.moduleSpecifier.text;
      if (!statement.importClause) {
        add(
          "import_syntax",
          moduleId.endsWith(".css")
            ? "Do not import CSS files from TypeScript; the compiler automatically includes every CSS file beneath src/."
            : "Only explicit static imports from the source allowlist are permitted."
        );
      }
      if (!allowedImport(file.path, moduleId)) add("import_module", `Import from ${moduleId} is not allowlisted.`);
    } else if (ts.isImportEqualsDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier)) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        && allowedImport(file.path, statement.moduleSpecifier.text)) continue;
      add("import_syntax", "Only static imports from React, the Lodesta SDK, and local src files are permitted.");
    }
  }

  const visit = (node: ts.Node) => {
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
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        const expression = node.getText(source).replace(/\s+/g, " ").slice(0, 240);
        add(
          "computed_property",
          `Generated source uses dynamic computed property access at ${line + 1}:${character + 1} (${expression}). Replace it with a statically named property, a switch, or an explicit conditional.`
        );
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

function isAllowedSourcePath(path: string) {
  return /^src\/[a-zA-Z0-9_.\/-]+\.(?:ts|tsx|css)$/.test(path)
    && !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

function allowedImport(fromPath: string, moduleId: string) {
  if (moduleId === "react") return true;
  if (!moduleId.startsWith(".")) return false;
  const resolved = normalizePath(`${fromPath.slice(0, fromPath.lastIndexOf("/"))}/${moduleId}`);
  if (!resolved) return false;
  if (resolved === "platform/sdk") return true;
  if (!resolved.startsWith("src/")) return false;
  return true;
}

function normalizePath(value: string) {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    }
    else parts.push(part);
  }
  return parts.join("/").replace(/\.(?:ts|tsx|css)$/, "");
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

function dedupe(findings: WorkspaceSourcePolicyFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.id}:${finding.path}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

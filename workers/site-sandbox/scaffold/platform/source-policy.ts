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
const lodestaSdkJsxNames = new Set([
  "BusinessName", "BusinessHours", "BusinessAddress", "Fact", "Asset",
  "LeadForm", "LeadField", "LeadSubmit", "LeadFormStatus",
  "DirectionsLink", "SafeLink", "NavigationDisclosure"
]);
const allowedAuthoredLodestaAttributes = new Set(["data-lodesta-conversion", "data-lodesta-role"]);
export function validateWorkspaceSourcePolicy(
  files: WorkspaceSourcePolicyFile[],
  options?: { runtimeSeriesId?: string }
) {
  const runtimeSeriesId = options?.runtimeSeriesId ?? "site-runtime-v4";
  if (runtimeSeriesId !== "site-runtime-v4") {
    return [{ id: "source.runtime_series", path: "src", message: `Unsupported authoring runtime ${runtimeSeriesId}; only site-runtime-v4 is canonical.` }];
  }
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

    findings.push(...validateTypeScript(file, lodestaSdkJsxNames));
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

function validateTypeScript(file: WorkspaceSourcePolicyFile, permittedSdkJsxNames: ReadonlySet<string>) {
  const findings: WorkspaceSourcePolicyFinding[] = [];
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (id: string, message: string) => findings.push({ id: `source.${id}`, path: file.path, message });
  const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const diagnostic of parseDiagnostics) {
    const location = diagnostic.start === undefined
      ? ""
      : (() => {
          const { line, character } = source.getLineAndCharacterOfPosition(diagnostic.start);
          return ` at ${line + 1}:${character + 1}`;
        })();
    add("syntax", `TypeScript syntax error${location}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  const declaredIdentifiers = declaredValueIdentifiers(source);
  const usedSdkJsxNames = new Set<string>();

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
      if (moduleId === "#lodesta-sdk" && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
        for (const specifier of statement.importClause.namedBindings.elements) {
          const importedName = specifier.propertyName?.text ?? specifier.name.text;
          if (!permittedSdkJsxNames.has(importedName)) {
            add("sdk_export", `${importedName} is not available in this authoring runtime.`);
          }
        }
      }
    } else if (ts.isImportEqualsDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier)) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        && allowedImport(file.path, statement.moduleSpecifier.text)) continue;
      add("import_syntax", "Only static imports from React, the Lodesta SDK, and local src files are permitted.");
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) continue;
        const attributeName = attribute.name.getText(source).toLowerCase();
        if (attributeName.startsWith("data-lodesta-") && !allowedAuthoredLodestaAttributes.has(attributeName)) {
          add("reserved_kernel_attribute", `Generated source uses reserved kernel binding ${JSON.stringify(attributeName)} in JSX.`);
        }
      }
      if (ts.isIdentifier(node.tagName) && permittedSdkJsxNames.has(node.tagName.text)) {
        usedSdkJsxNames.add(node.tagName.text);
      }
      if (
        ts.isIdentifier(node.tagName)
        && node.tagName.text === "SafeLink"
        && hasIntrinsicJsxAncestor(node, "a", source)
      ) {
        add(
          "safelink_anchor_nesting",
          "SafeLink already renders an anchor; use SafeLink directly and pass className to it instead of wrapping it in <a>."
        );
      }
      const tag = node.tagName.getText(source).toLowerCase();
      if (isIntrinsicJsxTag(node.tagName) && forbiddenJsxElements.has(tag)) {
        add("executable_markup", `Generated source uses forbidden <${tag}> markup; document metadata and executable resources are platform-owned.`);
      }
      if (isIntrinsicJsxTag(node.tagName)) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) continue;
          const attributeName = attribute.name.getText(source).toLowerCase();
          if (attributeName === "dangerouslysetinnerhtml") {
            add(
              "executable_markup",
              `Generated source uses forbidden ${JSON.stringify(attributeName)} on intrinsic <${tag}> markup.`
            );
          }
        }
      }
    }
    if (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const propertyName = staticPropertyName(node.name);
      if (propertyName?.toLowerCase().startsWith("data-lodesta-") && !allowedAuthoredLodestaAttributes.has(propertyName.toLowerCase())) {
        add("reserved_kernel_attribute", `Generated source uses reserved kernel binding ${JSON.stringify(propertyName)} in an object literal.`);
      }
    }
    if (isReactCreateElement(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const tag = node.arguments[0].text.toLowerCase();
      if (forbiddenJsxElements.has(tag)) {
        add("executable_markup", `Generated source uses forbidden <${tag}> markup; document metadata and executable resources are platform-owned.`);
      }
      const properties = node.arguments[1];
      if (properties && properties.kind !== ts.SyntaxKind.NullKeyword && !isUndefinedIdentifier(properties) && ts.isObjectLiteralExpression(properties)) {
        for (const property of properties.properties) {
          if (ts.isSpreadAssignment(property)) continue;
          const propertyName = property.name ? staticPropertyName(property.name) : undefined;
          if (propertyName?.toLowerCase().startsWith("data-lodesta-") && !allowedAuthoredLodestaAttributes.has(propertyName.toLowerCase())) {
            add("reserved_kernel_attribute", `Generated source uses reserved kernel binding ${JSON.stringify(propertyName)} in React.createElement(${JSON.stringify(tag)}).`);
          }
          if (propertyName?.toLowerCase() === "dangerouslysetinnerhtml") {
            add(
              "executable_markup",
              `Generated source uses forbidden property ${JSON.stringify(propertyName)} in React.createElement(${JSON.stringify(tag)}).`
            );
          }
        }
      }
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
          `Unsafe dynamic computed property access at ${line + 1}:${character + 1} (${expression}).`
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
  const missingSdkImports = [...usedSdkJsxNames]
    .filter((name) => !declaredIdentifiers.has(name))
    .sort();
  if (missingSdkImports.length) {
    add(
      "sdk_import_missing",
      `Missing #lodesta-sdk JSX import(s): ${missingSdkImports.join(", ")}. Import every named SDK component used in this file before building.`
    );
  }
  if (file.path === "src/site.tsx") findings.push(...validateStaticSiteDefinition(source, file.path));
  return findings;
}

function hasIntrinsicJsxAncestor(node: ts.Node, tagName: string, source: ts.SourceFile) {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      ts.isJsxElement(ancestor)
      && isIntrinsicJsxTag(ancestor.openingElement.tagName)
      && ancestor.openingElement.tagName.getText(source).toLowerCase() === tagName
    ) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

function declaredValueIdentifiers(source: ts.SourceFile) {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) addBinding(element.name);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportClause(node) && node.name) names.add(node.name.text);
    if (ts.isImportSpecifier(node)) names.add(node.name.text);
    if (ts.isNamespaceImport(node)) names.add(node.name.text);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
      names.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node)) addBinding(node.name);
    if (ts.isParameter(node)) addBinding(node.name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function validateStaticSiteDefinition(source: ts.SourceFile, path: string): WorkspaceSourcePolicyFinding[] {
  const findings: WorkspaceSourcePolicyFinding[] = [];
  const constInitializers = topLevelConstInitializers(source);
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === "siteDefinition");
  if (!declaration?.initializer) return findings;
  const definition = resolveStaticExpression(declaration.initializer, constInitializers);
  if (!ts.isObjectLiteralExpression(definition)) return findings;
  const routesProperty = objectProperty(definition, "routes");
  const routesInitializer = routesProperty && ts.isPropertyAssignment(routesProperty)
    ? routesProperty.initializer
    : routesProperty && ts.isShorthandPropertyAssignment(routesProperty)
      ? routesProperty.name
      : undefined;
  if (!routesInitializer) {
    findings.push({
      id: "source.site_routes_missing",
      path,
      message: "siteDefinition must define a routes array containing the homepage route at /."
    });
    return findings;
  }
  const routesValue = resolveStaticExpression(routesInitializer, constInitializers);
  if (!ts.isArrayLiteralExpression(routesValue)) return findings;
  const literalRoutes = routesValue.elements.flatMap((element) => {
    const route = resolveStaticExpression(element, constInitializers);
    return ts.isObjectLiteralExpression(route) ? [route] : [];
  });
  // This preflight is intentionally conservative: helper calls, spreads, and
  // mapped route families are valid authoring patterns whose final paths are
  // enforced by the compiler and artifact route contract. Do not reject a
  // dynamically composed route array merely because this shallow static pass
  // cannot prove that it contains the homepage.
  const routeArrayIsFullyStatic = literalRoutes.length === routesValue.elements.length;
  const routePaths = literalRoutes.flatMap((route) => {
    const property = objectProperty(route, "path");
    if (!property || !ts.isPropertyAssignment(property)) return [];
    const value = staticString(unwrapStaticExpression(property.initializer));
    return value === undefined ? [] : [value];
  });
  if (routeArrayIsFullyStatic && !routePaths.some((value) => value === "/" || value === "")) {
    findings.push({
      id: "source.homepage_route_missing",
      path,
      message: "siteDefinition.routes requires a homepage route with path '/'."
    });
  }
  const duplicatePaths = [...new Set(routePaths.filter((value, index) => routePaths.indexOf(value) !== index))];
  if (duplicatePaths.length) {
    findings.push({
      id: "source.route_duplicate",
      path,
      message: `siteDefinition.routes contains duplicate literal path(s): ${duplicatePaths.map((value) => JSON.stringify(value)).join(", ")}.`
    });
  }
  for (const route of literalRoutes) {
    const routePath = (() => {
      const property = objectProperty(route, "path");
      return property && ts.isPropertyAssignment(property)
        ? staticString(unwrapStaticExpression(property.initializer))
        : undefined;
    })();
    const element = objectProperty(route, "element");
    const component = objectProperty(route, "component");
    if (component && !element) {
      findings.push({
        id: "source.route_element",
        path,
        message: `Route ${JSON.stringify(routePath ?? "unknown")} uses component instead of element. Render JSX with element: <PageComponent />.`
      });
      continue;
    }
    if (!element || !ts.isPropertyAssignment(element)) continue;
    const value = unwrapStaticExpression(element.initializer);
    if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) {
      findings.push({
        id: "source.route_element",
        path,
        message: `Route ${JSON.stringify(routePath ?? "unknown")} passes a component reference instead of rendered JSX. Use element: <${value.getText(source)} />.`
      });
    }
  }
  return findings;
}

function topLevelConstInitializers(source: ts.SourceFile) {
  const initializers = new Map<string, ts.Expression>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        initializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return initializers;
}

function resolveStaticExpression(
  expression: ts.Expression,
  constInitializers: ReadonlyMap<string, ts.Expression>,
  resolving = new Set<string>()
): ts.Expression {
  const unwrapped = unwrapStaticExpression(expression);
  if (!ts.isIdentifier(unwrapped) || resolving.has(unwrapped.text)) return unwrapped;
  const initializer = constInitializers.get(unwrapped.text);
  if (!initializer) return unwrapped;
  const nextResolving = new Set(resolving);
  nextResolving.add(unwrapped.text);
  return resolveStaticExpression(initializer, constInitializers, nextResolving);
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string) {
  return object.properties.find((property) => property.name && staticPropertyName(property.name) === name);
}

function unwrapStaticExpression<T extends ts.Expression>(expression: T): ts.Expression {
  let current: ts.Expression = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isIntrinsicJsxTag(tag: ts.JsxTagNameExpression) {
  return ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
}

function isReactCreateElement(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "React"
    && node.expression.name.text === "createElement";
}

function isUndefinedIdentifier(node: ts.Expression) {
  return ts.isIdentifier(node) && node.text === "undefined";
}

function staticPropertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return staticString(node.expression);
  return undefined;
}

function isAllowedSourcePath(path: string) {
  return /^src\/[a-zA-Z0-9_.\/-]+\.(?:ts|tsx|css)$/.test(path)
    && !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

function allowedImport(fromPath: string, moduleId: string) {
  if (moduleId === "react") return true;
  if (moduleId === "#lodesta-sdk") return true;
  if (!moduleId.startsWith(".")) return false;
  const resolved = normalizePath(`${fromPath.slice(0, fromPath.lastIndexOf("/"))}/${moduleId}`);
  if (!resolved) return false;
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

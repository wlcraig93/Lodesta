export function deduplicateVerificationFindings<T>(findings: T[]) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const finding of findings) {
    const key = verificationFindingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(finding);
  }
  return output;
}

export function verificationBlockerFeedback<T>(findings: T[], maximum = 100) {
  const unique = deduplicateVerificationFindings(findings);
  const grouped = groupModelFacingRootCauses(unique);
  const blockers = grouped.slice(0, maximum);
  return {
    blockers,
    uniqueBlockerCount: grouped.length,
    returnedBlockerCount: blockers.length,
    blockersTruncated: grouped.length > blockers.length
  };
}

function groupModelFacingRootCauses<T>(findings: T[]) {
  const groups = new Map<string, { finding: T; routes: Set<string> }>();
  for (const finding of findings) {
    const record = finding && typeof finding === "object" && !Array.isArray(finding)
      ? finding as Record<string, unknown>
      : {};
    const key = [
      normalized(record.code ?? record.id ?? "unknown"),
      normalized(record.severity ?? "unknown"),
      normalized(record.area ?? "unknown"),
      normalizedRootMessage(record.message ?? finding)
    ].join("\u0000");
    const route = typeof record.route === "string" ? record.route : typeof record.path === "string" ? record.path : undefined;
    const prior = groups.get(key);
    if (prior) {
      if (route) prior.routes.add(route);
      continue;
    }
    groups.set(key, { finding, routes: new Set(route ? [route] : []) });
  }
  return [...groups.values()].map(({ finding, routes }) => {
    if (routes.size <= 1 || !finding || typeof finding !== "object" || Array.isArray(finding)) return finding;
    const record = finding as Record<string, unknown>;
    const affectedRoutes = [...routes].sort();
    return {
      ...record,
      route: affectedRoutes[0],
      affectedRoutes,
      message: `${String(record.message ?? "")} Affected routes: ${affectedRoutes.join(", ")}.`
    } as T;
  });
}

function verificationFindingKey(value: unknown) {
  const finding = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return [
    normalized(finding.code ?? finding.id ?? "unknown"),
    normalized(finding.severity ?? "unknown"),
    normalized(finding.area ?? "unknown"),
    normalized(finding.route ?? finding.path ?? "site"),
    normalized(finding.message ?? value)
  ].join("\u0000");
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedRootMessage(value: unknown) {
  return normalized(value)
    .replace(/\b(?:at|on)\s+(?:desktop|tablet|mobile)\b/g, "at viewport")
    .replace(/\baffectedroutes=\[[^\]]*\]/g, "affectedroutes=[]")
    .replace(/\bon\s+\/[a-z0-9_./-]*:/g, "on route:");
}

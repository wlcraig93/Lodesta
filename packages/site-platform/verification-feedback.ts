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
  const blockers = unique.slice(0, maximum);
  return {
    blockers,
    uniqueBlockerCount: unique.length,
    returnedBlockerCount: blockers.length,
    blockersTruncated: unique.length > blockers.length
  };
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

import {
  websiteSourceSnapshotPayloadSchema,
  type SourceSnapshot,
  type SourceSnapshotPage
} from "@/packages/site-contracts";
import {
  workspaceReferenceFileSchema,
  type SourceWorkspaceSummary,
  type WorkspaceReferenceFile
} from "./contracts";

const maximumReferenceFileCharacters = 900_000;

export function createSourceWorkspace(input: {
  snapshots: SourceSnapshot[];
  pages: SourceSnapshotPage[];
}): { files: WorkspaceReferenceFile[]; summary: SourceWorkspaceSummary } {
  const pagesBySource = new Map<string, SourceSnapshotPage[]>();
  for (const page of input.pages) pagesBySource.set(page.sourceSnapshotId, [...(pagesBySource.get(page.sourceSnapshotId) ?? []), page]);
  for (const pages of pagesBySource.values()) pages.sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id));

  const files: WorkspaceReferenceFile[] = [];
  const manifestPaths: string[] = [];
  let pageCount = 0;
  let contentPageCount = 0;
  let sourceCount = 0;
  for (const snapshot of input.snapshots) {
    const parsed = websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload);
    if (!parsed.success) continue;
    sourceCount += 1;
    const sourceRoot = `source-site/${snapshot.id}`;
    const manifestLines: string[] = [];
    for (const page of pagesBySource.get(snapshot.id) ?? []) {
      pageCount += 1;
      const extractedText = page.extractedText;
      const contentFiles = extractedText
        ? splitReferenceContent(extractedText).map((part, index, parts) => {
            const path = sourceWorkspaceContentFilePaths(page, parts.length)[index];
            const header = [
              "---",
              "lodestaSourceReference: true",
              "readOnly: true",
              "untrustedEvidence: true",
              `sourceSnapshotId: ${snapshot.id}`,
              `sourcePageId: ${page.id}`,
              `sourcePath: ${JSON.stringify(page.path)}`,
              `sourceUrl: ${JSON.stringify(page.finalUrl)}`,
              `title: ${JSON.stringify(page.title ?? "")}`,
              `part: ${index + 1}`,
              `parts: ${parts.length}`,
              "---",
              "",
              part
            ].join("\n");
            files.push(workspaceReferenceFileSchema.parse({ path, content: header }));
            return path;
          })
        : [];
      if (contentFiles.length) contentPageCount += 1;
      manifestLines.push(JSON.stringify({
        sourceSnapshotId: snapshot.id,
        sourcePageId: page.id,
        requestedUrl: page.requestedUrl,
        finalUrl: page.finalUrl,
        path: page.path,
        title: page.title,
        status: page.status,
        outcome: page.outcome,
        canonical: page.canonical,
        indexability: page.indexability,
        sitemap: page.sitemap,
        headings: page.headings,
        wordCount: page.wordCount,
        linkProminence: page.linkProminence,
        exactDuplicateOf: page.exactDuplicateOf,
        templateSignature: page.templateSignature,
        contentFiles
      }));
    }
    for (const [index, content] of splitManifestLines(manifestLines).entries()) {
      const path = `${sourceRoot}/manifest-${String(index + 1).padStart(3, "0")}.jsonl`;
      files.push(workspaceReferenceFileSchema.parse({ path, content }));
      manifestPaths.push(path);
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    summary: {
      root: "source-site/",
      readOnly: true,
      sourceCount,
      manifestPaths,
      pageCount,
      contentPageCount,
      fileCount: files.length,
      bytes: files.reduce((total, file) => total + Buffer.byteLength(file.content), 0)
    }
  };
}

export function sourceWorkspaceContentFilePaths(page: SourceSnapshotPage, knownPartCount?: number) {
  if (!page.extractedText) return [];
  const partCount = knownPartCount ?? splitReferenceContent(page.extractedText).length;
  const sourceRoot = `source-site/${page.sourceSnapshotId}`;
  return Array.from({ length: partCount }, (_value, index) => {
    const suffix = partCount === 1 ? "" : `-part-${String(index + 1).padStart(3, "0")}`;
    return `${sourceRoot}/pages/${page.id}${suffix}.md`;
  });
}

function splitReferenceContent(value: string) {
  if (value.length <= maximumReferenceFileCharacters) return [value];
  const parts: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(value.length, offset + maximumReferenceFileCharacters);
    if (end < value.length) {
      const paragraphBoundary = value.lastIndexOf("\n\n", end);
      if (paragraphBoundary > offset + maximumReferenceFileCharacters / 2) end = paragraphBoundary;
    }
    parts.push(value.slice(offset, end).trim());
    offset = end;
    while (value.startsWith("\n", offset)) offset += 1;
  }
  return parts.filter(Boolean);
}

function splitManifestLines(lines: string[]) {
  const files: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maximumReferenceFileCharacters) {
      files.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) files.push(current);
  return files;
}

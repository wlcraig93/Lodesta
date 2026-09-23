/*
 * LegalDocument: a readable page for a long privacy, terms, cookie, legal or
 * accessibility document. Preserve the source body completely and exactly;
 * this component only gives it structure and theme styling.
 *
 * Easiest path: keep the exact source text in its own file and pass it as
 * text. Each non-empty line becomes one block:
 *   ## Heading          h2 (### h3, #### h4)
 *   - item              bulleted list item (consecutive items form one list)
 *   | Col | Col |       table row; the first row is the column header, a
 *                       |---|---| separator row is optional, write \| for a
 *                       literal pipe inside a cell
 *   anything else       one paragraph, rendered exactly as written
 * Only add these markers where the source has headings, bullets or tables;
 * keep numbering such as "1." or "(a)" as text.
 *
 *   // src/legal/privacy.ts (escape ` as \` and ${ as \${ inside the text)
 *   export const privacyText = `## Information we collect
 *   We collect ...
 *   | Category | Examples |
 *   | Identifiers | Name, phone number |`;
 *
 *   <SiteShell ...><LegalDocument title="Privacy Policy" meta="Effective May 1, 2024" text={privacyText} /></SiteShell>
 *
 * For links or emphasis inside the document, write JSX children instead of
 * (or after) text, using ordinary h2/h3/p/ul markup and LegalTable for tables.
 * Styles: library/legal.css.
 */
import type { ReactNode } from "react";
import { PageHeader } from "./sections";

type LegalBlock =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export function LegalDocument({ title, meta, text, children }: {
  title: ReactNode;
  meta?: ReactNode;
  text?: string;
  children?: ReactNode;
}) {
  const blocks = text ? parseLegalText(text) : [];
  let headingId: string | undefined;
  return (
    <>
      <PageHeader title={title} lead={meta} />
      <div className="lib-section lib-tone-default">
        <div className="lib-container">
          <div className="lib-legal">
            {blocks.map((block, index) => {
              if (block.kind === "heading") {
                headingId = `legal-${index}`;
                const Heading = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
                return <Heading id={headingId} key={index}>{block.text}</Heading>;
              }
              if (block.kind === "list") return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
              if (block.kind === "table") return <LegalTable key={index} labelledBy={headingId} head={block.head} rows={block.rows} />;
              return <p key={index}>{block.text}</p>;
            })}
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

/*
 * A table with semantic column headers inside a keyboard-reachable horizontal
 * scroll region. Name the region with labelledBy (the id of the heading above
 * it) or label.
 */
export function LegalTable({ head, rows, label, labelledBy }: {
  head: ReactNode[];
  rows: ReactNode[][];
  label?: string;
  labelledBy?: string;
}) {
  return (
    <div
      className="lib-legal-table"
      role="region"
      tabIndex={0}
      {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": label ?? "Table" })}
    >
      <table>
        <thead>
          <tr>{head.map((cell, index) => <th scope="col" key={index}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function parseLegalText(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const last = blocks.at(-1);
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.max(2, heading[1]!.length) as 2 | 3 | 4;
      blocks.push({ kind: "heading", level, text: heading[2]! });
      continue;
    }
    const item = /^[-*•]\s+(.+)$/.exec(line);
    if (item) {
      if (last?.kind === "list") last.items.push(item[1]!);
      else blocks.push({ kind: "list", items: [item[1]!] });
      continue;
    }
    if (line.startsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      if (last?.kind === "table") last.rows.push(cells);
      else blocks.push({ kind: "table", head: cells, rows: [] });
      continue;
    }
    blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}

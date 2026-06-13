"use client";

import { useEffect, useRef, useState } from "react";

export function CopyIdTag({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copy(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const scratch = document.createElement("textarea");
      scratch.value = id;
      document.body.appendChild(scratch);
      scratch.select();
      document.execCommand("copy");
      scratch.remove();
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="copy-id-tag" onClick={copy} title={`Copy ${id}`} aria-label={`Copy generation ID ${id}`}>
      {copied ? (
        <>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="11" height="11">
            <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="11" height="11">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 3.5v-1A1.5 1.5 0 0 0 9 1H3.5A1.5 1.5 0 0 0 2 2.5V9a1.5 1.5 0 0 0 1.5 1.5h1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {shortId(id)}
        </>
      )}
    </button>
  );
}

function shortId(id: string) {
  return id.replace(/^sitecand_/, "").slice(0, 8);
}

"use client";

import { useState, type ReactNode } from "react";

export type QueueView = "review" | "generating" | "blocked" | "accepted" | "tests";

type QueueFilter = {
  view: QueueView;
  label: string;
  count: number;
};

/**
 * Client-side view switcher: all four views arrive pre-rendered from one
 * server fetch, so tab clicks swap content instantly instead of re-running
 * the full candidate query per click. The URL is kept shareable via
 * history.replaceState without triggering a server navigation.
 */
export function CandidateQueueViews({
  initialView,
  filters,
  views
}: {
  initialView: QueueView;
  filters: QueueFilter[];
  views: Record<QueueView, ReactNode>;
}) {
  const [view, setView] = useState<QueueView>(initialView);

  function select(next: QueueView, event: React.MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setView(next);
    window.history.replaceState(null, "", hrefFor(next));
  }

  return (
    <>
      <nav className="candidate-queue-filter" aria-label="Candidate queue filters">
        {filters.map((filter) => (
          <a
            key={filter.view}
            href={hrefFor(filter.view)}
            className={filter.view === view ? "is-active" : ""}
            aria-current={filter.view === view ? "page" : undefined}
            onClick={(event) => select(filter.view, event)}
          >
            {filter.label}
            <span>{filter.count}</span>
          </a>
        ))}
      </nav>
      {views[view]}
    </>
  );
}

function hrefFor(view: QueueView) {
  return view === "review" ? "/admin/site-candidates" : `/admin/site-candidates?view=${view}`;
}

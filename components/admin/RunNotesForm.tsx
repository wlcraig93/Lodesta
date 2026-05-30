"use client";

import { useState } from "react";

export function RunNotesForm({
  runId,
  initialNotes,
  initialTags
}: {
  runId: string;
  initialNotes?: string;
  initialTags: string[];
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [tags, setTags] = useState(initialTags.join(", "));
  const [status, setStatus] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving...");
    const response = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      })
    });
    setStatus(response.ok ? "Saved." : "Unable to save.");
  }

  return (
    <form className="editor-form run-notes-form" onSubmit={onSubmit}>
      <label>
        <span>Tags</span>
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="qa, retry, good-example" />
      </label>
      <label>
        <span>Notes</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal debugging notes" />
      </label>
      <button className="button secondary" type="submit">
        Save notes
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

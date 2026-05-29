"use client";

import { useState } from "react";

type SectionEditorFormProps = {
  siteId: string;
  pageId: string;
  sectionId: string;
  fields: Array<{
    key: string;
    label: string;
    value: string;
    multiline: boolean;
  }>;
};

export function SectionEditorForm({ siteId, pageId, sectionId, fields }: SectionEditorFormProps) {
  const [status, setStatus] = useState<string>("");
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.key, field.value])));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving draft...");
    const response = await fetch("/api/sites/update-section", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        pageId,
        sectionId,
        props: values
      })
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? result.reason ?? "Unable to save.");
      return;
    }
    window.dispatchEvent(new Event("lodesta:preview-refresh"));
    setStatus("Draft saved.");
  }

  return (
    <form className="editor-form" onSubmit={onSubmit}>
      {fields.map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          {field.multiline ? (
            <textarea
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          ) : (
            <input
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          )}
        </label>
      ))}
      <button className="button primary" type="submit">
        Save draft
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

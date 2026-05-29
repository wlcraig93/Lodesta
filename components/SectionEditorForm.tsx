"use client";

import { useState } from "react";

type SectionEditorFormProps = {
  siteId: string;
  pageId: string;
  sectionId: string;
  fields: EditableField[];
};

export type CtaValue = {
  label: string;
  href: string;
  role: string;
};

export type ObjectListValue = Array<Record<string, string>>;

export type EditableField =
  | {
      kind: "text";
      key: string;
      label: string;
      value: string;
      multiline: boolean;
    }
  | {
      kind: "cta";
      key: string;
      label: string;
      value: CtaValue;
      options: CtaValue[];
    }
  | {
      kind: "string_list";
      key: string;
      label: string;
      value: string[];
    }
  | {
      kind: "object_list";
      key: string;
      label: string;
      value: ObjectListValue;
      columns: string[];
    };

type GuardrailIssue = {
  severity: "block" | "warning";
  title: string;
  detail: string;
};

type SectionUpdateResponse = {
  ok?: boolean;
  error?: string;
  reason?: string;
  issues?: GuardrailIssue[];
  guardrailWarnings?: GuardrailIssue[];
};

export function SectionEditorForm({ siteId, pageId, sectionId, fields }: SectionEditorFormProps) {
  const [status, setStatus] = useState<string>("");
  const [issues, setIssues] = useState<GuardrailIssue[]>([]);
  const [values, setValues] = useState<Record<string, string | CtaValue | string[] | ObjectListValue>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.value]))
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving draft...");
    setIssues([]);
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

    const result = (await response.json()) as SectionUpdateResponse;
    if (!response.ok || !result.ok) {
      setIssues(result.issues ?? []);
      setStatus(result.error ?? result.reason ?? "Unable to save.");
      return;
    }
    window.dispatchEvent(new Event("lodesta:preview-refresh"));
    setIssues(result.guardrailWarnings ?? []);
    setStatus(result.guardrailWarnings?.length ? "Draft saved with guardrail warnings." : "Draft saved.");
  }

  return (
    <form className="editor-form" onSubmit={onSubmit}>
      {fields.map((field) => renderField(field, values[field.key], setValues))}
      <button className="button primary" type="submit">
        Save draft
      </button>
      {status ? <p className="form-status">{status}</p> : null}
      {issues.length ? (
        <ul className="guardrail-list" aria-label="Guardrail issues">
          {issues.map((issue, index) => (
            <li key={`${issue.title}-${index}`} className={`guardrail-${issue.severity}`}>
              <strong>{issue.title}</strong>
              <span>{issue.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

function renderField(
  field: EditableField,
  value: string | CtaValue | string[] | ObjectListValue | undefined,
  setValues: React.Dispatch<React.SetStateAction<Record<string, string | CtaValue | string[] | ObjectListValue>>>
) {
  if (field.kind === "cta") {
    return (
      <label key={field.key} className="cta-choice-field">
        <span>{field.label}</span>
        <select
          value={ctaOptionId(ctaValue(value) ?? field.value)}
          onChange={(event) => {
            const next = field.options.find((option) => ctaOptionId(option) === event.target.value);
            if (next) setValues((current) => ({ ...current, [field.key]: next }));
          }}
        >
          {field.options.map((option) => (
            <option key={ctaOptionId(option)} value={ctaOptionId(option)}>
              {option.label}
            </option>
          ))}
        </select>
        <small>{ctaValue(value)?.href ?? field.value.href}</small>
      </label>
    );
  }

  if (field.kind === "string_list") {
    const items = stringListValue(value);
    return (
      <fieldset key={field.key} className="structured-list-field">
        <legend>{field.label}</legend>
        <div className="form-field-list">
          {items.map((item, index) => (
            <div className="structured-list-row" key={`${field.key}-${index}`}>
              <input
                value={item}
                onChange={(event) => {
                  const next = [...items];
                  next[index] = event.target.value;
                  setValues((current) => ({ ...current, [field.key]: next }));
                }}
              />
              <button
                className="button secondary"
                type="button"
                onClick={() => setValues((current) => ({ ...current, [field.key]: items.filter((_, itemIndex) => itemIndex !== index) }))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button className="button secondary" type="button" onClick={() => setValues((current) => ({ ...current, [field.key]: [...items, ""] }))}>
          Add item
        </button>
      </fieldset>
    );
  }

  if (field.kind === "object_list") {
    const rows = objectListValue(value, field.columns);
    return (
      <fieldset key={field.key} className="structured-list-field">
        <legend>{field.label}</legend>
        <div className="form-field-list">
          {rows.map((row, index) => (
            <article className="structured-object-row" key={`${field.key}-${index}`}>
              {field.columns.map((column) => (
                <label key={column}>
                  <span>{humanizeField(column)}</span>
                  {multilineColumn(column, row[column]) ? (
                    <textarea
                      value={row[column] ?? ""}
                      onChange={(event) => updateObjectListValue(setValues, field.key, rows, index, column, event.target.value)}
                    />
                  ) : (
                    <input
                      value={row[column] ?? ""}
                      onChange={(event) => updateObjectListValue(setValues, field.key, rows, index, column, event.target.value)}
                    />
                  )}
                </label>
              ))}
              <button
                className="button secondary"
                type="button"
                onClick={() => setValues((current) => ({ ...current, [field.key]: rows.filter((_, rowIndex) => rowIndex !== index) }))}
              >
                Remove
              </button>
            </article>
          ))}
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            setValues((current) => ({
              ...current,
              [field.key]: [...rows, Object.fromEntries(field.columns.map((column) => [column, ""]))]
            }))
          }
        >
          Add item
        </button>
      </fieldset>
    );
  }

  return (
    <label key={field.key}>
      <span>{field.label}</span>
      {field.multiline ? (
        <textarea
          value={String(value ?? "")}
          onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
        />
      ) : (
        <input
          value={String(value ?? "")}
          onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
        />
      )}
    </label>
  );
}

function updateObjectListValue(
  setValues: React.Dispatch<React.SetStateAction<Record<string, string | CtaValue | string[] | ObjectListValue>>>,
  key: string,
  rows: ObjectListValue,
  rowIndex: number,
  column: string,
  value: string
) {
  const next = rows.map((row, index) => (index === rowIndex ? { ...row, [column]: value } : row));
  setValues((current) => ({ ...current, [key]: next }));
}

function ctaOptionId(cta: CtaValue) {
  return `${cta.role}|${cta.href}|${cta.label}`;
}

function ctaValue(value: unknown): CtaValue | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CtaValue>;
  if (!candidate.label || !candidate.href || !candidate.role) return undefined;
  return {
    label: String(candidate.label),
    href: String(candidate.href),
    role: String(candidate.role)
  };
}

function stringListValue(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

function objectListValue(value: unknown, columns: string[]): ObjectListValue {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => Object.fromEntries(columns.map((column) => [column, String(item[column] ?? "")])));
}

function multilineColumn(column: string, value: string | undefined) {
  return /body|description|answer|quote/i.test(column) || String(value ?? "").length > 90;
}

function humanizeField(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

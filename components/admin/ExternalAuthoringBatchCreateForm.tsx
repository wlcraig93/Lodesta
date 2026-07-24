"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminButton } from "@/components/admin/AdminButton";

export function ExternalAuthoringBatchCreateForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const websites = parseWebsites(String(form.get("websites") ?? ""));
      const response = await fetch("/api/admin/authoring-batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          name: String(form.get("name") ?? "").trim(),
          websites
        })
      });
      const payload = await response.json() as { batch?: { id: string }; error?: string };
      if (!response.ok || !payload.batch) throw new Error(payload.error ?? "Unable to create batch.");
      router.push(`/authoring-batches/${encodeURIComponent(payload.batch.id)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create batch.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="external-authoring-form" onSubmit={submit}>
      <label>
        <span>Batch name</span>
        <input name="name" required maxLength={160} placeholder="Chicago landscapers · July 23" />
      </label>
      <label>
        <span>Websites</span>
        <textarea
          name="websites"
          required
          rows={10}
          placeholder={"https://example.com\nBusiness name hint, https://example.org"}
        />
        <small>One website per line. An optional comma-separated name is retained only as an operator hint; crawled source facts remain canonical.</small>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="external-authoring-form-footer">
        <p>Maximum 500 unique websites. Creation never publishes a site or sends outreach.</p>
        <AdminButton type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create batch"}
        </AdminButton>
      </div>
    </form>
  );
}

function parseWebsites(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Add at least one website.");
  if (lines.length > 500) throw new Error("A batch can contain at most 500 websites.");
  return lines.map((line, index) => {
    const comma = line.lastIndexOf(",");
    const possibleUrl = comma >= 0 ? line.slice(comma + 1).trim() : line;
    const businessName = comma >= 0 ? line.slice(0, comma).trim() : undefined;
    try {
      return { url: new URL(possibleUrl).href, ...(businessName ? { businessName } : {}) };
    } catch {
      throw new Error(`Line ${index + 1} does not contain a valid URL.`);
    }
  });
}

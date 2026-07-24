"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { sanitizeDisplayName } from "@/lib/owner-identity";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function DisplayNameForm({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const displayName = sanitizeDisplayName(value);
    if (!displayName) {
      setError("Enter a name between 2 and 80 characters.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ data: { display_name: displayName } });
      if (updateError) throw updateError;
      setValue(displayName);
      setMessage("Display name updated.");
      router.refresh();
    } catch {
      setError("Your display name could not be updated. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="account-display-name-form" onSubmit={(event) => void save(event)}>
      <label htmlFor="account-display-name">Display name</label>
      <div>
        <input
          id="account-display-name"
          name="displayName"
          autoComplete="name"
          value={value}
          maxLength={80}
          onChange={(event) => setValue(event.target.value)}
        />
        <button className="button secondary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save name"}
        </button>
      </div>
      {message ? <p className="account-settings-success" role="status">{message}</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </form>
  );
}

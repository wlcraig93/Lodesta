"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthLoginFormProps = {
  configured: boolean;
};

export function AuthLoginForm({ configured }: AuthLoginFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(configured ? "" : "Supabase Auth is not configured for this environment.");

  function authRedirectUrl() {
    return `${window.location.origin}/auth/callback`;
  }

  async function onGoogleSignIn() {
    if (!configured) {
      setStatus("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable login.");
      return;
    }

    setStatus("Redirecting to Google...");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl()
      }
    });

    if (error) setStatus(error.message);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) {
      setStatus("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable login.");
      return;
    }

    setStatus("Sending login link...");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authRedirectUrl()
      }
    });

    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Check your email for a secure login link.");
  }

  return (
    <form className="editor-form" onSubmit={onSubmit}>
      <button className="button primary" type="button" onClick={onGoogleSignIn} disabled={!configured}>
        Continue with Google
      </button>
      <label>
        <span>Email</span>
        <input
          type="email"
          value={email}
          placeholder="owner@example.com"
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={!configured}
        />
      </label>
      <button className="button secondary" type="submit" disabled={!configured}>
        Send login link
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

"use client";

import { useState } from "react";
import { createSupabaseBrowserClient, type SupabaseBrowserConfig } from "@/lib/supabase/browser";

const authNextCookieName = "lodesta_auth_next";

type AuthLoginFormProps = {
  supabase: SupabaseBrowserConfig | null;
  nextPath: string;
};

export function AuthLoginForm({ supabase: supabaseConfig, nextPath }: AuthLoginFormProps) {
  const configured = Boolean(supabaseConfig?.url && supabaseConfig.anonKey);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(configured ? "" : "Login is unavailable because this app runtime is missing Supabase browser auth config.");

  function authRedirectUrl() {
    return new URL("/auth/callback", window.location.origin).toString();
  }

  function rememberNextPath() {
    document.cookie = `${authNextCookieName}=${encodeURIComponent(nextPath)}; Path=/auth; Max-Age=600; SameSite=Lax`;
  }

  async function onGoogleSignIn() {
    if (!supabaseConfig) {
      setStatus("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable login.");
      return;
    }

    rememberNextPath();
    const supabase = createSupabaseBrowserClient(supabaseConfig);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl(),
        queryParams: {
          prompt: "select_account"
        }
      }
    });

    if (error) setStatus(error.message);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabaseConfig) {
      setStatus("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable login.");
      return;
    }

    setStatus("Sending login link...");
    rememberNextPath();
    const supabase = createSupabaseBrowserClient(supabaseConfig);
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
    <form className="editor-form auth-login-form" onSubmit={onSubmit}>
      <button className="google-auth-button" type="button" onClick={onGoogleSignIn} disabled={!configured}>
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
          />
        </svg>
        Continue with Google
      </button>

      <div className="auth-divider" role="separator">
        <span>or continue with email</span>
      </div>

      <label className="auth-email-field" htmlFor="auth-email">
        <span>Email address</span>
        <input
          id="auth-email"
          name="email"
          type="email"
          value={email}
          placeholder="owner@example.com"
          autoComplete="username"
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={!configured}
        />
      </label>
      <button className="button primary auth-submit-button" type="submit" disabled={!configured}>
        Send login link
      </button>
      {status ? (
        <p className="form-status auth-form-status" role="status">
          {status}
        </p>
      ) : null}
    </form>
  );
}

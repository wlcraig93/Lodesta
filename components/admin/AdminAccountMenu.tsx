"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function AdminAccountMenu({
  label,
  email,
  tokenAccess,
  authConfigured
}: {
  label: string;
  email?: string;
  tokenAccess: boolean;
  authConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canSignOut = Boolean(authConfigured && email && !tokenAccess);
  const sessionLabel = tokenAccess ? "Token session" : authConfigured ? "Admin account" : "Local session";

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="admin-account-menu" ref={rootRef}>
      {open ? (
        <div className="admin-account-popover" role="menu">
          <div className="admin-account-popover-header">
            <span className="admin-account-avatar" aria-hidden="true">
              {initials(label)}
            </span>
            <div>
              <strong>{label}</strong>
              <span>{sessionLabel}</span>
            </div>
          </div>
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}>
            Settings
          </Link>
          {canSignOut ? (
            <form action="/auth/logout" method="post">
              <button type="submit" role="menuitem">
                Sign out
              </button>
            </form>
          ) : (
            <span className="admin-account-note">{tokenAccess ? "Authenticated by admin token." : "Local development access."}</span>
          )}
        </div>
      ) : null}
      <button
        className="admin-account-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="admin-account-avatar" aria-hidden="true">
          {initials(label)}
        </span>
        <span className="admin-account-copy">
          <strong>{label}</strong>
          <small>{sessionLabel}</small>
        </span>
      </button>
    </div>
  );
}

function initials(label: string) {
  const parts = label
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "LA";
}

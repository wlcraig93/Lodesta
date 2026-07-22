"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";

export type AccountActionSection = "account" | "context" | "session";
export type AccountActionIcon = "account" | "admin" | "workspace" | "sign-in" | "sign-out";

export type AccountAction =
  | { id: string; kind: "link"; label: string; href: string; section: AccountActionSection; icon: AccountActionIcon }
  | { id: string; kind: "form"; label: string; action: string; section: AccountActionSection; icon: AccountActionIcon }
  | { id: string; kind: "note"; label: string; section: AccountActionSection };

export function AccountMenu({
  label,
  sessionLabel,
  actions
}: {
  label: string;
  sessionLabel: string;
  actions: AccountAction[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        className="account-menu-trigger"
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-controls={popoverId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <AccountAvatar label={label} />
        <span className="account-menu-copy">
          <strong>{label}</strong>
          <small>{sessionLabel}</small>
        </span>
      </button>
      {open ? (
        <section className="account-menu-popover" id={popoverId} aria-label="Account options">
          <AccountIdentity label={label} sessionLabel={sessionLabel} />
          <AccountActionList actions={actions} onAction={() => setOpen(false)} />
        </section>
      ) : null}
    </div>
  );
}

export function AccountIdentity({ label, sessionLabel }: { label: string; sessionLabel: string }) {
  return (
    <div className="account-menu-identity">
      <AccountAvatar label={label} />
      <div>
        <strong>{label}</strong>
        <span>{sessionLabel}</span>
      </div>
    </div>
  );
}

export function AccountActionList({
  actions,
  onAction,
  className
}: {
  actions: AccountAction[];
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={["account-action-list", className].filter(Boolean).join(" ")}>
      {actions.map((action, index) => (
        <Fragment key={action.id}>
          {index > 0 && actions[index - 1]?.section !== action.section ? <div className="account-action-divider" /> : null}
          <AccountActionControl action={action} onAction={onAction} />
        </Fragment>
      ))}
    </div>
  );
}

function AccountActionControl({ action, onAction }: { action: AccountAction; onAction?: () => void }) {
  if (action.kind === "note") return <p className="account-menu-note">{action.label}</p>;

  const content = <><AccountActionIconView icon={action.icon} /><span>{action.label}</span></>;
  if (action.kind === "link") {
    return <Link className="account-action" href={action.href} onClick={onAction}>{content}</Link>;
  }
  return (
    <form action={action.action} method="post">
      <button className="account-action" type="submit" onClick={onAction}>{content}</button>
    </form>
  );
}

function AccountAvatar({ label }: { label: string }) {
  return <span className="account-menu-avatar" aria-hidden="true">{initials(label)}</span>;
}

function AccountActionIconView({ icon }: { icon: AccountActionIcon }) {
  if (icon === "admin") return <Icon><path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></Icon>;
  if (icon === "workspace") return <Icon><path d="m4 10 8-6 8 6v9H8v-6h8v6" /></Icon>;
  if (icon === "sign-in") return <Icon><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" /></Icon>;
  if (icon === "sign-out") return <Icon><path d="M14 5h5v14h-5M10 8l-4 4 4 4m-4-4h9" /></Icon>;
  return <Icon><circle cx="12" cy="8" r="3" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></Icon>;
}

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
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

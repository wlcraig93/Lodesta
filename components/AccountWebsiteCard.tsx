"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { RemoveWebsiteButton } from "@/components/RemoveWebsiteButton";
import { ProductStatusBadge } from "@/components/ProductUI";
import type { OwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";

export function AccountWebsiteCard({
  name,
  hostname,
  recentLabel,
  href,
  thumbnailUrl,
  lifecycle,
  targetId,
  targetKind,
  removable
}: {
  name: string;
  hostname?: string;
  recentLabel: string;
  href: string;
  thumbnailUrl?: string;
  lifecycle: OwnerSiteLifecycle;
  targetId?: string;
  targetKind: "site" | "setup";
  removable: boolean;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (rootRef.current?.querySelector('[role="dialog"]')) return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <article className="account-website-card product-card" data-state={lifecycle.state}>
      <div className="account-website-card-preview">
        {thumbnailUrl && !imageFailed
          ? <img src={thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
          : <div className="account-website-card-placeholder" aria-hidden="true"><span>{initials(name)}</span><i /><i /></div>}
        {removable && targetId ? (
          <div className="account-website-card-menu" ref={rootRef}>
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-controls={menuId}
              aria-expanded={menuOpen}
              aria-label={`More options for ${name}`}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <span aria-hidden="true">•••</span>
            </button>
            {menuOpen ? (
              <div id={menuId} role="menu">
                <RemoveWebsiteButton
                  targetId={targetId}
                  targetKind={targetKind}
                  websiteName={name}
                  appearance="menu-item"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Link className="account-website-card-link" href={href} aria-label={`Open ${name}`} />
      <div className="account-website-card-body">
        <div className="account-website-card-heading">
          <div>
            {hostname ? <span className="account-website-card-domain">{hostname}</span> : null}
            <h2>{name}</h2>
          </div>
          <ProductStatusBadge tone={lifecycle.tone}>{lifecycle.label}</ProductStatusBadge>
        </div>
        <p>{lifecycle.detail}</p>
        <div className="account-website-card-meta">
          <span>{recentLabel}</span>
          <strong>Open website <span aria-hidden="true">→</span></strong>
        </div>
      </div>
    </article>
  );
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WS";
}

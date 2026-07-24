"use client";

import { useId, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export function RemoveWebsiteButton({
  targetId,
  targetKind,
  websiteName,
  appearance = "button"
}: {
  targetId: string;
  targetKind: "site" | "setup";
  websiteName: string;
  appearance?: "button" | "menu-item";
}) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const dialogId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deletingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  deletingRef.current = deleting;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deletingRef.current) {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.getElementById(dialogId);
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dialogId, open]);

  function close() {
    if (deleting) return;
    setOpen(false);
    setError("");
    triggerRef.current?.focus();
  }

  async function removeWebsite() {
    setDeleting(true);
    setError("");
    try {
      const response = targetKind === "site"
        ? await fetch(`/api/sites/${encodeURIComponent(targetId)}`, { method: "DELETE" })
        : await fetch(`/api/website-setups/${encodeURIComponent(targetId)}/cancel`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "This website could not be deleted. Try again.");
        setDeleting(false);
        return;
      }
      router.refresh();
    } catch {
      setError("This website could not be deleted. Check your connection and try again.");
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={appearance === "menu-item" ? "account-website-card-remove" : "button danger-secondary"}
        type="button"
        role={appearance === "menu-item" ? "menuitem" : undefined}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-label={`Delete ${websiteName}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {appearance === "menu-item" ? "Remove website" : "Delete"}
      </button>
      {open ? (
        <div
          className="site-delete-dialog"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <span className="site-delete-dialog-mark" aria-hidden="true">!</span>
            <div>
              <h2 id={titleId}>Delete {websiteName}?</h2>
              <p id={descriptionId}>
                {targetKind === "site"
                  ? "This removes the website from your account and takes any published pages offline. Past versions and audit records are retained, and you won’t be able to undo this from your account."
                  : "This removes the unfinished website setup from your account. It won’t be published, and you won’t be able to resume this setup."}
              </p>
            </div>
            {error ? <p className="site-delete-dialog-error" role="alert">{error}</p> : null}
            <div className="site-delete-dialog-actions">
              <button ref={cancelRef} className="button secondary" type="button" disabled={deleting} onClick={close}>
                Cancel
              </button>
              <button
                className="button danger"
                type="button"
                disabled={deleting}
                aria-busy={deleting}
                onClick={() => void removeWebsite()}
              >
                {deleting ? "Deleting…" : "Delete website"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

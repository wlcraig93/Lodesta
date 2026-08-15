"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ProductDialog";

export function RemoveWebsiteButton({
  targetId,
  websiteName,
  appearance = "button",
  onDialogOpenChange
}: {
  targetId: string;
  websiteName: string;
  appearance?: "button" | "menu-item";
  onDialogOpenChange?(open: boolean): void;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  function close() {
    if (deleting) return;
    setOpen(false);
    setError("");
    onDialogOpenChange?.(false);
  }

  function showDialog() {
    setError("");
    setOpen(true);
    onDialogOpenChange?.(true);
  }

  async function removeWebsite() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(targetId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "This website could not be deleted. Try again.");
        setDeleting(false);
        return;
      }
      setOpen(false);
      onDialogOpenChange?.(false);
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
        aria-label={`Delete ${websiteName}`}
        onClick={showDialog}
      >
        {appearance === "menu-item" ? "Remove website" : "Delete"}
      </button>
      <ConfirmDialog
        open={open}
        title={`Delete ${websiteName}?`}
        description="This removes the website from your account and takes any published pages offline. Past versions and audit records are retained, and you won’t be able to undo this from your account."
        confirmLabel="Delete website"
        confirmPendingLabel="Deleting…"
        tone="danger"
        pending={deleting}
        error={error}
        returnFocusRef={triggerRef}
        onConfirm={() => void removeWebsite()}
        onClose={close}
      />
    </>
  );
}

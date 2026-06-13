"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import { AdminGenerateForm } from "@/components/admin/AdminGenerateForm";

export function SiteCandidateCreateDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <AdminButton variant="primary" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        New candidate
      </AdminButton>
      {open ? (
        <div className="candidate-create-dialog-layer">
          <button
            className="candidate-create-dialog-backdrop"
            type="button"
            aria-label="Close new candidate panel"
            onClick={() => setOpen(false)}
          />
          <section
            ref={dialogRef}
            className="candidate-create-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
          >
            <div className="candidate-create-drawer-header">
              <AdminButton variant="ghost" type="button" onClick={() => setOpen(false)}>
                Close
              </AdminButton>
              <div>
                <span className="badge">Site Candidates</span>
                <h2 id={titleId}>New candidate</h2>
                <p id={descriptionId}>Queue a source crawl and generated site snapshot for review.</p>
              </div>
            </div>
            <AdminGenerateForm
              onJobCreated={() => {
                setOpen(false);
                router.refresh();
              }}
            />
          </section>
        </div>
      ) : null}
    </>
  );
}

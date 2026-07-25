"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";

export type ProductDialogSize = "sm" | "md";
export type ProductDialogTone = "neutral" | "danger";

export function ProductDialog({
  open,
  title,
  description,
  children,
  footer,
  size = "sm",
  tone = "neutral",
  busy = false,
  dismissible = true,
  className,
  initialFocusRef,
  returnFocusRef,
  onClose
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ProductDialogSize;
  tone?: ProductDialogTone;
  busy?: boolean;
  dismissible?: boolean;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const busyRef = useRef(busy);
  const initialFocusTargetRef = useRef(initialFocusRef);
  const returnFocusTargetRef = useRef(returnFocusRef);
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);

  closeRef.current = onClose;
  dismissibleRef.current = dismissible;
  busyRef.current = busy;
  initialFocusTargetRef.current = initialFocusRef;
  returnFocusTargetRef.current = returnFocusRef;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousFocusRef.current = returnFocusTargetRef.current?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (!dialog.open) dialog.showModal();
    initialFocusTargetRef.current?.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      const focusTarget = returnFocusTargetRef.current?.current ?? previousFocusRef.current;
      window.requestAnimationFrame(() => {
        if (focusTarget?.isConnected) focusTarget.focus();
      });
    };
  }, [mounted, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (dismissibleRef.current && !busyRef.current) closeRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!mounted || !open) return null;

  function requestClose() {
    if (!dismissible || busy) return;
    onClose();
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="product-dialog"
      data-busy={busy ? "true" : undefined}
      data-size={size}
      data-tone={tone}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className={["product-dialog-surface", className].filter(Boolean).join(" ")}>
        <div className="product-dialog-header">
          {tone === "danger" ? <span className="product-dialog-mark" aria-hidden="true">!</span> : null}
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
        </div>
        {children ? <div className="product-dialog-body">{children}</div> : null}
        {footer ? <div className="product-dialog-actions">{footer}</div> : null}
      </div>
    </dialog>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmPendingLabel,
  cancelLabel = "Cancel",
  tone = "neutral",
  pending = false,
  error,
  returnFocusRef,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  confirmPendingLabel?: string;
  cancelLabel?: string;
  tone?: ProductDialogTone;
  pending?: boolean;
  error?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onConfirm(): void;
  onClose(): void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <ProductDialog
      open={open}
      title={title}
      description={description}
      tone={tone}
      busy={pending}
      dismissible={!pending}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      footer={
        <>
          <button ref={cancelRef} className="button secondary" type="button" disabled={pending} onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`button ${tone === "danger" ? "danger" : "primary"}`}
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? confirmPendingLabel ?? `${confirmLabel}…` : confirmLabel}
          </button>
        </>
      }
    >
      {error ? <p className="product-dialog-error" role="alert">{error}</p> : null}
    </ProductDialog>
  );
}

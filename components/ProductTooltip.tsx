"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from "react";

const SHOW_DELAY_MS = 400;
const OFFSET = 8;
const EDGE_PADDING = 8;

type Placement = "top" | "bottom";

/**
 * Hover/focus tooltip for controls whose only visible content is an icon.
 *
 * Returns props to spread onto the trigger rather than wrapping it, so the
 * DOM shape (and any descendant CSS selectors) stay unchanged.
 *
 * The tooltip is portalled and fixed-positioned so it escapes `overflow`
 * ancestors, flips when it would clip the top of the viewport, and is clamped
 * horizontally. Touch pointers are ignored — there is no hover on touch, and
 * the trigger's own accessible name already covers assistive tech.
 */
export function useProductTooltip(label: string, { disabled = false }: { disabled?: boolean } = {}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("top");
  const [coords, setCoords] = useState<{ left: number; top: number }>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => window.clearTimeout(timerRef.current);
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
  }, []);

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const fitsAbove = rect.top > 44 + OFFSET;
    const next: Placement = fitsAbove ? "top" : "bottom";
    setPlacement(next);
    setCoords({
      left: Math.min(
        Math.max(rect.left + rect.width / 2, EDGE_PADDING),
        window.innerWidth - EDGE_PADDING
      ),
      top: next === "top" ? rect.top - OFFSET : rect.bottom + OFFSET
    });
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      if (disabled) return;
      window.clearTimeout(timerRef.current);
      const reveal = () => {
        position();
        setOpen(true);
      };
      if (immediate) reveal();
      else timerRef.current = window.setTimeout(reveal, SHOW_DELAY_MS);
    },
    [disabled, position]
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [hide, open]);

  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  const triggerProps = {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    "aria-describedby": open ? tooltipId : undefined,
    onPointerEnter: (event: { pointerType: string }) => {
      if (event.pointerType === "touch") return;
      show(false);
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: () => show(true),
    onBlur: hide
  };

  const tooltip: ReactNode =
    mounted && open && coords
      ? createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="product-tooltip"
            data-placement={placement}
            style={{ left: `${coords.left}px`, top: `${coords.top}px` }}
          >
            {label}
          </div>,
          document.body
        )
      : null;

  return { triggerProps, tooltip };
}

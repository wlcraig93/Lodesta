import type { ReactNode, SelectHTMLAttributes } from "react";

export type ProductStatusTone = "neutral" | "attention" | "success" | "danger" | "info";

export function ProductSelect({
  compact,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return <select className={`product-select${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`} {...props} />;
}

export function ProductStatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: ProductStatusTone }) {
  return <strong className={`product-status is-${tone}`} data-tone={tone}>{children}</strong>;
}

export function ProductSegmentedControl({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`product-segmented-control${className ? ` ${className}` : ""}`} role="group" aria-label={label}>{children}</div>;
}

export function ProductEmptyState({
  title,
  detail,
  children,
  className
}: {
  title: string;
  detail: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`product-empty-state${className ? ` ${className}` : ""}`}>
      <strong>{title}</strong>
      <span>{detail}</span>
      {children}
    </div>
  );
}

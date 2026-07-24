import type { ReactNode } from "react";
import { ProductStatusBadge, type ProductStatusTone } from "@/components/ProductUI";

export function WorkspacePageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="workspace-page-header">
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {actions ? <div className="workspace-page-actions">{actions}</div> : null}
    </header>
  );
}

export function WorkspaceMetric({ label, value, detail, tone = "default" }: { label: string; value: ReactNode; detail?: string; tone?: "default" | "positive" | "attention" }) {
  return <article className={`workspace-metric is-${tone}`}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

export function WorkspaceStatus({ children, tone = "neutral" }: { children: ReactNode; tone?: ProductStatusTone }) {
  return <ProductStatusBadge tone={tone}>{children}</ProductStatusBadge>;
}

import type { ReactNode } from "react";
import { OwnerShell } from "@/components/OwnerShell";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}

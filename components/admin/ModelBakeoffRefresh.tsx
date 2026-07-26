"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { AdminButton } from "./AdminButton";

export function ModelBakeoffRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [active, router]);

  return (
    <AdminButton
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
    >
      {pending ? "Refreshing…" : "Refresh"}
    </AdminButton>
  );
}

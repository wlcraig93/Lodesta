"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function QueueAutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}

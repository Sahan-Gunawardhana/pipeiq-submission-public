"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import AppShell from "@/components/layout/AppShell";

export default function RouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/retraining" || pathname === "/feedback") {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshQuiet } from "@/client/refreshQuiet";

export default function DashboardRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      refreshQuiet(router);
    }, 60_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

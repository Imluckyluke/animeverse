"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { installScrollRestoration } from "@/lib/navigation-scroll";

export function NavigationScroll() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const controller = useRef<ReturnType<typeof installScrollRestoration> | null>(null);
  useEffect(() => {
    controller.current = installScrollRestoration(window);
    return () => { controller.current?.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { controller.current?.commit(`${pathname}?${search}`); }, [pathname, search]);
  return null;
}

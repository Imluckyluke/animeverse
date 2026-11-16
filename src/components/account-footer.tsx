"use client";
import type { ComponentProps } from "react";
import HalftoneWordmarkFooter from "@/components/ui/halftone-wordmark-footer";
import { useApp } from "@/lib/app-context";

export function AccountFooter(props: ComponentProps<typeof HalftoneWordmarkFooter>) {
  const { user } = useApp();
  const columns = props.columns?.map(column => ({ ...column,
    title: !user && column.title === "کتابخانه" ? "حساب" : column.title,
    links: column.links.filter(link => user || link.href !== "/favorites"),
  }));
  return <HalftoneWordmarkFooter {...props} columns={columns} />;
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = { title: "ورود به حساب", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function AccessLayout({ children }: { children: ReactNode }) { return children; }

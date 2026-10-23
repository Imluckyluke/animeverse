import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "آرشیو",
  robots: { index: false, follow: true },
};

export default function JoinPage() {
  redirect("/browse");
}

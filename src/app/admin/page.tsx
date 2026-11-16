import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/admin-console";
import { notFound } from "next/navigation";
import { ownerAccountSession } from "@/lib/admin-server";

export const metadata: Metadata = {
  title: "پنل ادمین",
  description: "کنسول امن مدیریت آرشیو، محتوا و انتشار انیمه‌ورس.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  if (!await ownerAccountSession()) notFound();
  return <AdminConsole />;
}

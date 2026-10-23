import type { Metadata } from "next";
import { AdminView } from "@/components/admin-view";

export const metadata: Metadata = {
  title: "پنل ادمین",
  description: "پنل مدیریت محلی انیمه‌ورس.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminView />;
}

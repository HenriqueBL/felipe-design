import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";

export const metadata: Metadata = {
  title: "Dashboard | Felipe Design",
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-side">
        <Link href={"/" + current + "/dashboard"} className="brand">
          Felipe Design
        </Link>
        <Link href={"/" + current + "/dashboard"}>{dictionary.dashboard.overview}</Link>
        <Link href={"/" + current + "/dashboard/orders"}>{dictionary.dashboard.orders}</Link>
        <Link href={"/" + current + "/dashboard/plans"}>{dictionary.dashboard.plans}</Link>
        <Link href={"/" + current + "/dashboard/settings"}>{dictionary.dashboard.settings}</Link>
        <Link href={"/" + current}>{dictionary.dashboard.backToSite}</Link>
      </aside>
      <main className="dashboard-main">{children}</main>
    </div>
  );
}

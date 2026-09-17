import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { isSafeNextPath } from "@/domain/checkout";
import LoginForm from "@/components/login-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  return {
    title: dictionary.nav.login + " | Felipe Design",
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const { next: nextParam } = await searchParams;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const next = typeof nextParam === "string" && isSafeNextPath(nextParam) ? nextParam : undefined;

  return (
    <main>
      <div className="auth-card">
        <h1>{dictionary.login.title}</h1>
        <p>{dictionary.login.description}</p>
        <LoginForm locale={current} labels={dictionary.login} next={next} />
      </div>
    </main>
  );
}

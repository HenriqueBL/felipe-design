import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import LoginForm from "@/components/login-form";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);

  return (
    <main>
      <div className="auth-card">
        <h1>{dictionary.login.title}</h1>
        <p>{dictionary.login.description}</p>
        <LoginForm locale={current} labels={dictionary.login} />
      </div>
    </main>
  );
}

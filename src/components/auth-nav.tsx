"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { signOutAction } from "@/app/[locale]/actions";
import type { Locale } from "@/lib/i18n/config";

interface AuthNavLabels {
  login: string;
  logout: string;
}

export default function AuthNav({
  locale,
  labels,
}: {
  locale: Locale;
  labels: AuthNavLabels;
}) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setSignedIn(data.user !== null))
      .catch(() => setSignedIn(false));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(session?.user !== null);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!signedIn) {
    return (
      <a href={`/${locale}/login`} className="auth-link">
        {labels.login}
      </a>
    );
  }

  return (
    <form action={signOutAction} className="inline">
      <input type="hidden" name="locale" value={locale} />
      <button type="submit" className="linklike">
        {labels.logout}
      </button>
    </form>
  );
}
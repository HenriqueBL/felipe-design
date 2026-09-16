"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Locale } from "@/lib/i18n/config";

interface LoginLabels {
  emailLabel: string;
  emailPlaceholder: string;
  submit: string;
  success: string;
  error: string;
  rateLimited: string;
}

interface LoginFormProps {
  locale: Locale;
  labels: LoginLabels;
  next?: string;
}

export default function LoginForm({ locale, labels, next }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error" | "rate-limited"
  >("idle");
  const supabase = createSupabaseBrowserClient();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");

    const redirectTo = next
      ? `/auth/callback?next=${encodeURIComponent(next)}`
      : `/auth/callback?next=/${locale}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${redirectTo}`,
      },
    });

    if (error) {
      // Rate limit do Supabase Auth: mensagem especifica, sem expor erro interno.
      const isRateLimited =
        error.status === 429 ||
        (error.code ?? "").toLowerCase() === "over_email_send_rate_limit";
      setStatus(isRateLimited ? "rate-limited" : "error");
      return;
    }
    setStatus("sent");
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="email">{labels.emailLabel}</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          placeholder={labels.emailPlaceholder}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={status === "sending"}>
        {labels.submit}
      </button>
      {status === "sent" && <p className="form-status ok">{labels.success}</p>}
      {status === "error" && <p className="form-status err">{labels.error}</p>}
      {status === "rate-limited" && (
        <p className="form-status err">{labels.rateLimited}</p>
      )}
    </form>
  );
}

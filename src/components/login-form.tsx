"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { siteUrl } from "@/lib/site";
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending" || status === "sent") return;

    setStatus("sending");
    const supabase = createSupabaseBrowserClient();

    // Build callback URL with locale-aware redirect target.
    // The `next` param is preserved through the magic link flow so users
    // land on their intended destination after authentication.
    const callbackUrl = new URL("/auth/callback", siteUrl());
    if (next) {
      callbackUrl.searchParams.set("next", next);
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    });

    if (error) {
      // Supabase returns 429 / "over_email_send_rate_limit" for rate-limited requests.
      // Map to a user-friendly message without exposing backend details.
      const msg = error.message ?? "";
      if (
        error.status === 429 ||
        msg.includes("rate limit") ||
        msg.includes("over_email_send_rate_limit")
      ) {
        setStatus("rate-limited");
      } else {
        setStatus("error");
      }
      return;
    }

    setStatus("sent");
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <label htmlFor="login-email">{labels.emailLabel}</label>
      <input
        id="login-email"
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder={labels.emailPlaceholder}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === "sending" || status === "sent"}
      />
      <button
        type="submit"
        disabled={!email || status === "sending" || status === "sent"}
      >
        {status === "sending" ? "…" : labels.submit}
      </button>

      {status === "sent" && (
        <p className="form-status ok">{labels.success}</p>
      )}
      {status === "error" && <p className="form-status err">{labels.error}</p>}
      {status === "rate-limited" && (
        <p className="form-status err">{labels.rateLimited}</p>
      )}
    </form>
  );
}
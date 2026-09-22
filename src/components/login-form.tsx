"use client";

import { useState, type FormEvent } from "react";
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending" || status === "sent") return;

    setStatus("sending");
    const supabase = createSupabaseBrowserClient();

    // Always include a locale-aware destination so direct /pt/login without
    // ?next= still lands on /pt after authentication (not the /en fallback).
    const destination = next ?? `/${locale}`;
    const callbackUrl = new URL("/auth/callback", siteUrl());
    callbackUrl.searchParams.set("next", destination);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    });

    if (error) {
      const msg = error.message ?? "";
      const isRateLimited =
        error.status === 429 ||
        msg.includes("rate limit") ||
        msg.includes("over_email_send_rate_limit");
      setStatus(isRateLimited ? "rate-limited" : "error");
      return;
    }

    setStatus("sent");
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <div className="form-group">
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
      </div>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={!email || status === "sending" || status === "sent"}
      >
        {status === "sending" ? "…" : labels.submit}
      </button>

      {status === "sent" && (
        <p className="form-status ok">{labels.success}</p>
      )}
      {status === "error" && (
        <p className="form-status err">{labels.error}</p>
      )}
      {status === "rate-limited" && (
        <p className="form-status err">{labels.rateLimited}</p>
      )}
    </form>
  );
}
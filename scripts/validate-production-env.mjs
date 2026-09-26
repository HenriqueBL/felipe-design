#!/usr/bin/env node
// Fail-fast de env de producao. Mensagens de erro contém somente o NOME
// da variável, nunca o valor. Sai com exit 1 se algo estiver inválido.
// Usado como ENTRYPOINT do container e no deploy script.

import { pathToFileURL } from "node:url";

export function validateProductionEnv(env) {
  const errors = [];
  const isProduction = env.NODE_ENV === "production";

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL",
  ];

  for (const name of required) {
    const value = env[name];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`Missing required environment variable: ${name}`);
    }
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl && !/^https:\/\/[\w.-]+\.supabase\.co\/?$/.test(supabaseUrl.trim())) {
    errors.push("Invalid format for NEXT_PUBLIC_SUPABASE_URL (expected https://<project>.supabase.co)");
  }

  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl && !/^https?:\/\/[\w:.-]+\/?$/.test(siteUrl.trim())) {
    errors.push("Invalid format for NEXT_PUBLIC_SITE_URL (expected http(s)://...)");
  }

  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey && !isSupabasePublicKey(anonKey)) {
    errors.push("Invalid format for NEXT_PUBLIC_SUPABASE_ANON_KEY (expected a Supabase JWT or sb_publishable_ key)");
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && !isSupabaseServerKey(serviceKey)) {
    errors.push("Invalid format for SUPABASE_SERVICE_ROLE_KEY (expected a Supabase JWT or sb_secret_ key)");
  }

  if (isProduction && env.ENABLE_MOCK_PAYMENTS === "true") {
    errors.push("ENABLE_MOCK_PAYMENTS must NOT be true in production");
  }

  // TRUSTED_GEO_SOURCE is optional (geo disabled = safe en/USD fallback).
  // When set in production, ONLY "x-origin-country" is accepted — this is
  // the internal header written by nginx after validating upstream geo data.
  // Public-facing headers like cf-ipcountry or x-vercel-ip-country must
  // NEVER be trusted directly, as internet clients can forge them.
  if (isProduction) {
    const geoSource = env.TRUSTED_GEO_SOURCE;
    if (typeof geoSource === "string" && geoSource.trim() !== "" && geoSource.trim() !== "x-origin-country") {
      errors.push("Invalid value for TRUSTED_GEO_SOURCE (only 'x-origin-country' is accepted in production; unset to disable geo)");
    }
  }

  return errors;
}

export function isLegacySupabaseJwt(value) {
  if (typeof value !== "string") return false;
  const key = value.trim();
  if (key !== value || /\s/.test(key)) return false;
  const segments = key.split(".");
  if (segments.length !== 3) return false;
  const base64url = /^[A-Za-z0-9_-]+$/;
  return segments.every((s) => s.length > 0 && base64url.test(s));
}

export function isSupabasePublicKey(value) {
  if (typeof value !== "string") return false;
  const key = value.trim();
  if (isLegacySupabaseJwt(key)) return true;
  return /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
}

export function isSupabaseServerKey(value) {
  if (typeof value !== "string") return false;
  const key = value.trim();
  if (isLegacySupabaseJwt(key)) return true;
  return /^sb_secret_[A-Za-z0-9_-]+$/.test(key);
}

// Stripe credentials NAO sao mais exigidas no startup: sao configuradas
// pelo Admin (Settings > Stripe Payments) e armazenadas server-side no
// Supabase Vault. Sem configuracao, o app inicia normalmente e pagamentos
// falham de forma segura (CONFIGURATION / PAYMENT_UNAVAILABLE).

const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const errors = validateProductionEnv(process.env);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[env] ${e}`);
    console.error(`[env] ${errors.length} environment validation error(s). Refusing to start.`);
    process.exit(1);
  }
  console.log("[env] production environment validation passed.");
}
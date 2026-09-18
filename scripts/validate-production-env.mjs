#!/usr/bin/env node
// Fail-fast de env de producao. Mensagens de erro contém somente o NOME
// da variável, nunca o valor. Sai com exit 1 se algo estiver inválido.
// Usado como ENTRYPOINT do container e no deploy script.

const isProduction = process.env.NODE_ENV === "production";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
];

if (isProduction) {
  // Hosted Checkout server-side: os dois secrets Stripe sao obrigatorios
  // em producao (publishable key nao e necessaria — sem Stripe.js no browser).
  required.push("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET");
}

const errors = [];

for (const name of required) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`Missing required environment variable: ${name}`);
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl && !/^https:\/\/[\w.-]+\.supabase\.co\/?$/.test(supabaseUrl.trim())) {
  errors.push("Invalid format for NEXT_PUBLIC_SUPABASE_URL (expected https://<project>.supabase.co)");
}

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (siteUrl && !/^https?:\/\/[\w:.-]+\/?$/.test(siteUrl.trim())) {
  errors.push("Invalid format for NEXT_PUBLIC_SITE_URL (expected http(s)://...)");
}

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (anonKey && !/^[A-Za-z0-9_-]{100,}$/.test(anonKey.trim())) {
  errors.push("Invalid format for NEXT_PUBLIC_SUPABASE_ANON_KEY (expected a Supabase JWT)");
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (serviceKey && !/^[A-Za-z0-9_-]{100,}$/.test(serviceKey.trim())) {
  errors.push("Invalid format for SUPABASE_SERVICE_ROLE_KEY (expected a Supabase JWT)");
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (stripeSecretKey && !/^sk_(test|live)_/.test(stripeSecretKey.trim())) {
  errors.push("Invalid format for STRIPE_SECRET_KEY (expected sk_test_... or sk_live_...)");
}

const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (stripeWebhookSecret && !/^whsec_/.test(stripeWebhookSecret.trim())) {
  errors.push("Invalid format for STRIPE_WEBHOOK_SECRET (expected whsec_...)");
}

if (isProduction && process.env.ENABLE_MOCK_PAYMENTS === "true") {
  errors.push("ENABLE_MOCK_PAYMENTS must NOT be true in production");
}

if (errors.length > 0) {
  for (const e of errors) console.error(`[env] ${e}`);
  console.error(`[env] ${errors.length} environment validation error(s). Refusing to start.`);
  process.exit(1);
}

console.log("[env] production environment validation passed.");
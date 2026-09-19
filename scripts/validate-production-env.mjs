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

// Stripe credentials NAO sao mais exigidas no startup: sao configuradas
// pelo Admin (Settings > Stripe Payments) e armazenadas server-side no
// Supabase Vault. Sem configuracao, o app inicia normalmente e pagamentos
// falham de forma segura (CONFIGURATION / PAYMENT_UNAVAILABLE).

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

if (isProduction && process.env.ENABLE_MOCK_PAYMENTS === "true") {
  errors.push("ENABLE_MOCK_PAYMENTS must NOT be true in production");
}

if (errors.length > 0) {
  for (const e of errors) console.error(`[env] ${e}`);
  console.error(`[env] ${errors.length} environment validation error(s). Refusing to start.`);
  process.exit(1);
}

console.log("[env] production environment validation passed.");
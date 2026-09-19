import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// =============================================================================
// Revisao estatica da migration 0016 (update_stripe_config e hardenings).
// Os testes A-J da revisao externa: semantica SQL verificada no conteudo do
// arquivo (a execucao real exige o DEV, pendente).

const SQL = readFileSync(
  new URL("./../supabase/migrations/0016_admin_stripe_configuration.sql", import.meta.url),
  "utf8",
);

function bodyOf(fn: string): string {
  const start = SQL.indexOf("create or replace function public." + fn);
  expect(start).toBeGreaterThan(-1);
  const end = SQL.indexOf("$$;", start);
  return SQL.slice(start, end);
}

describe("0016: hardening estatico da update_stripe_config", () => {
  const updateBody = bodyOf("update_stripe_config");

  it("J: SELECT da configuracao usa FOR UPDATE", () => {
    expect(updateBody).toContain("for update");
  });

  it("A/B: mode change com configuracao completa exige novos secrets", () => {
    expect(updateBody).toContain("MODE_CHANGE_REQUIRES_NEW_SECRETS");
    expect(updateBody).toMatch(/if p_mode <> v_existing_mode\s+and \(p_secret_key is null or p_webhook_secret is null\)/);
  });

  it("C/D: mode change com novos secrets e permitido (sem guard bloqueante)", () => {
    // O guard so dispara quando p_mode difere E algum secret e NULL:
    // com ambos novos, a condicao nao intercepta.
    expect(updateBody).toContain("p_secret_key is null or p_webhook_secret is null");
  });

  it("E/F/G: mesmo mode + NULL preserva (sem guard para mesmo mode)", () => {
    expect(updateBody).toContain("if v_secret_id is not null and v_webhook_id is not null then");
  });

  it("H/I: troca de mode ou novo webhook reseta last_webhook_verified_at", () => {
    expect(updateBody).toMatch(/last_webhook_verified_at = case\s+when p_mode <> v_existing_mode or p_webhook_secret is not null\s+then null\s+else v_last_verified_at/);
  });

  it("v_mode e inicializado a partir de p_mode", () => {
    expect(updateBody).toContain("v_mode := p_mode;");
  });

  it("vault.update_secret usa ID primeiro (id, secret)", () => {
    expect(updateBody).toContain("vault.update_secret(v_secret_id, v_secret_key)");
    expect(updateBody).toContain("vault.update_secret(v_webhook_id, v_webhook_secret)");
  });

  it("sem keyword XOR booleano (codigo, comentarios ignorados)", () => {
    const noComments = updateBody.replace(/--[^\n]*/g, "");
    expect(noComments).not.toMatch(/\bxor\b/i);
  });

  it("v_last_verified_at declarado e lido no SELECT", () => {
    expect(updateBody).toContain("v_last_verified_at timestamptz");
    expect(updateBody).toContain("c.last_webhook_verified_at");
  });
});

describe("0016: search_path e grants", () => {
  it("todas as quatro funcoes SECURITY DEFINER usam search_path vazio", () => {
    for (const fn of [
      "get_stripe_runtime_config",
      "get_stripe_admin_status",
      "update_stripe_config",
      "mark_stripe_webhook_verified",
    ]) {
      const body = bodyOf(fn);
      expect(body).toContain("security definer");
      expect(body).toMatch(/set search_path = ''/);
      expect(body).not.toMatch(/set search_path = (public|vault)/);
    }
  });

  it("objetos referenciados sao schema-qualified", () => {
    const body = bodyOf("update_stripe_config");
    expect(body).toContain("public.stripe_config");
    expect(body).toContain("vault.update_secret");
    expect(body).toContain("vault.create_secret");
  });

  it("sem grant direto de tabela a service_role (RPC-only)", () => {
    expect(SQL).not.toMatch(/grant (select|update|insert|delete|all)[^;]*on table[^;]*to service_role/);
    expect(SQL).toContain(
      "revoke all on table public.stripe_config from public, anon, authenticated, service_role",
    );
  });

  it("service_role recebe somente EXECUTE nas RPCs", () => {
    expect(SQL.match(/grant execute on function[^;]*to service_role;/g)?.length).toBe(4);
  });

  it("extension supabase_vault (preflight e create)", () => {
    expect(SQL).toContain("name = 'supabase_vault'");
    expect(SQL).toContain("create extension if not exists supabase_vault with schema vault");
  });

  it("coluna last_webhook_verified_at criada antes da funcao que a usa", () => {
    const alterIdx = SQL.indexOf("add column if not exists last_webhook_verified_at");
    const fnIdx = SQL.indexOf("create or replace function public.mark_stripe_webhook_verified");
    expect(alterIdx).toBeGreaterThan(-1);
    expect(fnIdx).toBeGreaterThan(alterIdx);
  });

  it("nenhum comando destrutivo", () => {
    for (const destructive of [
      /drop\s+table/i,
      /drop\s+database/i,
      /drop\s+function/i,
      /drop\s+schema/i,
      /truncate/i,
      /delete\s+from/i,
    ]) {
      expect(SQL).not.toMatch(destructive);
    }
  });

  it("sem plaintext na tabela (apenas metadados)", () => {
    const createTable = SQL.slice(
      SQL.indexOf("create table if not exists public.stripe_config"),
      SQL.indexOf(");", SQL.indexOf("create table if not exists public.stripe_config")) + 2,
    );
    for (const col of ["decrypted_secret", "secret_key text", "webhook_secret text"]) {
      expect(createTable).not.toContain(col);
    }
    expect(createTable).toContain("secret_key_secret_id uuid");
    expect(createTable).toContain("secret_key_last4 text");
  });
});
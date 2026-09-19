-- 0016: Stripe configuration from the Admin panel.
--
-- Architecture:
--   - public.stripe_config stores ONLY metadata (mode, vault secret ids,
--     last4 for display, timestamps, updated_by). Never plaintext secrets.
--   - The actual Stripe secrets live in Supabase Vault (encrypted at rest,
--     managed by pgsodium; decrypted access restricted to the postgres role).
--   - All read/write goes through SECURITY DEFINER RPCs owned by postgres
--     with a locked search_path, revoked from PUBLIC/anon/authenticated and
--     granted ONLY to service_role. The app server checks admin role BEFORE
--     invoking any of these RPCs (defense in depth; the DB is the barrier).
--
-- Idempotency: safe to re-run (if not exists guards + upsert-style updates).

-- Preflight: Vault must be available. On hosted Supabase the extension is
-- available by default; if this fails, the project does not support Vault
-- and this migration must not be applied silently.
do $$
begin
  if not exists (
    select 1 from pg_available_extensions where name = 'supabase_vault'
  ) then
    raise exception 'VAULT_EXTENSION_UNAVAILABLE';
  end if;
end
$$;

create extension if not exists supabase_vault with schema vault;

-- Metadata only. No secret material in this table.
create table if not exists public.stripe_config (
  id integer primary key default 1 check (id = 1),
  mode text not null default 'test' check (mode in ('test', 'live')),
  secret_key_secret_id uuid,
  webhook_secret_id uuid,
  secret_key_last4 text,
  webhook_configured boolean not null default false,
  configured_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint stripe_config_secrets_in_vault check (
    -- Either fully unconfigured, or both secret ids reference the Vault.
    (secret_key_secret_id is null and webhook_secret_id is null)
    or (secret_key_secret_id is not null and webhook_secret_id is not null)
  )
);

-- Deny everything to client roles. No policies = RLS blocks all access.
-- RPC-only architecture: service_role receives ONLY execute on the RPCs
-- below — no direct table grants (the app never reads/writes the table
-- directly; all access goes through the SECURITY DEFINER functions).
alter table public.stripe_config enable row level security;
revoke all on table public.stripe_config from public, anon, authenticated, service_role;

-- Ensure the single row exists.
insert into public.stripe_config (id) values (1) on conflict (id) do nothing;

-- Returns the decrypted runtime configuration for the payment provider.
-- NEVER expose via PostgREST to client roles (see revokes below).
create or replace function public.get_stripe_runtime_config()
returns table (mode text, secret_key text, webhook_secret text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select c.mode,
         s.decrypted_secret,
         w.decrypted_secret
  from public.stripe_config c
  left join vault.decrypted_secrets s on s.id = c.secret_key_secret_id
  left join vault.decrypted_secrets w on w.id = c.webhook_secret_id
  where c.id = 1
    and c.secret_key_secret_id is not null
    and c.webhook_secret_id is not null;
end;
$$;

revoke all on function public.get_stripe_runtime_config() from public, anon, authenticated;
grant execute on function public.get_stripe_runtime_config() to service_role;

-- Admin-safe status: metadata only (mode, configured flags, last4).
-- Never returns secret material.
create or replace function public.get_stripe_admin_status()
returns table (
  mode text,
  secret_key_configured boolean,
  webhook_secret_configured boolean,
  secret_key_last4 text,
  configured_at timestamptz,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select c.mode,
         c.secret_key_secret_id is not null,
         c.webhook_configured,
         c.secret_key_last4,
         c.configured_at,
         c.updated_at,
         c.updated_by
  from public.stripe_config c
  where c.id = 1;
end;
$$;

revoke all on function public.get_stripe_admin_status() from public, anon, authenticated;
grant execute on function public.get_stripe_admin_status() to service_role;

-- Timestamp of the last successfully verified real webhook. Must exist
-- BEFORE update_stripe_config (which reads/resets it) is created.
alter table public.stripe_config
  add column if not exists last_webhook_verified_at timestamptz;

-- Updates the configuration. NULL secret args preserve the existing vault
-- secret (empty input in the admin form). Validation of key format
-- (sk_test_/sk_live_/whsec_) happens in the app layer AND is re-enforced
-- here by pattern checks.
create or replace function public.update_stripe_config(
  p_mode text,
  p_secret_key text,
  p_webhook_secret text,
  p_updated_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_existing_mode text;
  v_secret_id uuid;
  v_webhook_id uuid;
  v_last4 text;
  v_last_verified_at timestamptz;
  v_secret_key text;
  v_webhook_secret text;
begin
  if p_mode not in ('test', 'live') then
    raise exception 'INVALID_MODE';
  end if;
  v_mode := p_mode;

  -- FOR UPDATE serializa updates administrativos concorrentes.
  select
    c.mode,
    c.secret_key_secret_id,
    c.webhook_secret_id,
    c.secret_key_last4,
    c.last_webhook_verified_at
    into v_existing_mode, v_secret_id, v_webhook_id, v_last4, v_last_verified_at
  from public.stripe_config c
  where c.id = 1
  for update;

  -- Troca de modo com configuracao completa exige novos secrets:
  -- TEST -> LIVE exige nova sk_live_ + novo whsec_; LIVE -> TEST exige
  -- nova sk_test_ + novo whsec_. Preservar Vault IDs de outro modo deixaria
  -- a chave com prefixo antigo operando em modo novo.
  if v_secret_id is not null and v_webhook_id is not null then
    if p_mode <> v_existing_mode
       and (p_secret_key is null or p_webhook_secret is null) then
      raise exception 'MODE_CHANGE_REQUIRES_NEW_SECRETS';
    end if;
  end if;

  v_secret_key := p_secret_key;
  v_webhook_secret := p_webhook_secret;

  if v_secret_key is not null then
    if p_mode = 'test' and v_secret_key !~ '^sk_test_' then
      raise exception 'SECRET_KEY_MODE_MISMATCH';
    end if;
    if p_mode = 'live' and v_secret_key !~ '^sk_live_' then
      raise exception 'SECRET_KEY_MODE_MISMATCH';
    end if;
    v_last4 := right(v_secret_key, 4);
  end if;

  if v_webhook_secret is not null and v_webhook_secret !~ '^whsec_' then
    raise exception 'INVALID_WEBHOOK_SECRET';
  end if;

  -- Both-or-neither: a partial update that would leave only one side set is
  -- rejected unless the existing row already has both sides configured.
  -- PostgreSQL nao tem operador XOR booleano: compara-se a presenca dos
  -- dois lados (novo arg OU id Vault existente) com <>.
  if ((v_secret_key is not null or v_secret_id is not null)
      <> (v_webhook_secret is not null or v_webhook_id is not null)) then
    raise exception 'PARTIAL_CONFIGURATION';
  end if;

  if v_secret_key is not null then
    -- Assinatura oficial do Vault: update_secret(id, new_secret) — ID primeiro.
    if v_secret_id is not null then
      perform vault.update_secret(v_secret_id, v_secret_key);
    else
      v_secret_id := vault.create_secret(v_secret_key, 'stripe_secret_key', 'Stripe API secret key (admin-configured)');
    end if;
  end if;

  if v_webhook_secret is not null then
    if v_webhook_id is not null then
      perform vault.update_secret(v_webhook_id, v_webhook_secret);
    else
      v_webhook_id := vault.create_secret(v_webhook_secret, 'stripe_webhook_secret', 'Stripe webhook signing secret (admin-configured)');
    end if;
  end if;

  update public.stripe_config
  set mode = v_mode,
      secret_key_secret_id = v_secret_id,
      webhook_secret_id = v_webhook_id,
      secret_key_last4 = v_last4,
      webhook_configured = v_webhook_id is not null,
      configured_at = case
        when v_secret_id is not null and v_webhook_id is not null
          then coalesce(configured_at, now())
        else null
      end,
      -- Troca de modo ou rotacao do whsec_ invalida a verificacao anterior:
      -- um webhook verificado para a configuracao antiga nao pode continuar
      -- aparecendo como verificado.
      last_webhook_verified_at = case
        when p_mode <> v_existing_mode or p_webhook_secret is not null
          then null
        else v_last_verified_at
      end,
      updated_at = now(),
      updated_by = p_updated_by
  where id = 1;
end;
$$;

revoke all on function public.update_stripe_config(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.update_stripe_config(text, text, text, uuid) to service_role;

-- Records the timestamp of the last successfully verified real webhook.
-- Called only by the webhook route after signature verification succeeds.
create or replace function public.mark_stripe_webhook_verified()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stripe_config
  set last_webhook_verified_at = now()
  where id = 1;
end;
$$;

revoke all on function public.mark_stripe_webhook_verified() from public, anon, authenticated;
grant execute on function public.mark_stripe_webhook_verified() to service_role;
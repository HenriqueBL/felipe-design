-- Migration 0002: RLS, funcoes de seguranca, trigger de profiles e storage
-- Politicas documentadas em docs/database.md.

-- ============ Funcoes auxiliares ============

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Espelha cada novo usuario do Supabase Auth em public.profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Ativacao do RLS ============

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.plan_prices enable row level security;
alter table public.affiliates enable row level security;
alter table public.orders enable row level security;
alter table public.order_images enable row level security;
alter table public.order_revisions enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.app_settings enable row level security;

-- ============ Policies ============

-- profiles: dono le o proprio perfil; admin gerencia tudo.
create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_insert_admin on public.profiles
  for insert with check (public.is_admin());
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());
create policy profiles_delete_admin on public.profiles
  for delete using (public.is_admin());

-- plans: leitura publica (vitrine de servicos antes do login); escrita admin.
create policy plans_select_public on public.plans
  for select using (true);
create policy plans_write_admin on public.plans
  for all using (public.is_admin()) with check (public.is_admin());

-- plan_prices: publico ve apenas precos ativos; admin ve o historico.
create policy plan_prices_select on public.plan_prices
  for select using (active or public.is_admin());
create policy plan_prices_write_admin on public.plan_prices
  for all using (public.is_admin()) with check (public.is_admin());

-- affiliates: somente admin.
create policy affiliates_admin on public.affiliates
  for all using (public.is_admin()) with check (public.is_admin());

-- orders: cliente acessa apenas os proprios; admin gerencia.
create policy orders_select_own_or_admin on public.orders
  for select using (user_id = auth.uid() or public.is_admin());
create policy orders_insert_own on public.orders
  for insert with check (user_id = auth.uid());
create policy orders_update_admin on public.orders
  for update using (public.is_admin()) with check (public.is_admin());
create policy orders_delete_admin on public.orders
  for delete using (public.is_admin());

-- order_images: dono do pedido le e envia; admin gerencia entregas.
create policy order_images_select_own on public.order_images
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())
    )
  );
create policy order_images_insert_own on public.order_images
  for insert with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = auth.uid()
    )
  );
create policy order_images_admin on public.order_images
  for update using (public.is_admin()) with check (public.is_admin());
create policy order_images_delete_admin on public.order_images
  for delete using (public.is_admin());

-- order_revisions: dono do pedido solicita; admin gerencia.
create policy order_revisions_select_own on public.order_revisions
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())
    )
  );
create policy order_revisions_insert_own on public.order_revisions
  for insert with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = auth.uid()
    )
  );
create policy order_revisions_admin on public.order_revisions
  for update using (public.is_admin()) with check (public.is_admin());
create policy order_revisions_delete_admin on public.order_revisions
  for delete using (public.is_admin());

-- portfolio_items: publicados sao publicos; admin gerencia.
create policy portfolio_select_public on public.portfolio_items
  for select using (published or public.is_admin());
create policy portfolio_admin on public.portfolio_items
  for all using (public.is_admin()) with check (public.is_admin());

-- payments: leitura pelo dono do pedido; escrita apenas via service_role (webhook).
create policy payments_select_own_or_admin on public.payments
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())
    )
  );

-- payment_events / affiliate_commissions / app_settings: somente admin.
create policy payment_events_admin on public.payment_events
  for all using (public.is_admin()) with check (public.is_admin());
create policy affiliate_commissions_admin on public.affiliate_commissions
  for all using (public.is_admin()) with check (public.is_admin());
create policy app_settings_admin on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ============ Storage ============

-- Buckets: uploads de clientes e resultados sao privados; portfolio e publico.
insert into storage.buckets (id, name, public)
values ('client-uploads', 'client-uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('order-results', 'order-results', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('portfolio', 'portfolio', true)
on conflict (id) do nothing;

-- Convencao de caminho: {user_id}/{order_id}/...
create policy storage_client_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_client_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id in ('client-uploads', 'order-results')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_admin_all on storage.objects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

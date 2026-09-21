-- Evolucao aditiva do portfolio: imagem principal opcional + destaque unico.
-- Mantem before/afterStorage_path intactos (compatibilidade retroativa).

-- Imagem principal/resultado do item (nao obrigatoria: itens before/after
-- existentes continuam validos). Quando presente, e a usada na Home/Gallery.
alter table public.portfolio_items
  add column if not exists image_storage_path text;

-- Destaque: no maximo UM item featured no banco inteiro.
alter table public.portfolio_items
  add column if not exists featured boolean not null default false;

-- Garante unicidade do destaque no banco, nao apenas no frontend.
create unique index if not exists portfolio_items_featured_uq
  on public.portfolio_items (featured)
  where featured;

-- Consulta rapida do destaque publicado (Home hero).
create index if not exists portfolio_items_featured_published_idx
  on public.portfolio_items (published, featured)
  where featured;

-- Troca atomica do destaque (na mesma transacao, sem janela com dois
-- destaques). SECURITY DEFINER permite ao admin chamar sem depender de
-- politicas compostas; invocadores nao-admin sao rejeitados.
create or replace function public.set_portfolio_featured(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only';
  end if;

  update public.portfolio_items
     set featured = false
   where featured
     and id <> target_id;

  update public.portfolio_items
     set featured = true
   where id = target_id;

  if not found then
    raise exception 'portfolio item not found: %', target_id;
  end if;
end;
$$;

revoke all on function public.set_portfolio_featured(uuid) from public, anon;
grant execute on function public.set_portfolio_featured(uuid) to authenticated;

-- Normalizacao de seguranca: nunca confiar no nome de arquivo do usuario.
-- (validacao de MIME/extensao/tamanho fica no dominio TS + action.)
# Felipe Design — Project Status

Atualizado em: 2026-09-17
Branch: `chore/production-readiness`
Última tag: `v0.2.0-mvp`
main: `06878ba`

> **MVP COMPLETE != PRODUCTION READY**
> O MVP técnico está congelado e validado, mas a produção exige decisões humanas
> (preços reais, domínio, gateway de pagamento, SMTP) e infraestrutura adicional.

## DONE

- MVP técnico completo (tag `v0.2.0-mvp`): unit 56/56, integration 71/71, E2E 92/92, lint 0, typecheck, build e CI — todos PASS
- Source photo intake (migrations 0008–0011): input/output separados, snapshots por pedido, `register_source_image` transacional, freeze pós-submit, validação server-side no finalize (objeto real no Storage: existência, tamanho, MIME contra snapshot) com cleanup de orphan
- Supabase DEV: `felipe-design-dev` (ref `jfsymthtepikfpexzxvk`, sa-east-1)
- Supabase PROD criado: `felipe-design-prod` (ref `xwsghpzvbiguvnvwiuoq`, sa-east-1, ACTIVE_HEALTHY)
- Migrations 0001–0011 aplicadas no PROD (banco vazio confirmado antes do push; 0009 afetou 0 rows como previsto)
- Schema/RLS/RPCs/Storage validados no PROD; `client-uploads` PRIVATE confirmado
- Auth Magic Link implementado (Supabase Auth, locale preservado)
- Checkout implementado (server actions + Zod, preço/prazo autoritativos no servidor)
- BRL/USD independentes (`plan_prices` por moeda, snapshot na compra)
- Queue/deadline engine: TS e SQL idênticos, `FOR UPDATE` em `app_settings`, `promised_delivery_date` nunca diminui
- Admin: dashboard protegido por middleware + RLS + guards `is_admin()` nas RPCs
- Security hardening: RLS em todas as tabelas, `register_source_image` como única via de source insert (0010), idempotência por storage_path (0011), TUS signed uploads, signed URLs para thumbnails

## IN PROGRESS

- Production smoke (testes de fumaça contra PROD ficam para a fase de deploy)
- Visual/product completion (polish pendente de decisão/merge)
- Deployment preparation (fase Vercel/domínio ainda não iniciada)

## BLOCKED / HUMAN DECISION

- Preços reais BRL/USD (valores atuais em `plan_prices` são fixtures da seed 0005)
- Primeiro admin real (magic link + `update public.profiles set role='admin'` via SQL Editor)
- Domínio de produção
- SMTP/remetente de e-mail (SPF/DKIM/DMARC)
- Redes sociais
- Galeria/imagens de portfólio
- Gateway de pagamento real (Stripe/Mercado Pago/NowPayments)
- Dados/configuração VPS (se aplicável à hospedagem final)

## NOT IMPLEMENTED YET

- About/Sobre
- Footer final
- Logo oficial
- Gallery pública
- Market localization BR/international
- Real payment provider/webhook
- Amount/currency validation for real payments
- SMTP production
- Uptime monitoring
- Error monitoring
- Restore test
- Production deployment
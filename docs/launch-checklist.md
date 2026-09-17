# Felipe Design — Launch Checklist

Checklist operacional ordenado para levar o MVP validado à produção.

**Regra de concorrência:** somente UMA sessão por vez pode rodar
Integration/E2E contra o Supabase DEV (evita interferência de fixtures
e churn de auth entre execuções).

## 1. Consolidate branches

- [ ] Merge ou PR de `chore/production-readiness` para `main`
- [ ] Tag de release (ex.: `v0.3.0-preprod`) após o merge
- [ ] CI verde em `main` (quality + integration + e2e)

## 2. Product/content

- [ ] About/Sobre
- [ ] Footer final
- [ ] Logo oficial
- [ ] Galeria/imagens de portfólio (bucket `portfolio`)
- [ ] Revisão de copy EN/PT

## 3. Market localization

- [ ] Decidir mercado-alvo inicial (BR, internacional ou ambos)
- [ ] Moeda padrão da vitrine conforme mercado
- [ ] SEO/hreflang verificados para o domínio real

## 4. Real payments

- [ ] Escolher gateway (Stripe / Mercado Pago / NowPayments)
- [ ] Implementar provider concreto no registry
- [ ] Rota de webhook com verificação de assinatura
- [ ] Amount/currency validation for real payments
- [ ] Testes sandbox do ciclo completo

## 5. Email

- [ ] Domínio remetente
- [ ] SMTP/provider (Resend/Postmark ou similar)
- [ ] Templates transacionais (magic link, confirmações)
- [ ] SPF/DKIM/DMARC

## 6. VPS/infrastructure (ou Vercel)

- [ ] Provisionar ambiente de produção
- [ ] Env vars de produção (sem `ENABLE_MOCK_PAYMENTS`)
- [ ] Backups/PITR habilitados no Supabase PROD

## 7. Production configuration

- [ ] Preços reais BRL/USD via `/dashboard/plans`
- [ ] `app_settings` reais (capacidade, cutoff, min/max fotos)
- [ ] Primeiro admin real (magic link + SQL de promoção)
- [ ] Auth Site URL + Redirect URLs no domínio real
- [ ] DNS apontado e HTTPS ativo

## 8. Release validation

- [ ] Error monitoring (Sentry ou similar)
- [ ] Uptime monitoring
- [ ] Restore test do backup
- [ ] Rate limiting revisado
- [ ] Security headers (HSTS/CSP)

## 9. Production smoke

- [ ] Fluxo completo com usuário de teste em PROD
- [ ] RLS verificado entre clientes distintos
- [ ] Queue/deadline correto após pagamento+fotos
- [ ] i18n `/pt/servicos` etc. no domínio real
- [ ] Remoção dos dados de teste

## 10. Launch

- [ ] Congelar preços e configurações
- [ ] Anúncio/abertura de vendas
- [ ] Monitoramento das primeiras 48h
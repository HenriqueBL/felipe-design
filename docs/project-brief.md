# Felipe Design - Briefing do Projeto (v2)

> Fonte da verdade do produto. A v2 incorpora as decisões confirmadas: stack, idioma/moeda, preços via painel, autenticação, entrega, revisões, prazos em dias úteis, afiliados e landing pages.

## 1. Visão do produto
Site profissional bilíngue (EN / PT-BR) do designer de cutelaria Felipe: vitrine com comparações Antes/Depois, contratação de serviços de edição com pagamento online, prazo automático e painel administrativo completo. O objetivo é converter tráfego pago (Google Ads), principalmente de cuteleiros fora do Brasil.

## 2. Público-alvo
- Primário: cuteleiros internacionais (EUA e Europa), que pagam com cartão (Stripe) ou criptomoeda (NowPayments). Veem o site em inglês, com preços em USD.
- Secundário: cuteleiros brasileiros, que pagam com PIX ou cartão (Mercado Pago). Veem o site em PT-BR, com preços em BRL.

## 3. Stack técnica (confirmada)
- Next.js: frontend, rotas bilíngues e renderização server-side para SEO.
- Supabase: PostgreSQL como banco de dados.
- Supabase Auth: autenticação por magic link, sem senha.
- Supabase Storage: fotos enviadas pelos clientes e arquivos entregues.
- Vercel: deploy e hospedagem.
- Prioridades da arquitetura: SEO, performance, site bilíngue e facilidade de manutenção.

## 4. Idioma e moeda
- Inglês é o idioma principal e padrão (foco comercial internacional); PT-BR fica disponível.
- URLs bilíngues (/en e /pt) com hreflang.
- Detecção de idioma/região é permitida, mas a troca manual sempre fica disponível.
- Brasil paga em BRL e exterior em USD, com valores que podem diferir entre regiões.

## 5. Estrutura de páginas
- Home / Vitrine: destaques do portfólio e chamada para contratação.
- Sobre: perfil do profissional Felipe.
- Serviços: planos de 1, 2 ou 3 ângulos por faca.
- Guia de envio: como fotografar a faca (liberado após o pagamento).
- Área do cliente: upload das fotos, acompanhamento e download do resultado.
- Painel administrativo: controle total para Felipe.
- Landing pages de campanha: páginas dedicadas e otimizadas por palavra-chave.

## 6. Home e conversão
- Home claramente orientada à conversão.
- Direção do CTA principal: "Transform your knife photos into professional product images." (referência de posicionamento, não texto final).
- As comparações Antes/Depois têm destaque como peça central de conversão.

## 7. Fluxo do cliente
1. Chega pela Home ou por uma landing page de campanha.
2. Escolhe o plano (1, 2 ou 3 ângulos) e a quantidade de facas; vê o preço da sua região e moeda.
3. Vê o prazo de entrega calculado antes de pagar.
4. Informa o e-mail e recebe o magic link para acessar a área do cliente.
5. Paga via Stripe, Mercado Pago ou NowPayments.
6. O webhook confirma o pagamento, grava o pedido com o preço praticado e libera o guia e o upload.
7. Cliente envia as fotos seguindo o guia.
8. Pedido entra na fila: Pendente -> Em andamento -> Concluído.
9. Cliente baixa o resultado em alta resolução e recebe o e-mail de conclusão.
10. Após a primeira entrega, tem direito a 1 rodada de revisão gratuita.

## 8. Planos e preços
- Planos: 1, 2 ou 3 ângulos por faca, cada um com preço próprio.
- Preços definidos e alterados pelo painel administrativo (seção "Planos e Preços"), em BRL e USD independentes.
- O admin pode ativar ou desativar cada plano e mudar os preços a qualquer momento.
- Preços nunca ficam hardcoded no frontend.
- O pedido registra o preço praticado no momento da compra (snapshot); alterações futuras não afetam pedidos antigos.
- A estrutura fica preparada para descontos e promoções via painel no futuro (fora do escopo obrigatório do MVP).

## 9. Fila e prazo automático
- Capacidade de produção: 4 edições por dia.
- Cálculo do prazo em dias úteis.
- Prazo = hoje + backlog de imagens pendentes na fila + ceil(imagens do pedido / 4), avançando apenas dias úteis.
- Horário de corte configurável no admin: pagamento confirmado após o corte entra na fila a partir do próximo dia útil.
- O prazo é exibido antes do pagamento, gravado no pedido e nunca diminui após a confirmação.

## 10. Estados do pedido
- Pendente: pago, aguardando fotos ou posição na fila.
- Em andamento: Felipe iniciou a edição.
- Concluído: resultado disponível na área do cliente.
- As revisões são registradas como rodadas do pedido após a primeira entrega, sem criar estados adicionais.

## 11. Entrega e revisões
- Resultado disponível para download na área do cliente, em alta resolução, em JPG e PNG.
- E-mail automático informa ao cliente que o trabalho foi concluído.
- Cada pedido inclui 1 rodada de revisão gratuita após a primeira entrega.
- A arquitetura permite cobrar revisões adicionais no futuro.

## 12. Pagamentos
- Stripe: cartão internacional.
- Mercado Pago: PIX e cartão brasileiro.
- NowPayments: criptomoedas.
- Cada gateway confirma o pagamento por webhook e libera o pedido automaticamente.

## 13. Afiliados
- Cada afiliado recebe link ou código exclusivo.
- O sistema identifica qual afiliado originou o cliente e a venda.
- As comissões são registradas por venda e acompanhadas no admin.
- O percentual de comissão é configurável no painel, nunca fixo no código.
- No primeiro momento, o pagamento das comissões é manual.

## 14. Painel administrativo
- Pedidos: filtros, mudança de status, fotos enviadas, entrega do resultado.
- Portfólio: cadastro e gestão de trabalhos, incluindo pares Antes/Depois.
- Planos e Preços: valores por moeda e ativação/desativação de planos.
- Faturamento: ganhos por período, com filtros de gateway e origem.
- Clientes: lista e origem (convidado por afiliado ou sem indicação).
- Afiliados: códigos, comissões geradas e marcação de pagamento manual.
- Configurações: horário de corte da fila e demais parâmetros operacionais.

## 15. SEO e Google Ads
- URLs semânticas bilíngues (ex.: /en/services e /pt/servicos) com hreflang.
- Sitemap, schema.org, Core Web Vitals e GA4 com acompanhamento de conversões do Google Ads.
- Landing pages dedicadas por intenção de busca (ex.: /en/knife-photo-editing), sem depender apenas da Home.
- Palavras-chave iniciais: knife photo editing, custom knife design, knife photo retouching, edição de fotos de facas.

## 16. Entidades de dados (rascunho)
- User: cliente ou administrador; autenticação por magic link.
- Plan: plano de 1, 2 ou 3 ângulos, com flag ativo/inativo.
- PlanPrice: preço do plano por moeda (BRL/USD) com vigência.
- Order: plano, quantidade de facas, total de imagens, snapshot de preço, moeda, prazo prometido e status.
- OrderImage: fotos enviadas pelo cliente e imagens entregues (Supabase Storage).
- OrderRevision: rodadas de revisão do pedido (a primeira é gratuita).
- PortfolioItem: trabalhos da vitrine, incluindo imagens Antes/Depois.
- Payment: gateway, moeda, valor e status.
- Affiliate: afiliado com código exclusivo e percentual de comissão configurável.
- AffiliateCommission: comissão gerada por venda, com status (pendente/paga).
- AppSetting: parâmetros do sistema, como horário de corte e capacidade diária.

## 17. Escopo do MVP
Núcleo inicial simples: Portfólio/Vitrine -> Escolha do serviço -> Prazo -> Pagamento -> Área do cliente -> Upload das fotos -> Fila de produção -> Entrega. Evitar aumentar o escopo inicial desnecessariamente.

## 18. Próximos passos
1. Criar o projeto Next.js com estrutura bilíngue (/en e /pt) e deploy na Vercel.
2. Modelar o banco no Supabase (entidades da seção 16) com RLS.
3. Implementar a seção "Planos e Preços" e o cálculo de prazo no backend.
4. Construir o fluxo de pedido com checkout e webhooks dos gateways.
5. Fechar as pendências restantes de configuração, conteúdo e lançamento (decisoes-pendentes.md).

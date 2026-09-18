# Backup & Restore Runbook

Quatro domínios independentes. **Backup do banco NÃO cobre objetos do
Supabase Storage** — cada domínio tem seu próprio procedimento.

| Domínio | Onde vive | Ferramenta |
|---|---|---|
| A. Git/source | GitHub (HenriqueBL/felipe-design) | Git / GitHub |
| B. PostgreSQL | Supabase (gerenciado) | `pg_dump` |
| C. Storage | Supabase Storage (3 buckets) | sincronização de objetos |
| D. Env/secrets | VPS `.env.production` + cofre | password manager |

## A. Git / source

O repositório é a fonte de verdade do código; branches + tags no remote
cobrem tudo. Nada a fazer além de garantir push antes de deploy (runbook).

## B. Supabase PostgreSQL (pg_dump independente)

Backup independente do Supabase (não confie apenas em backups internos do
provedor). Conexão: Database Settings do projeto → Connection string
(session pooler, porta 5432) com role `postgres` + senha do projeto.

Backup diário, retenção sugerida: 7 diários + 4 semanais + 6 mensais.

```bash
pg_dump "$SUPABASE_DB_URL" -Fc -f backup-db-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Restore (drill):

```bash
# restaurar em um banco de TESTE (nunca direto em prod sem decisão explícita)
pg_restore -d "$TEST_DB_URL" --clean --if-exists backup-db-<timestamp>.dump
```

## C. Supabase Storage

Buckets persistentes criados nas migrations (0002/0008):

- `client-uploads` (privado; fotos-fonte dos clientes — INPUT crítico)
- `order-results` (privado; entregas finais)
- `portfolio` (público)

Espelhe TODOS os três. Não há bucket único; um sync que cubra só
`client-uploads` deixa entregas e portfolio sem cópia. Destino ainda não
escolhido (S3/B2/rclone para montagem remota). Interface genérica enquanto o
destino não existe — exemplo com `rclone` (supabase via S3-compatible
endpoint das Storage Settings) ou `supabase` CLI:

```bash
# Opção 1: rclone sync por bucket (endpoint e credenciais das Storage
# Settings do projeto — S3-compatible)
for B in client-uploads order-results portfolio; do
  rclone sync "supabase:$B" "backup-remote:felipe-design/$B" --progress
done

# Opção 2 (listagem/verificação de volume):
rclone size "supabase:client-uploads"
```

Restrições: objetos >50MB via S3 gateway exigem transfer endpoint separado;
consulte a documentação atual do Supabase Storage quando escolher o destino.

## D. Env / secrets

- Fonte de verdade: cofre/password manager (não o Git — `.env.production`
  nunca é versionado).
- A cada rotação/criação de secret: atualizar cofre E `.env.production` na
  VPS no mesmo passo.
- Backup = o próprio cofre (redundância do gerenciador). Registrar também
  `APP_PORT`, nome/tag de imagem em uso e connection string do banco.

## Off-site, encryption, retenção

- **Off-site**: cópia fora da VPS e fora da mesma região do Supabase quando
  possível (ex.: backup local na VPS + push cifrado para destino remoto).
- **Encryption**: criptografe dumps antes de sair da VPS:
  `age -r <recipient-key> -o backup.dump.age backup.dump` (ou gpg). Enviar
  somente o artefato cifrado.
- **Retenção**: igual à do banco (7/4/6) para DB; Storage pode usar retenção
  menor inicialmente, mas nunca < 2 gerações.

## Restore drill (recomendado: trimestral)

1. Restaurar dump mais recente em banco de TESTE; validar contagens de
   `orders`, `payments`, `app_settings`.
2. Restaurar um objeto de cada bucket do espelho em ambiente de teste e
   verificar legibilidade/tamanho.
3. Recriar `.env.production` a partir do cofre em VM limpa e subir o app com
   `scripts/validate-production-env.mjs` apontando ao banco de teste.
4. Registrar data, problemas e duração do drill.

## Desastre controlado (ordem)

1. Congelar writes (derrubar o app: `docker compose -f docker-compose.prod.yml down`).
2. Comunicar perda aceita de dados da janela backup→incidente.
3. Restaurar banco (B) e Storage (C) da geração escolhida.
4. Subir imagem compatível com o schema restaurado.
5. Smoke público antes de liberar.
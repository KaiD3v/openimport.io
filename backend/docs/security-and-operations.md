# Segurança e operação

## Isolamento e chaves

O guard global autentica as rotas de negócio com `Authorization: Bearer <credencial>`. Prefixos distinguem API key (`oi_live_`) de token de importação (`oi_import_`). Em ambos os casos o backend calcula SHA-256 e busca o hash; o valor bruto não é persistido. Health, Swagger/OpenAPI quando habilitados e o fallback 404 não exigem Bearer. A organização vem da credencial e queries de recursos são escopadas por ela; recursos de outra organização retornam 404. Tokens de importação só acessam rotas anotadas da sessão vinculada; nas demais (incluindo `GET .../valid-rows` e `POST|GET .../results*`), `403 AUTH.INSUFFICIENT_SCOPE`. O seed valida formato `oi_live_` + 64 hex minúsculos, guarda hash e prefixo diagnóstico, e se recusa em produção.

Há suporte a `revokedAt` na validação de chaves e de tokens de importação. Uma API key revogada não autentica e também invalida imediatamente os tokens que ela emitiu. Não existe endpoint HTTP para criar, revogar ou listar chaves, nem para revogar tokens. Não existem RBAC geral, autenticação de usuário nem auditoria completa.

CORS só controla origens autorizadas pelo navegador; não autentica clientes. Configure `ALLOWED_ORIGINS` como URLs explícitas; wildcard é rejeitado em produção.

## Logs e dados

Logs Pino fazem redaction de authorization, cookie, idempotency key, secrets, `accessToken`, hashes de credencial e chaves S3. `X-Request-ID` permite correlacionar resposta e `traceId`; envie-o em chamados de suporte, não uma API key, token de importação ou conteúdo CSV.

CSV pode conter dados pessoais. Use fixtures sintéticas, limite acesso a logs e storage e evite copiar linhas de clientes para tickets. Mensagens de erro de preview não ecoam valores de célula.

## Saúde e dependências

`/health` é liveness. `/health/ready` executa ping no PostgreSQL e responde 503 quando o banco não está pronto. Readiness não verifica MinIO/S3 nem Redis; falhas desses serviços aparecem nas operações de upload/preview/confirm.

As credenciais do `docker-compose.yml` são fracas e exclusivamente locais. Elas não são referência de produção.

## Storage, fila e ciclo de vida

CSV é salvo fora do PostgreSQL em storage S3 compatível; banco guarda metadata e chave interna, nunca exposta pela API. Em falha de parse após storage, o backend tenta apagar o objeto e marca a sessão como `upload_failed`. Confirmação enfileira processamento em Redis/BullMQ; retries são limitados (`IMPORT_WORKER_MAX_ATTEMPTS` + backoff). Execuções falhas não retêm `ImportRecord`. Payload normalizado e CSV não entram em logs. Um reconciliador no mesmo processo republica jobs órfãos ou divergentes (BullMQ `failed`/`completed` com execução ainda não terminal), sem criar novas execuções (`IMPORT_JOB_RECONCILE_INTERVAL_MS`, paginação por cursor). Em desenvolvimento local a fila usa Redis DB 0; a suíte E2E usa DB 15 e só limpa esse namespace (`obliterate` no setup/teardown) — não use `FLUSHALL`/`FLUSHDB` no DB de desenvolvimento. Não há retenção automática, job agendado, expiração ou limpeza de objetos/sessões aceitos. DLQ completa fica para uma fatia futura.

## Riscos para exposição pública

Antes de publicar, faltam ao menos modelo de usuário, gestão segura de chaves, rate limiting, retenção/eliminação, monitoração de storage/Redis na readiness, estratégia de backup e proteção de dados. O token de importação reduz o risco de expor a API key no navegador, mas não substitui hardening público completo. Não há webhooks assinados implementados.

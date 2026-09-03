# Segurança e operação

## Isolamento e chaves

O guard global autentica as rotas de negócio com `Authorization: Bearer <api-key>`, calcula SHA-256 e busca chave ativa. Health, Swagger/OpenAPI quando habilitados e o fallback 404 não exigem Bearer. A organização vem dessa chave e queries de recursos são escopadas por ela; recursos de outra organização retornam 404. O seed valida formato `oi_live_` + 64 hex minúsculos, guarda hash e prefixo diagnóstico, e se recusa em produção.

Há suporte a `revokedAt` na validação de chaves, mas não existe endpoint HTTP para criar, revogar ou listar chaves. Não existem RBAC, escopos, autenticação de usuário nem auditoria completa.

CORS só controla origens autorizadas pelo navegador; não autentica clientes. Configure `ALLOWED_ORIGINS` como URLs explícitas; wildcard é rejeitado em produção.

## Logs e dados

Logs Pino fazem redaction de authorization, cookie, idempotency key, secrets e chaves S3. `X-Request-ID` permite correlacionar resposta e `traceId`; envie-o em chamados de suporte, não uma API key ou conteúdo CSV.

CSV pode conter dados pessoais. Use fixtures sintéticas, limite acesso a logs e storage e evite copiar linhas de clientes para tickets. Mensagens de erro de preview não ecoam valores de célula.

## Saúde e dependências

`/health` é liveness. `/health/ready` executa ping no PostgreSQL e responde 503 quando o banco não está pronto. Readiness não verifica MinIO/S3; falhas desse serviço aparecem nas operações de upload/preview.

As credenciais do `docker-compose.yml` são fracas e exclusivamente locais. Elas não são referência de produção.

## Storage e ciclo de vida

CSV é salvo fora do PostgreSQL em storage S3 compatível; banco guarda metadata e chave interna, nunca exposta pela API. Em falha de parse após storage, o backend tenta apagar o objeto e marca a sessão como `upload_failed`. Não há retenção automática, job agendado, expiração ou limpeza de objetos/sessões aceitos.

## Riscos para exposição pública

Antes de publicar, faltam ao menos modelo de usuário/autorização, gestão segura de chaves, rate limiting, retenção/eliminação, monitoração de storage na readiness, estratégia de backup, proteção de dados e contrato de confirmação. Não há webhooks assinados implementados.

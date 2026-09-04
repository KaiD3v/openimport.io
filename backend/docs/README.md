# Documentação técnica do backend

Esta documentação descreve somente o backend atualmente implementado. O contrato executável complementar é o OpenAPI em `/docs-json`; a interface Swagger fica em `/docs`. Em produção ambos só são expostos com `ENABLE_DOCS=true`; fora de produção são expostos por padrão.

## Leitura por público

| Público | Ordem recomendada |
| --- | --- |
| Desenvolvedor backend | [Ambiente local](getting-started.md) → [Arquitetura](architecture.md) → [Persistência e estados](data-model.md) → [Testes](testing-and-troubleshooting.md) |
| Integrador | [Referência HTTP](api-reference.md) → [CSV e normalização](csv-and-normalization.md) → [Segurança e operação](security-and-operations.md) |
| Frontend | [Integração frontend](frontend-integration.md) → [Referência HTTP](api-reference.md) → [CSV e normalização](csv-and-normalization.md) |
| Mantenedor | [Arquitetura](architecture.md) → [Decisões e limitações](decisions-and-limitations.md) → os demais documentos conforme a área |

## Escopo implementado

- API key de organização, token de importação restrito à sessão, templates, sessões idempotentes, upload CSV para storage S3 compatível, mapping manual, preview síncrono com normalização `pt-BR-v1`, confirmação idempotente e processamento assíncrono (Redis/BullMQ) até snapshot `ready` com rejected-rows paginadas.
- Health, readiness, logs estruturados, request IDs e OpenAPI.

Não existem entrega de válidos ao cliente, webhook `import.ready`, DLQ completa, webhooks assinados, XLSX, endpoints de listagem/histórico, RBAC geral, autenticação de usuário de navegador, cookies/OAuth/refresh token ou gestão de API keys por HTTP.

## Exemplos e walkthrough

Os dados sintéticos estão em [`examples/`](examples/): template, CSV válido e CSV com erros. O walkthrough completo está em [Referência HTTP](api-reference.md#walkthrough-reproduzível), e seu efeito no preview em [CSV e normalização](csv-and-normalization.md#fixtures-documentais).

## Manutenção

Altere o documento dono da regra ao mudar o contrato:

- HTTP, DTOs ou erros: [Referência HTTP](api-reference.md).
- CSV, limites de parser e normalização: [CSV e normalização](csv-and-normalization.md).
- tabela, índice, migration ou estado: [Persistência e estados](data-model.md).
- ambiente, operação ou segurança: os respectivos guias.

Atualize exemplos, links e OpenAPI na mesma mudança. Se código e Swagger divergirem, registre a divergência em [Referência HTTP](api-reference.md) e não duplique manualmente o schema OpenAPI.

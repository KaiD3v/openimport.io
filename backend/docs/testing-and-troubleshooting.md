# Testes e troubleshooting

## Suítes

Execute em `backend/`:

```powershell
npm run lint
npm test
npm run test:e2e
```

`npm test` roda unitários Vitest e não usa banco. `npm run test:e2e` usa `openimport_test`, Redis logical DB **15** (isolado do backend local em DB **0**), aplica migrations no setup, oblitera só a fila E2E antes/depois, usa Postgres/MinIO/Redis do Compose e cria organização/API key isoladas por caso. Pode executar com `start:prod` ativo. Execute `npm run typecheck` e depois `npm run build` sequencialmente: ambos rodam `prisma generate`.

As fixtures E2E são isoladas por tenant. Regressões cobertas incluem BOM/UTF-8, CRLF fragmentado, aspas, limites, cleanup, idempotência, revisão concorrente, amostra/orçamento, integridade do arquivo, normalização monetária e webhook `import.ready` (receptor HTTP local, rotação PUT, DELETE com delivery pendente e isolamento entre organizações).

| Sintoma E2E | Verifique | Ação segura |
| --- | --- | --- |
| Setup recusa REDIS_URL | DB path ≠ 15 | use `redis://localhost:6379/15` no `vitest.config.e2e.ts` |
| Jobs completed inesperados | worker local no mesmo Redis DB | confirme isolamento DB 0 vs 15; não mate o backend |
| Duas suítes E2E em paralelo | mesmo DB 15 | rode uma de cada vez |

## Diagnóstico seguro

| Sintoma | Verifique | Ação segura |
| --- | --- | --- |
| API não inicia | `.env`, `DATABASE_URL`, portas e `docker compose ps` | corrija variável/serviço; não resete volumes |
| `/health/ready` 503 | Postgres, Redis (`REDIS_URL`) e bucket S3/MinIO | confirme serviços do Compose; probe é somente leitura (PING, HeadBucket, `SELECT 1`); timeout aborta Redis/S3 e observa promises tardias — Postgres in-flight não é cancelável |
| 401 | formato Bearer, chave local seedada, revogação | gere/seed uma chave local válida; não logue-a |
| 404 em recurso conhecido | UUID, organização da chave | trate também como isolamento entre organizações |
| upload 400/413/422 | único campo `file`, MIME/extensão, UTF-8 e limites | corrija arquivo; não reenvie sem entender o status |
| upload 409 | `uploaded` ou `upload_failed` | sucesso anterior: não reenvie; falha terminal: nova sessão |
| mapping 409 | status ou revisão | GET mapping e resolver conflito antes de PUT |
| preview 409 | completude, revisão ou arquivo alterado | atualize mapping ou crie novo fluxo conforme o código |
| preview 503 | MinIO/S3 ou stream | trate como indisponibilidade temporária; investigue serviço antes de retry |

`422 IMPORT.INVALID_CSV` é parsing/limite/encoding. Linha inválida no preview é domínio de normalização em resposta 200. `503` tende a infraestrutura; `409` é pré-condição ou conflito; `400` é request/DTO.

Não inclua `.env`, tokens, CSV de cliente ou bodies sensíveis em issues. Use `traceId` e reprodução com fixtures de [`examples/`](examples/).

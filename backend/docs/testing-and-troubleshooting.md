# Testes e troubleshooting

## Suítes

Execute em `backend/`:

```powershell
npm run lint
npm test
npm run test:e2e
```

`npm test` roda unitários Vitest e não usa banco. `npm run test:e2e` usa `openimport_test`, aplica migrations no setup, usa Postgres/MinIO do Compose e cria organização/API key isoladas por caso. Execute `npm run typecheck` e depois `npm run build` sequencialmente: ambos rodam `prisma generate`.

As fixtures E2E são isoladas por tenant. Regressões cobertas incluem BOM/UTF-8, CRLF fragmentado, aspas, limites, cleanup, idempotência, revisão concorrente, amostra/orçamento, integridade do arquivo e normalização monetária.

Os 224 unitários e 67 E2E mencionados em histórico são números de uma validação anterior, não resultado dos comandos acima.

## Diagnóstico seguro

| Sintoma | Verifique | Ação segura |
| --- | --- | --- |
| API não inicia | `.env`, `DATABASE_URL`, portas e `docker compose ps` | corrija variável/serviço; não resete volumes |
| 401 | formato Bearer, chave local seedada, revogação | gere/seed uma chave local válida; não logue-a |
| 404 em recurso conhecido | UUID, organização da chave | trate também como isolamento entre organizações |
| upload 400/413/422 | único campo `file`, MIME/extensão, UTF-8 e limites | corrija arquivo; não reenvie sem entender o status |
| upload 409 | `uploaded` ou `upload_failed` | sucesso anterior: não reenvie; falha terminal: nova sessão |
| mapping 409 | status ou revisão | GET mapping e resolver conflito antes de PUT |
| preview 409 | completude, revisão ou arquivo alterado | atualize mapping ou crie novo fluxo conforme o código |
| preview 503 | MinIO/S3 ou stream | trate como indisponibilidade temporária; investigue serviço antes de retry |

`422 IMPORT.INVALID_CSV` é parsing/limite/encoding. Linha inválida no preview é domínio de normalização em resposta 200. `503` tende a infraestrutura; `409` é pré-condição ou conflito; `400` é request/DTO.

Não inclua `.env`, tokens, CSV de cliente ou bodies sensíveis em issues. Use `traceId` e reprodução com fixtures de [`examples/`](examples/).

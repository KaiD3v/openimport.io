# Referência HTTP

Base da API de negócio: `/api/v1`. Rotas de negócio exigem `Authorization: Bearer <credencial>`. API keys (`oi_live_`) acessam todas as rotas da organização. Tokens de importação (`oi_import_`) só nas rotas anotadas da sessão vinculada. O OpenAPI declara `api-key` em `POST /imports`, emissão de tokens e templates; nas rotas anotadas declara alternativas `api-key` **ou** `import-access-token`. `GET /health`, `GET /health/ready`, `/docs` e `/docs-json` quando habilitados, e o fallback de rota inexistente são públicos. A organização é inferida; recurso de outra organização responde `404`, não `403`. Token em rota não permitida responde `403 AUTH.INSUFFICIENT_SCOPE`. Token em outro `importId` responde `404 IMPORT.NOT_FOUND`. Token expirado, revogado, desconhecido ou cuja API key emissora esteja revogada responde `401 AUTH.INVALID_IMPORT_TOKEN` sem distinguir o motivo. Bearer ausente responde `401 AUTH.MISSING_BEARER`.

JSON é estrito: propriedades desconhecidas e tipos incompatíveis são rejeitados com `400 VALIDATION.FAILED`; não há conversão implícita de tipos nos DTOs de entrada. Respostas de erro seguem `{ code, message, details?, traceId }`; toda resposta traz `X-Request-ID`, igual a `traceId` em erros. Um `X-Request-ID` de entrada só é preservado se tiver 1–128 caracteres `[A-Za-z0-9._-]`.

O OpenAPI gerado em `/docs-json` é a fonte complementar de tipos. `/docs` e `/docs-json` existem fora de produção, ou em produção com `ENABLE_DOCS=true`.

## Health

| Método | Caminho | Auth | Resultado |
| --- | --- | --- | --- |
| GET | `/health` | não | `200 {"status":"ok"}` |
| GET | `/health/ready` | não | `200 {"status":"ok"}` ou `503 HEALTH.NOT_READY` |

Readiness testa apenas PostgreSQL, não S3/MinIO.

## Templates

### `POST /templates`

Retorna `201` com `id`, `name`, `fields` (inclui `position` zero-based), `createdAt`, `updatedAt`.

```json
{"name":"Produtos","fields":[{"key":"sku","label":"SKU","type":"string","required":true},{"key":"stock","label":"Estoque","type":"integer","required":false},{"key":"priceInCents","label":"Preço","type":"currency","required":true}]}
```

`name` tem 1–100 caracteres após trim e é único por organização. Há 1–50 fields; `key` é única e segue `^[a-z][a-zA-Z0-9]{0,63}$`, `label` tem 1–120 e `type` é `string`, `integer` ou `currency`. `required` é booleano real. Erros: `400 VALIDATION.FAILED`, `401 AUTH.*`, `403 AUTH.INSUFFICIENT_SCOPE`, `409 TEMPLATE.NAME_CONFLICT`.

### `GET /templates/:templateId`

UUID obrigatório; retorna o mesmo formato (`200`) ou `400 VALIDATION.FAILED`, `401 AUTH.*`, `403 AUTH.INSUFFICIENT_SCOPE`, `404 TEMPLATE.NOT_FOUND`.

## Token de importação

### `POST /imports/:importId/access-tokens`

Somente API key (OpenAPI: `api-key`). Corpo opcional:

```json
{"expiresInSeconds":1800}
```

`expiresInSeconds` é inteiro JSON entre 60 e 3600; omitido, vale 1800. Retorna `201` e `Cache-Control: no-store`:

```json
{"accessToken":"oi_import_<64 hex>","tokenType":"Bearer","importId":"<uuid>","expiresAt":"<iso>"}
```

O segredo aparece só nessa resposta. Persistido: SHA-256, prefixo diagnóstico, organização, sessão, API key emissora, expiração e `revokedAt` opcional. Erros: `400 VALIDATION.FAILED`, `401`, `403 AUTH.INSUFFICIENT_SCOPE`, `404 IMPORT.NOT_FOUND`.

### `GET /imports/:importId/context`

API key ou token da própria sessão (OpenAPI: alternativas `api-key` ou `import-access-token`). Retorna `200` com os contratos atuais de sessão, template e mapping:

```json
{"import":{},"template":{"id":"<uuid>","name":"products","fields":[]},"mapping":{}}
```

`import` segue `GET /imports/:importId`. `template` segue `GET /templates/:templateId` (incluindo `createdAt`/`updatedAt`). `mapping` segue `GET /imports/:importId/mapping`, inclusive em sessão `created` (draft vazio). Não expõe `organizationId`, hashes de credencial nem chave de storage. Erros: `400`, `401`, `403`, `404 IMPORT.NOT_FOUND`.

## Sessões e upload

### `POST /imports`

Somente API key. Headers: Bearer, `Content-Type: application/json`, `Idempotency-Key`. Corpo: `{"templateId":"<uuid>"}`. A chave tem 8–128 caracteres `[A-Za-z0-9._-]`.

Retorna `201` com:

```json
{"id":"<importId>","templateId":"<templateId>","status":"created","originalFilename":null,"byteSize":null,"contentSha256":null,"encoding":null,"delimiter":null,"dataRowCount":null,"columns":[],"progress":null,"executionId":null,"uploadedAt":null,"confirmedAt":null,"createdAt":"<iso>","updatedAt":"<iso>"}
```

Repetir mesma chave e mesmo template retorna a mesma sessão (`201`); mesma chave com template diferente retorna `409 IDEMPOTENCY.KEY_REUSED`. Outros erros: `400 VALIDATION.FAILED`, `401 AUTH.*`, `403 AUTH.INSUFFICIENT_SCOPE`, `404 TEMPLATE.NOT_FOUND`.

### `POST /imports/:importId/file`

Bearer (API key ou token da sessão) e `multipart/form-data`, com exatamente um arquivo no campo `file`, sem campos texto. Aceita extensão `.csv` ou MIME CSV, `application/octet-stream` ou `text/plain`. Retorna `201` na mesma forma de sessão, agora `uploaded` e com metadata/colunas.

Erros: `400 VALIDATION.FAILED` (multipart), `401`, `403 AUTH.INSUFFICIENT_SCOPE`, `404 IMPORT.NOT_FOUND`, `409 IMPORT.FILE_ALREADY_UPLOADED` ou `IMPORT.UPLOAD_NOT_ALLOWED`, `413 IMPORT.FILE_TOO_LARGE`, `422 IMPORT.INVALID_CSV`. Ao exceder o limite de bytes, a sessão permanece `created`; uma falha de parsing depois que o objeto foi gravado tenta cleanup e muda a sessão para `upload_failed`. Upload não tem idempotência; não faça retry cego.

### `GET /imports/:importId`

Retorna `200` com a sessão, incluindo campos nullable de metadata; antes do upload eles são `null` e `columns` é `[]`. Após confirmação, inclui `progress` (`processedRows`, `totalRows` nullable, `validRows`, `invalidRows`), `executionId`, `confirmedAt` e `failure` (`null` salvo em `processing_failed`, quando é `{code,message}` público sanitizado). Não invente percentual quando `totalRows` for `null`. Aceita API key ou token da sessão. Erros: `400`, `401`, `403`, `404 IMPORT.NOT_FOUND`.

## Mapping

### `GET /imports/:importId/mapping`

Retorna `200`:

```json
{"importId":"<importId>","revision":0,"mappings":[],"isComplete":false,"missingRequiredFields":["sku","priceInCents"]}
```

Só é permitido após upload; caso contrário `409 IMPORT.MAPPING_NOT_ALLOWED`.

### `PUT /imports/:importId/mapping`

Bearer + JSON. Substitui o draft inteiro:

```json
{"expectedRevision":0,"mappings":[{"columnPosition":0,"fieldKey":"sku"},{"columnPosition":1,"fieldKey":"stock"},{"columnPosition":2,"fieldKey":"priceInCents"}]}
```

`columnPosition` é inteiro >= 0 e identifica posição, não texto do header. Não repita coluna nem field e use somente coluna/field existentes. Sucesso `200` devolve a revisão atual. `409 IMPORT.MAPPING_REVISION_CONFLICT` exige novo GET e reconciliação; `409 IMPORT.MAPPING_NOT_ALLOWED` indica status incompatível; `422 IMPORT.MAPPING_INVALID` não modifica o draft.

## Preview

### `POST /imports/:importId/preview`

Bearer + JSON:

```json
{"expectedMappingRevision":1,"limit":20}
```

`expectedMappingRevision` é inteiro JSON entre 0 e `Number.MAX_SAFE_INTEGER`; `limit` é opcional, 1–100, padrão 20. Retorna `200` e `Cache-Control: no-store`, inclusive quando registros são inválidos:

```json
{"importId":"<importId>","mappingRevision":1,"contentSha256":"<sha256>","normalizationProfile":"pt-BR-v1","summary":{"totalRows":2,"validRows":1,"invalidRows":1},"limit":20,"sampleTruncated":false,"rows":[{"recordNumber":1,"valid":true,"data":{"sku":"ABC-1","stock":7,"priceInCents":29990},"errors":[]},{"recordNumber":2,"valid":false,"data":null,"errors":[{"fieldKey":"priceInCents","code":"FIELD.INVALID_CURRENCY","message":"Value must be a currency amount in pt-BR format."}]}]}
```

`summary` cobre o arquivo inteiro. `rows` é apenas prefixo, com teto de 1 MiB de JSON; `sampleTruncated` pode ser `true` com amostra vazia se o primeiro item exceder o orçamento. `recordNumber` começa em 1 no primeiro registro lógico de dados, não em uma linha física quando há campo multilinha.

Conflitos: `IMPORT.PREVIEW_NOT_ALLOWED`, `IMPORT.MAPPING_INCOMPLETE`, `IMPORT.MAPPING_REVISION_CONFLICT` e `IMPORT.FILE_CHANGED` (409). Limite lido no preview: `413`; CSV inválido: `422`; storage/stream indisponível: `503 IMPORT.PREVIEW_UNAVAILABLE`. O preview não persiste dados nem muda status ou revisão. Após confirmação (`queued`+), preview fica bloqueado.

## Confirmação e processamento

### `POST /imports/:importId/confirm`

API key ou token da sessão. Corpo estrito:

```json
{"expectedMappingRevision":1,"expectedContentSha256":"<64 hex minúsculos>"}
```

Retorna `202` rapidamente (não processa o CSV na requisição):

```json
{"importId":"<uuid>","executionId":"<uuid>","status":"queued","expectedMappingRevision":1,"expectedContentSha256":"<sha>","progress":{"processedRows":0,"totalRows":2,"validRows":0,"invalidRows":0},"failure":null,"replayed":false}
```

Exige sessão `uploaded`, mapping completo, revisão e hash iguais ao snapshot. Cria uma `ImportExecution`, enfileira BullMQ com `jobId` determinístico e congela mapping/arquivo. Replay com o mesmo snapshot devolve a mesma execução (`replayed: true`) sem segundo job. Snapshot diferente após confirmação: `409 IMPORT.MAPPING_REVISION_CONFLICT` ou `IMPORT.FILE_CHANGED`. Outros: `409 IMPORT.CONFIRMATION_NOT_ALLOWED` / `IMPORT.MAPPING_INCOMPLETE`, `503 IMPORT.PROCESSING_UNAVAILABLE`.

O worker (mesmo processo em desenvolvimento) relê o objeto, recalcula SHA-256, reutiliza parser/normalizadores, persiste válidos/inválidos em batches e marca `ready` só após persistência consistente; falha definitiva → `processing_failed` (não reutiliza `upload_failed`), com remoção atômica de qualquer `ImportRecord` parcial. Retries limitados cobrem falhas transitórias de infra; mapping inválido, hash divergente e CSV estrutural são `UnrecoverableError`. Um reconciliador periódico no mesmo processo republica jobs determinísticos ausentes para execuções `queued`/`processing` sem criar nova execução. `failure` público aparece em GET sessão/contexto e no replay de confirm quando `processing_failed`.

### `GET /imports/:importId/rejected-rows`

Cursor pagination das linhas inválidas do snapshot `ready`:

```http
GET /imports/:importId/rejected-rows?limit=50&after=<cursor>
```

```json
{"data":[{"recordNumber":2,"errors":[{"fieldKey":"priceInCents","code":"FIELD.INVALID_CURRENCY","message":"..."}]}],"nextCursor":null}
```

Sem payload normalizado e sem CSV bruto. `limit` máximo = `IMPORT_REJECTED_ROWS_MAX_LIMIT` (padrão 50, teto 200). Antes de `ready`: `409 IMPORT.SNAPSHOT_NOT_READY`. Aceita API key ou token de importação da sessão.

### `GET /imports/:importId/valid-rows`

Entrega paginada dos registros **válidos** normalizados do snapshot `ready` para o backend do sistema cliente. **Somente API key** (`oi_live_`); token de importação recebe `403 AUTH.INSUFFICIENT_SCOPE`.

```http
GET /imports/:importId/valid-rows?limit=50&after=<cursor>
```

```json
{"importId":"<uuid>","executionId":"<uuid>","data":[{"recordNumber":1,"data":{"sku":"TEN-001","priceInCents":29990}}],"nextCursor":"<opaque-or-null>"}
```

- `data[].data` é exatamente o payload persistido (sem CSV bruto, sem erros de inválidos, sem IDs internos).
- Ordenação fixa por `recordNumber` ASC; paginação por keyset (`limit + 1`), cursor opaco versionado ligado à `executionId`.
- Sem válidos: `200`, `data: []`, `nextCursor: null`.
- `limit` padrão 50; máximo público 100, limitado também por `IMPORT_VALID_ROWS_MAX_LIMIT` (padrão 100).
- Antes de `ready` (sessão ou execução): `409 IMPORT.SNAPSHOT_NOT_READY`.
- Cursor malformado ou de outra execução: `400 VALIDATION.FAILED`.
- Outra organização: `404 IMPORT.NOT_FOUND`.
- Leitura não altera status, progresso nem registros. `Cache-Control: no-store`.
- Orçamento de resposta por bytes pode ser adicionado depois; o arquivo já é limitado por `IMPORT_MAX_FILE_BYTES`.

## Walkthrough reproduzível

Com API local e `API_KEY` privado configurado, a partir de `backend/`, use os arquivos em [`examples/`](examples/). No PowerShell:

```powershell
$api = 'http://localhost:3000/api/v1'
$h = @{ Authorization = "Bearer $env:API_KEY" }
$template = Invoke-RestMethod "$api/templates" -Method Post -Headers $h -ContentType 'application/json' -InFile docs/examples/products-template.json
$session = Invoke-RestMethod "$api/imports" -Method Post -Headers ($h + @{ 'Idempotency-Key' = 'docs-import-001' }) -ContentType 'application/json' -Body (@{ templateId = $template.id } | ConvertTo-Json)
curl.exe -X POST "$api/imports/$($session.id)/file" -H "Authorization: Bearer $env:API_KEY" -F "file=@docs/examples/products-invalid.csv;type=text/csv"
$mapping = Invoke-RestMethod "$api/imports/$($session.id)/mapping" -Headers $h
$body = @{ expectedRevision = $mapping.revision; mappings = @(@{columnPosition=0;fieldKey='sku'},@{columnPosition=1;fieldKey='stock'},@{columnPosition=2;fieldKey='priceInCents'}) } | ConvertTo-Json -Depth 3
$saved = Invoke-RestMethod "$api/imports/$($session.id)/mapping" -Method Put -Headers $h -ContentType 'application/json' -Body $body
Invoke-RestMethod "$api/imports/$($session.id)/preview" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ expectedMappingRevision=$saved.revision; limit=20 } | ConvertTo-Json)
$session = Invoke-RestMethod "$api/imports/$($session.id)" -Headers $h
$confirm = Invoke-RestMethod "$api/imports/$($session.id)/confirm" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ expectedMappingRevision=$saved.revision; expectedContentSha256=$session.contentSha256 } | ConvertTo-Json)
do { Start-Sleep -Milliseconds 200; $session = Invoke-RestMethod "$api/imports/$($session.id)" -Headers $h } while ($session.status -in @('queued','processing'))
Invoke-RestMethod "$api/imports/$($session.id)/rejected-rows?limit=50" -Headers $h
Invoke-RestMethod "$api/imports/$($session.id)/valid-rows?limit=50" -Headers $h
```

Em Bash, use `curl` com os mesmos caminhos/corpos e `API_KEY` como variável de ambiente. O CSV inválido retorna 200 no preview, com 1 linha válida normalizada para centavos e linhas inválidas detalhadas; veja [fixtures](csv-and-normalization.md#fixtures-documentais). `valid-rows` exige a API key organizacional — não use o token do navegador.

## Divergências conhecidas com OpenAPI

- Runtime pode retornar `AUTH.INVALID_API_KEY` ou `AUTH.INVALID_IMPORT_TOKEN`, mas o exemplo do DTO 401 apresenta `AUTH.MISSING_BEARER`.
- Preview e emissão de token enviam `Cache-Control: no-store`; emissão está descrita no OpenAPI, preview ainda não descreve o header.
- Erros de `Idempotency-Key` são `VALIDATION.FAILED` genéricos; não há DTO dedicado.

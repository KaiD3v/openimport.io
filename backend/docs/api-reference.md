# Referência HTTP

Base da API de negócio: `/api/v1`. Todas as rotas de negócio exigem `Authorization: Bearer <api-key>`. `GET /health`, `GET /health/ready`, `/docs` e `/docs-json` quando habilitados, e o fallback de rota inexistente são públicos. A organização é inferida; recurso de outra organização responde `404`, não `403`.

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

`name` tem 1–100 caracteres após trim e é único por organização. Há 1–50 fields; `key` é única e segue `^[a-z][a-zA-Z0-9]{0,63}$`, `label` tem 1–120 e `type` é `string`, `integer` ou `currency`. `required` é booleano real. Erros: `400 VALIDATION.FAILED`, `401 AUTH.*`, `409 TEMPLATE.NAME_CONFLICT`.

### `GET /templates/:templateId`

UUID obrigatório; retorna o mesmo formato (`200`) ou `400 VALIDATION.FAILED`, `401 AUTH.*`, `404 TEMPLATE.NOT_FOUND`.

## Sessões e upload

### `POST /imports`

Headers: Bearer, `Content-Type: application/json`, `Idempotency-Key`. Corpo: `{"templateId":"<uuid>"}`. A chave tem 8–128 caracteres `[A-Za-z0-9._-]`.

Retorna `201` com:

```json
{"id":"<importId>","templateId":"<templateId>","status":"created","originalFilename":null,"byteSize":null,"contentSha256":null,"encoding":null,"delimiter":null,"dataRowCount":null,"columns":[],"uploadedAt":null,"createdAt":"<iso>","updatedAt":"<iso>"}
```

Repetir mesma chave e mesmo template retorna a mesma sessão (`201`); mesma chave com template diferente retorna `409 IDEMPOTENCY.KEY_REUSED`. Outros erros: `400 VALIDATION.FAILED`, `401 AUTH.*`, `404 TEMPLATE.NOT_FOUND`.

### `POST /imports/:importId/file`

Bearer e `multipart/form-data`, com exatamente um arquivo no campo `file`, sem campos texto. Aceita extensão `.csv` ou MIME CSV, `application/octet-stream` ou `text/plain`. Retorna `201` na mesma forma de sessão, agora `uploaded` e com metadata/colunas.

Erros: `400 VALIDATION.FAILED` (multipart), `401`, `404 IMPORT.NOT_FOUND`, `409 IMPORT.FILE_ALREADY_UPLOADED` ou `IMPORT.UPLOAD_NOT_ALLOWED`, `413 IMPORT.FILE_TOO_LARGE`, `422 IMPORT.INVALID_CSV`. Ao exceder o limite de bytes, a sessão permanece `created`; uma falha de parsing depois que o objeto foi gravado tenta cleanup e muda a sessão para `upload_failed`. Upload não tem idempotência; não faça retry cego.

### `GET /imports/:importId`

Retorna `200` com a sessão, incluindo campos nullable de metadata; antes do upload eles são `null` e `columns` é `[]`. Erros: `400`, `401`, `404 IMPORT.NOT_FOUND`.

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

Conflitos: `IMPORT.PREVIEW_NOT_ALLOWED`, `IMPORT.MAPPING_INCOMPLETE`, `IMPORT.MAPPING_REVISION_CONFLICT` e `IMPORT.FILE_CHANGED` (409). Limite lido no preview: `413`; CSV inválido: `422`; storage/stream indisponível: `503 IMPORT.PREVIEW_UNAVAILABLE`. O preview não persiste dados nem muda status ou revisão.

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
```

Em Bash, use `curl` com os mesmos caminhos/corpos e `API_KEY` como variável de ambiente. O CSV inválido retorna 200 no preview, com 1 linha válida normalizada para centavos e linhas inválidas detalhadas; veja [fixtures](csv-and-normalization.md#fixtures-documentais).

## Divergências conhecidas com OpenAPI

- Runtime pode retornar `AUTH.INVALID_API_KEY`, mas o exemplo do DTO 401 apresenta apenas `AUTH.MISSING_BEARER`.
- Preview envia `Cache-Control: no-store`, não descrito no OpenAPI.
- Erros de `Idempotency-Key` são `VALIDATION.FAILED` genéricos; não há DTO dedicado.

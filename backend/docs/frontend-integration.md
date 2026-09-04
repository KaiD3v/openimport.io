# Contrato para frontend

## Contratos existentes

As rotas abaixo são relativas à base `/api/v1`.

O backend da organização autentica com `Authorization: Bearer <api-key>` (`oi_live_…`). Essa chave **não** deve ir para o navegador, bundles, `localStorage` ou query strings.

Para o frontend, o backend da organização emite um token de importação (`oi_import_…`) com `POST /imports/:importId/access-tokens` e entrega o valor **uma vez** ao cliente. O frontend deve guardar o token **somente em memória** (estado da aba), nunca em cookie, `localStorage` ou URL.

1. Crie ou recupere externamente um `templateId` (API key, no servidor). Só existem `POST /templates` e `GET /templates/:templateId`; não há listagem.
2. Crie a sessão em `POST /imports`, com API key de organização e `Idempotency-Key` estável por tentativa lógica. Repetir mesma chave e payload retorna a mesma sessão; chave reutilizada com outro template retorna conflito.
3. Emita `POST /imports/:importId/access-tokens` com a API key. A resposta `201` traz `accessToken`, `tokenType: "Bearer"`, `importId` e `expiresAt`, com `Cache-Control: no-store`.
4. Com o token, o navegador pode: `GET /imports/:importId`, `GET /imports/:importId/context`, `POST /imports/:importId/file`, `GET`/`PUT /imports/:importId/mapping`, `POST /imports/:importId/preview`, `POST /imports/:importId/confirm` e `GET /imports/:importId/rejected-rows`.
5. Envie um único `file` em `POST /imports/:importId/file`. Após sucesso, não reenvie. Em `upload_failed`, a sessão não é recuperável para upload: crie outra sessão (com a API key).
6. Consulte sessão, `GET /imports/:importId/context` ou `GET /imports/:importId/mapping` para obter colunas, template e revisão.
7. Salve todo o mapping com `PUT /imports/:importId/mapping` e `expectedRevision` atual. Associe posição de coluna a field, nunca texto do header.
8. Quando `isComplete`, execute `POST /imports/:importId/preview` com `expectedMappingRevision` da resposta de mapping.
9. Confirme com `POST /imports/:importId/confirm` (`expectedMappingRevision` + `expectedContentSha256`). A resposta `202` deixa a sessão em `queued`; faça poll em `GET /imports/:importId` até `ready` ou `processing_failed`. Após confirmação, mapping não pode mais ser alterado.
10. Com `ready`, consulte `GET /imports/:importId/rejected-rows` (cursor). Entrega de válidos ao cliente ainda não existe nesta fatia.

O token vale só para o `importId` vinculado. Outra sessão da mesma organização responde `404 IMPORT.NOT_FOUND`. Criar sessão, emitir outro token ou acessar templates com o token responde `403 AUTH.INSUFFICIENT_SCOPE`. Token expirado, revogado, desconhecido ou cuja API key emissora esteja revogada responde `401 AUTH.INVALID_IMPORT_TOKEN` sem detalhar o motivo.

Não há endpoints de listagem/histórico, cancelamento nem webhook. Não há endpoint público de revogação; `revokedAt` é considerado na validação.

## Recomendações para a interface

- Mantenha IDs retornados pelo backend no estado do fluxo; não tente descobrir sessões ou templates por uma rota inexistente.
- Em `409 IMPORT.MAPPING_REVISION_CONFLICT`, recarregue mapping, apresente a alteração concorrente e só reenvie após decisão do usuário. Não faça retry indiscriminado.
- Após qualquer mapping que altere revisão, invalide o preview mostrado. Um preview é associado ao `mappingRevision` e `contentSha256` retornados.
- Trate `200` de preview como transporte bem-sucedido, não como todas as linhas válidas. Use `summary`, `rows[].valid` e `rows[].errors`; `data:null` é esperado na linha inválida.
- Mostre aviso se `sampleTruncated` for `true`: a amostra é prefixo e pode estar vazia pelo orçamento, enquanto `summary` ainda cobre tudo.
- Não cacheie preview/confirm (`Cache-Control: no-store`). Após confirm, mostre progresso a partir de `progress` sem inventar percentual se `totalRows` for null. Em `processing_failed`, use `failure.code` / `failure.message` (`null` quando não houver falha — campo sempre presente).
- Diferencie `400/401/403/404/409/413/422/503` de erro por linha. Exiba `code` e `traceId` para suporte, sem registrar CSV, API key ou token de importação.

## Autenticação no navegador

Não embuta a API key organizacional no frontend. O contrato suportado é o token `oi_import_` emitido pelo backend da organização, restrito a uma sessão, com TTL entre 60 e 3600 segundos (padrão 1800). Não há login de usuário, cookies, OAuth nem refresh token.

## Decisões ainda necessárias

- Autenticação de usuário final (login), RBAC geral e gestão HTTP de API keys.
- Onde persistir IDs e idempotency keys do fluxo do cliente.
- UI para retomada após falha de upload e para conflitos de mapping.
- Confirmação do import e integração posterior com o sistema cliente.

Detalhes de cada payload e código estão em [Referência HTTP](api-reference.md); regras de CSV em [CSV e normalização](csv-and-normalization.md).

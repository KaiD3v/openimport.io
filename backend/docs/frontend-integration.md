# Contrato para frontend

## Contratos existentes

As rotas abaixo são relativas à base `/api/v1` e exigem `Authorization: Bearer <api-key>`.

1. Crie ou recupere externamente um `templateId`. Só existem `POST /templates` e `GET /templates/:templateId`; não há listagem.
2. Crie a sessão em `POST /imports`, com API key de organização e `Idempotency-Key` estável por tentativa lógica. Repetir mesma chave e payload retorna a mesma sessão; chave reutilizada com outro template retorna conflito.
3. Envie um único `file` em `POST /imports/:importId/file`. Após sucesso, não reenvie. Em `upload_failed`, a sessão não é recuperável para upload: crie outra sessão.
4. Consulte sessão e `GET /imports/:importId/mapping` para obter colunas e revisão.
5. Salve todo o mapping com `PUT /imports/:importId/mapping` e `expectedRevision` atual. Associe posição de coluna a field, nunca texto do header.
6. Quando `isComplete`, execute `POST /imports/:importId/preview` com `expectedMappingRevision` da resposta de mapping.

Não há endpoints de listagem/histórico, progresso, cancelamento, confirmação nem aplicação definitiva. O fluxo atual termina em preview.

## Recomendações para a interface

- Mantenha IDs retornados pelo backend no estado do fluxo; não tente descobrir sessões ou templates por uma rota inexistente.
- Em `409 IMPORT.MAPPING_REVISION_CONFLICT`, recarregue mapping, apresente a alteração concorrente e só reenvie após decisão do usuário. Não faça retry indiscriminado.
- Após qualquer mapping que altere revisão, invalide o preview mostrado. Um preview é associado ao `mappingRevision` e `contentSha256` retornados.
- Trate `200` de preview como transporte bem-sucedido, não como todas as linhas válidas. Use `summary`, `rows[].valid` e `rows[].errors`; `data:null` é esperado na linha inválida.
- Mostre aviso se `sampleTruncated` for `true`: a amostra é prefixo e pode estar vazia pelo orçamento, enquanto `summary` ainda cobre tudo.
- Não cacheie preview (`Cache-Control: no-store`). Não indique processamento ou confirmação assíncrona: não existem.
- Diferencie `400/401/404/409/413/422/503` de erro por linha. Exiba `code` e `traceId` para suporte, sem registrar CSV ou API key.

## Autenticação no navegador: pendência

O contrato atual requer API key de organização no Bearer. A autenticação de usuários em navegador não está implementada, e embutir uma API key organizacional no frontend não é solução aceitável.

Alternativas futuras a decidir incluem um backend intermediário que mantenha a chave no servidor ou uma credencial restrita de curta duração. Nenhuma delas é capacidade existente.

## Decisões ainda necessárias

- Autenticação/autorização de usuário, escopos e emissão de credenciais para browser.
- Onde persistir IDs e idempotency keys do fluxo do cliente.
- UI para retomada após falha de upload e para conflitos de mapping.
- Confirmação do import e integração posterior com o sistema cliente.

Detalhes de cada payload e código estão em [Referência HTTP](api-reference.md); regras de CSV em [CSV e normalização](csv-and-normalization.md).

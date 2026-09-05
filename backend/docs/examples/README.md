# Fixtures de documentação

Dados sintéticos para walkthrough HTTP, preview `pt-BR-v1` e o laboratório do frontend (`/dev`).

| Ficheiro | Uso |
| --- | --- |
| [`products-template.json`](products-template.json) | Corpo de `POST /templates`. O botão **Criar sessão** em `/dev` lê este arquivo em cada clique (`frontend/scripts/create-lab-session.mjs`). |
| [`products-valid.csv`](products-valid.csv) | CSV alinhado às `key` `sku`, `stock`, `priceInCents`. |
| [`products-invalid.csv`](products-invalid.csv) | Mesmas colunas, com linhas inválidas para preview/rejected-rows. |

## Mudar o template do laboratório

Edite `products-template.json` e clique outra vez em **Criar sessão**. Não é preciso reiniciar o Vite. O lab publica o template como `<name> lab <timestamp>` (evita `TEMPLATE.NAME_CONFLICT`).

Se mudar as `key` ou a ordem dos fields, atualize os CSV desta pasta. O mapping sugerido no README da raiz assume coluna `#0` → `sku`, `#1` → `stock`, `#2` → `priceInCents`.

Contrato de `name` / `fields` / `type`: [Referência HTTP](../api-reference.md#post-templates). Walkthrough: [Referência HTTP](../api-reference.md#walkthrough-reproduzível).

# CSV e normalização

## Parsing

São aceitos CSV UTF-8, com ou sem BOM UTF-8; BOM fragmentado é removido uma vez. UTF-16, UTF-8 inválido, bytes nulos e conteúdo provavelmente binário são rejeitados. Só há delimitadores `,` e `;`; ambos presentes fora de aspas tornam o arquivo ambíguo e inválido. Aspas escapadas e campos/header multilinha são aceitos.

O header é o primeiro registro lógico, limitado a 64 KiB de scan sem contar BOM. Ele não pode estar vazio, ter nomes vazios/duplicados, mais de `IMPORT_MAX_COLUMNS` colunas ou field acima de `IMPORT_MAX_FIELD_BYTES`. Linhas de dados precisam ter exatamente a mesma quantidade de campos e ao menos uma linha é obrigatória.

O parser identifica dados pela posição da coluna e preserva espaços (`trim: false`). Antes de normalizar qualquer tipo, o backend aplica `trim()` às bordas da célula. Linhas vazias são ignoradas. `recordNumber` é 1-based e conta registros lógicos de dados, não o header nem linhas físicas adicionais de campos multilinha.

## Streaming, limites e falhas

`HashAndLimitTransform` conta bytes e calcula SHA-256 incrementalmente. O upload envia ao storage e depois relê o objeto para parse; preview relê e re-hasheia para confirmar integridade.

O scanner é incremental, reconhece CRLF fragmentado e aspas entre chunks. Antes do `csv-parse`, um coalescedor coloca quatro `LF` de padding após registro completo para permitir emissão sem esperar EOF. Esse padding é interno, depende de `skip_empty_lines` e é posterior ao hashing: não muda o hash do objeto.

Limites padrão configuráveis: arquivo 5 MiB, 10.000 linhas de dados, 50 colunas e 65.536 bytes por field. Há limite por registro e buffer bruto dimensionados pelas combinações de fields/colunas. O parser mantém buffering limitado por registro e callbacks sequenciais; isso não é promessa de memória constante para qualquer arquivo.

Falha de callback, CSV ou stream aborta o input sem aguardar EOF. `CsvParseError` tem precedência na propagação; erro de leitura do storage não é mascarado como CSV inválido.

## Perfil `pt-BR-v1`

String: recebe o valor com espaços externos removidos; espaços internos e zeros à esquerda são preservados. Vazio após trim em field obrigatório gera `FIELD.REQUIRED`; em opcional o field é omitido.

Integer também recebe o valor já sem espaços externos e aceita sinal opcional e apenas dígitos (`+42`, `-7`, `0`, ` 7 ` → `7`); deve caber em inteiro seguro JavaScript. Rejeita `1.000`, `1,000`, `1.5`, `1e3`, `0x10` e espaços internos (`7 0`).

Currency recebe o valor já sem espaços externos, em unidades monetárias, e retorna centavos inteiros. Aceita `299`, `299,9`, `299,90`, `R$ 299,90`, `1.234,56`, `1.234` e sinal após `R$`; por exemplo `299,90` resulta `29990`. Rejeita formato US (`299.90`, `1,234.56`), milhares mal agrupados, mais de duas casas, expoente, `NaN`, espaços internos e valores fora de inteiro seguro. A exceção é somente após o prefixo opcional `R$` maiúsculo: espaços ASCII ou NBSP são permitidos antes do sinal/valor.

Qualquer erro faz a linha inteira ter `valid:false` e `data:null`, com erros por field. Preview não é validação de regras de negócio.

## Fixtures documentais

- [`examples/products-valid.csv`](examples/products-valid.csv) normaliza preço `299,90` para `29990`.
- [`examples/products-invalid.csv`](examples/products-invalid.csv) preserva uma primeira linha válida e inclui preço em formato US, inteiro inválido e campo obrigatório vazio. No walkthrough, o resultado esperado é `totalRows: 4`, `validRows: 1`, `invalidRows: 3`.

Amostra do preview é limitada por `limit` (1–100, padrão 20) e 1 MiB de JSON. Estatísticas são completas, mas a amostra pode ser truncada ou vazia por orçamento.

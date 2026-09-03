# Decisões e limitações

Estas decisões descrevem o estado observado no repositório; não atribuem autoria nem assumem cronologia além das migrations versionadas.

| Decisão atual | Evidência e consequência |
| --- | --- |
| Integração por API | Templates, sessões, upload, mapping e preview são HTTP; não existe acesso ao banco do cliente. |
| API keys no estágio atual | Organização é derivada do Bearer hash; não há login de usuário/browser. |
| Storage separado do banco | CSV fica em S3/MinIO; PostgreSQL guarda metadata, colunas e mapping. |
| Revisão otimista do mapping | `expectedRevision` protege substituição concorrente; no-op não incrementa. |
| Preview síncrono e não persistido | Releitura completa acontece na requisição; não grava rows nem confirma importação. |
| Perfil monetário explícito | `pt-BR-v1` transforma unidades em centavos e evita inferência de locale. |
| Limites separados | Bytes, rows, columns, fields, records e resposta de preview têm controles distintos. |
| Parser sem API privada | Streaming usa componentes públicos e `csv-parse`, com scanner/coalescedor próprio. |

## Limitações conhecidas

Não há listagem, histórico, confirmação, integração cliente, workers, filas, progresso, cancelamento, retry automático, XLSX, outros encodings/delimitadores, tipos além de string/integer/currency, retenção programada ou readiness de storage.

## Próximos passos possíveis, não comprometidos

- Autenticação de usuário e credenciais restritas para browser.
- Confirmação atômica que revalide revisão e identidade do arquivo.
- Worker/fila, progresso e política de retries.
- Gestão e rotação de API keys, RBAC, auditoria e rate limiting.
- Retenção, exclusão, observabilidade e readiness abrangendo storage.
- Listagem/histórico, XLSX e perfis de normalização adicionais.

Consulte [Arquitetura](architecture.md) e [Segurança e operação](security-and-operations.md) antes de transformar qualquer item em contrato.

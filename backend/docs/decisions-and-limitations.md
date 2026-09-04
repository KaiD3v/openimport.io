# Decisões e limitações

Estas decisões descrevem o estado observado no repositório; não atribuem autoria nem assumem cronologia além das migrations versionadas.

| Decisão atual | Evidência e consequência |
| --- | --- |
| Integração por API | Templates, sessões, upload, mapping e preview são HTTP; não existe acesso ao banco do cliente. |
| API keys no estágio atual | Organização é derivada do Bearer hash; login de usuário não existe. |
| Token de importação | Credencial `oi_import_` opaca, hashed, TTL 60–3600s, ligada a uma sessão; deixa de autenticar se expirar, for revogada, não existir ou se a API key emissora estiver revogada. O frontend não recebe a API key. |
| Storage separado do banco | CSV fica em S3/MinIO; PostgreSQL guarda metadata, colunas e mapping. |
| Revisão otimista do mapping | `expectedRevision` protege substituição concorrente; no-op não incrementa. |
| Preview síncrono e não persistido | Releitura completa acontece na requisição; não grava rows. |
| Confirmação idempotente + worker | `POST .../confirm` CAS + BullMQ; snapshot só em `ready`. |
| Perfil monetário explícito | `pt-BR-v1` transforma unidades em centavos e evita inferência de locale. |
| Limites separados | Bytes, rows, columns, fields, records, batch de persistência e resposta de preview têm controles distintos. |
| Parser sem API privada | Streaming usa componentes públicos e `csv-parse`, com scanner/coalescedor próprio. |

## Limitações conhecidas

Não há listagem, histórico, registro de resultado do cliente, webhook `import.ready`, cancelamento, DLQ completa, XLSX, outros encodings/delimitadores, tipos além de string/integer/currency, retenção programada ou readiness de storage/Redis.

## Próximos passos possíveis, não comprometidos

- Autenticação de usuário, gestão/rotação de API keys, RBAC, auditoria e rate limiting.
- Entrega paginada de registros válidos e ack do cliente.
- Webhook `import.ready` assinado.
- DLQ/bull-board e processo worker dedicado.
- Retenção, exclusão, observabilidade e readiness abrangendo storage/Redis.
- Listagem/histórico, XLSX e perfis de normalização adicionais.

Consulte [Arquitetura](architecture.md) e [Segurança e operação](security-and-operations.md) antes de transformar qualquer item em contrato.

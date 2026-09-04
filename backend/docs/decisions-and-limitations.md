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
| Webhook `import.ready` assinado | Outbox na txn de ready + snapshot autocontido (URL, payload, ciphertext); HTTP pinado (um DNS por tentativa); HMAC-SHA256; PUT/DELETE só no futuro. |
| Retenção de CSV no storage | Após TTL (`IMPORT_FILE_RETENTION_HOURS`), cleaner remove objeto de sessões `ready`/`processing_failed` com claim/CAS; PG mantém sessão, records e results. |
| Perfil monetário explícito | `pt-BR-v1` transforma unidades em centavos e evita inferência de locale. |
| Limites separados | Bytes, rows, columns, fields, records, batch de persistência e resposta de preview têm controles distintos. |
| Parser sem API privada | Streaming usa componentes públicos e `csv-parse`, com scanner/coalescedor próprio. |

## Limitações conhecidas

Não há listagem, histórico, cancelamento, DLQ completa, XLSX, outros encodings/delimitadores, tipos além de string/integer/currency, retenção de `ImportRecord`/results/webhook deliveries, nem dashboard de webhooks/multi-evento. Retenção automática remove só o CSV no object storage após TTL para `ready`/`processing_failed`; não limpa órfãos sem `storageObjectKey` nem aplica lifecycle nativo do bucket.

## Próximos passos possíveis, não comprometidos

- Autenticação de usuário, gestão/rotação de API keys, RBAC, auditoria e rate limiting.
- DLQ/bull-board e processo worker dedicado.
- Retenção/exclusão de sessões e registros no PostgreSQL; lifecycle de bucket para órfãos.
- Listagem/histórico, XLSX e perfis de normalização adicionais.
- Webhooks genéricos além de `import.ready`, dashboard de deliveries, retry manual por HTTP e DLQ administrativa.

Consulte [Arquitetura](architecture.md) e [Segurança e operação](security-and-operations.md) antes de transformar qualquer item em contrato.

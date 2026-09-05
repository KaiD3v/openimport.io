const CAPABILITIES = [
  { key: 'CSV', body: 'Um arquivo por sessão, com tipo, tamanho e estado visíveis.' },
  { key: 'Mapping', body: 'Associação coluna → campo, sem duplicar destinos.' },
  { key: 'Normalização', body: 'Perfil pt-BR-v1, inclusive moeda para centavos.' },
  { key: 'Preview', body: 'Amostra com totais, válidas, inválidas e erros por campo.' },
  { key: 'Processamento', body: 'Fila e worker após o snapshot congelado.' },
  { key: 'Rejeições', body: 'Consulta paginada do snapshot, sem CSV bruto.' },
  { key: 'API cliente', body: 'O backend hospedeiro consome os registros válidos.' },
  { key: 'Webhooks', body: 'Notificação import.ready assinada para o host.' },
] as const

export function HomeCapabilities() {
  return (
    <div className="oi-home-capabilities" aria-labelledby="oi-cap-title">
      <h3 id="oi-cap-title">Capacidades do MVP</h3>
      <ul className="oi-capability-board">
        {CAPABILITIES.map((item) => (
          <li key={item.key}>
            <strong className="oi-mono">{item.key}</strong>
            <p>{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

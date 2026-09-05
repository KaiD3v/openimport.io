import { HomeCapabilities } from './HomeCapabilities.tsx'

const PIPELINE = [
  {
    index: '01',
    title: 'Upload',
    body: 'O host cria a sessão. O operador envia um CSV.',
  },
  {
    index: '02',
    title: 'Mapear',
    body: 'Coluna → campo por posição, não pelo texto do header.',
  },
  {
    index: '03',
    title: 'Validar',
    body: 'Preview pt-BR-v1 com campo, linha e motivo.',
  },
  {
    index: '04',
    title: 'Processar',
    body: 'Confirmação congela o snapshot. Worker em fila.',
  },
  {
    index: '05',
    title: 'Entregar',
    body: 'Registros válidos para a API cliente. Persistência fica no host.',
  },
] as const

export function HomePipeline() {
  return (
    <section
      className="oi-section oi-home-band oi-home-band-panel"
      id="pipeline"
      aria-labelledby="oi-flow-title"
    >
      <h2 id="oi-flow-title">Como funciona</h2>
      <p>
        Pipeline contínuo até um snapshot confiável. O OpenImport não consulta
        nem grava o banco do sistema cliente.
      </p>
      <ol className="oi-flow-rail oi-flow-rail-five">
        {PIPELINE.map((step) => (
          <li key={step.index}>
            <span className="oi-flow-index">{step.index}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <HomeCapabilities />
    </section>
  )
}

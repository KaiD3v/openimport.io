export function HomeExample() {
  return (
    <section
      className="oi-section oi-home-band"
      id="exemplo"
      aria-labelledby="oi-example-title"
    >
      <h2 id="oi-example-title">Normalização em centavos</h2>
      <p>
        Moeda em reais torna-se inteiro. O restante do mapping vive na composição
        do hero — aqui só o contrato que o backend cliente recebe.
      </p>
      <p className="oi-money-transform" aria-label="R$ 299,90 vira 29990">
        <span className="oi-mono">R$ 299,90</span>
        <span aria-hidden="true"> → </span>
        <span className="oi-mono">29990</span>
        <span className="oi-mono"> · priceInCents</span>
      </p>
    </section>
  )
}

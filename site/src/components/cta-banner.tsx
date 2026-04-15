export function CtaBanner() {
  return (
    <section className="bg-forest py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6 text-center">
        <h2 className="text-3xl md:text-[2.5rem] md:leading-tight text-cream mb-6">
          Comece a transformar sua clínica hoje
        </h2>

        <p className="text-cream/70 text-lg md:text-xl max-w-xl mx-auto mb-10 leading-relaxed">
          Teste grátis por 14 dias. Sem cartão de crédito. Cancele quando
          quiser.
        </p>

        <a
          href="#"
          className="btn-primary bg-cream text-forest hover:bg-blush inline-flex text-base px-10 py-4"
        >
          Começar Grátis
        </a>
      </div>
    </section>
  );
}

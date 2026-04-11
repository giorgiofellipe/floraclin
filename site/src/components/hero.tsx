import Image from "next/image";

export function Hero() {
  return (
    <section className="relative bg-cream pt-32 pb-16 md:pt-44 md:pb-32 overflow-hidden">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="max-w-3xl mx-auto text-center">
          {/* Tagline */}
          <p className="section-label mb-6">
            Onde o cuidado floresce. Do atendimento ao financeiro.
          </p>

          {/* Headline */}
          <h1 className="text-4xl md:text-[4rem] md:leading-[1.1] leading-tight mb-6">
            A gestão da sua clínica de HOF, do jeito certo.
          </h1>

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-charcoal/80 leading-relaxed mb-10 max-w-2xl mx-auto">
            Agenda, prontuário, financeiro e procedimentos — tudo integrado em
            uma plataforma feita exclusivamente para Harmonização Orofacial.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <a href="#" className="btn-primary text-base px-10 py-4">
              Começar Grátis
            </a>
            <a href="#" className="btn-secondary text-base px-10 py-4">
              Agendar uma Demo
            </a>
          </div>

          {/* Social proof */}
          <p className="text-sm text-mid">
            Utilizado por clínicas de HOF em todo o Brasil
          </p>
        </div>

        {/* Hero image placeholder */}
        <div className="mt-16 md:mt-24 mx-auto max-w-4xl">
          <div className="relative rounded-2xl overflow-hidden bg-white border border-sage/10 shadow-2xl shadow-forest/5 aspect-video flex items-center justify-center">
            <div className="text-center p-12">
              <Image
                src="/brand/logo-sage.svg"
                alt=""
                width={48}
                height={48}
                className="mx-auto mb-4 opacity-30"
              />
              <p className="text-mid text-sm">
                Screenshot do dashboard — em breve
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

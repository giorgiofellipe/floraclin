const STEPS = [
  {
    number: "1",
    title: "Cadastre sua clínica",
    description:
      "Configure procedimentos, equipe e horários em minutos.",
  },
  {
    number: "2",
    title: "Gerencie o dia a dia",
    description:
      "Agenda, pacientes, atendimentos e financeiro em um só lugar.",
  },
  {
    number: "3",
    title: "Acompanhe resultados",
    description:
      "Relatórios, P&L por profissional e visão completa do negócio.",
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="bg-white py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-16 md:mb-20">
          <p className="section-label mb-4">Como Funciona</p>
          <h2 className="text-3xl md:text-[2.5rem] md:leading-tight">
            Simples de configurar, poderoso de usar
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16">
          {STEPS.map((step) => (
            <div key={step.number} className="text-center">
              {/* Numbered circle */}
              <div className="w-16 h-16 rounded-full bg-forest text-cream flex items-center justify-center mx-auto mb-6">
                <span className="font-serif text-2xl font-medium">
                  {step.number}
                </span>
              </div>

              <h3 className="text-xl md:text-2xl mb-3">{step.title}</h3>
              <p className="text-charcoal/70 leading-relaxed max-w-xs mx-auto">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

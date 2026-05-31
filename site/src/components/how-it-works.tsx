const STEPS = [
  {
    number: "1",
    title: "Configure em minutos",
    description:
      "Cadastre sua equipe, procedimentos e horários. Modelos de termos e avaliação já vêm prontos.",
  },
  {
    number: "2",
    title: "Paciente já chega preparado",
    description:
      "Um link pelo WhatsApp e o paciente preenche a anamnese pelo celular. Quando chega na clínica, o prontuário já tem tudo.",
  },
  {
    number: "3",
    title: "Atenda e documente",
    description:
      "Siga o fluxo guiado: avaliação, diagrama facial, fotos, planejamento, execução. Tudo registrado automaticamente no prontuário.",
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

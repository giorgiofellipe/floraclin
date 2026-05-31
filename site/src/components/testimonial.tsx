import { Quote } from "lucide-react";

const TESTIMONIALS = [
  {
    quote:
      "O diagrama facial e o fluxo de atendimento mudaram minha rotina. Cada aplicação fica documentada passo a passo, sem esquecer nada.",
    name: "Dr. Rafael Mendes",
    role: "Proprietário, Clínica Estética RM (São Paulo)",
  },
  {
    quote:
      "O antes e depois com alinhamento automático impressiona meus pacientes. Eles veem a diferença real e confiam mais no tratamento.",
    name: "Dra. Juliana Ferreira",
    role: "Harmonizadora Orofacial, Studio JF (Curitiba)",
  },
  {
    quote:
      "Saí do papel e do WhatsApp em uma semana. O paciente agenda sozinho, preenche a anamnese pelo celular e o financeiro, parcelas, comissões, despesas, está tudo no mesmo lugar. Não volto atrás.",
    name: "Dra. Camila Ribeiro",
    role: "Proprietária, Clínica Harmonize (Belo Horizonte)",
  },
];

export function Testimonial() {
  return (
    <section className="bg-petal py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-12">
          <p className="section-label mb-4">Depoimentos</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="text-center">
              <Quote size={32} className="text-sage/30 mx-auto mb-6" />
              <blockquote className="font-serif text-lg md:text-xl leading-snug text-forest mb-6">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <p className="font-medium text-forest">{t.name}</p>
              <p className="text-mid text-sm mt-1">{t.role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Quote } from "lucide-react";
import { FadeIn } from "./fade-in";

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

function getInitials(name: string): string {
  const parts = name.replace(/^(Dr\.|Dra\.)\s*/i, "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Testimonial() {
  return (
    <section className="relative bg-petal py-16 md:py-32 overflow-hidden">
      {/* Large decorative quote mark — background */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -left-8 md:-top-4 md:left-4 w-[200px] md:w-[280px] h-auto opacity-[0.05]"
        viewBox="0 0 280 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M60 180 C60 140 80 110 120 90 C100 110 95 130 95 150 C95 170 110 185 130 185 C150 185 165 170 165 150 C165 120 145 100 110 100 C70 100 40 130 40 180 C40 210 55 230 80 230Z"
          fill="#4A6B52"
        />
        <path
          d="M175 180 C175 140 195 110 235 90 C215 110 210 130 210 150 C210 170 225 185 245 185 C265 185 280 170 280 150 C280 120 260 100 225 100 C185 100 155 130 155 180 C155 210 170 230 195 230Z"
          fill="#4A6B52"
        />
      </svg>

      <div className="relative mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-12">
          <p className="section-label mb-4">Depoimentos</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
          {TESTIMONIALS.map((t) => (
            <FadeIn key={t.name}>
              <div className="text-center">
                <Quote size={32} className="text-sage/30 mx-auto mb-6" />
                <blockquote className="font-serif text-lg md:text-xl leading-snug text-forest mb-6">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>

                {/* Avatar initials */}
                <div className="w-12 h-12 rounded-full bg-forest text-cream flex items-center justify-center mx-auto mb-3">
                  <span className="text-sm font-medium tracking-wide">
                    {getInitials(t.name)}
                  </span>
                </div>

                <p className="font-medium text-forest">{t.name}</p>
                <p className="text-mid text-sm mt-1">{t.role}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

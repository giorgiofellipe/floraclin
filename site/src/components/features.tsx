import {
  PenTool,
  ClipboardList,
  FileText,
  CalendarDays,
  DollarSign,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: PenTool,
    title: "Diagrama Facial Interativo",
    description:
      "Mapeie pontos de aplicação diretamente no rosto do paciente. Registre produto, profundidade e quantidade em cada ponto — com visualização em tempo real.",
  },
  {
    icon: ClipboardList,
    title: "Fluxo de Atendimento Completo",
    description:
      "Da anamnese à execução, com aprovação do paciente no meio. Avaliação \u2192 planejamento \u2192 aprovação com assinatura digital \u2192 execução \u2192 acompanhamento. Sem perder nenhuma etapa.",
  },
  {
    icon: FileText,
    title: "Prontuário Digital Completo",
    description:
      "Anamnese (preenchida pelo paciente no celular), fotos de evolução, diagrama facial, termos com assinatura digital e timeline completa — tudo no prontuário do paciente.",
  },
  {
    icon: CalendarDays,
    title: "Agenda Inteligente",
    description:
      "Visualização por profissional com sobreposição de horários. Página pública de agendamento, integração com Google Calendar e confirmações via WhatsApp.",
  },
  {
    icon: DollarSign,
    title: "Financeiro Automatizado",
    description:
      "Cobranças, parcelas com vencimento personalizado, multas e juros automáticos, renegociação, estorno e P&L por profissional. Sem planilha, sem erro.",
  },
  {
    icon: ShieldCheck,
    title: "Assinatura Digital de Termos",
    description:
      "Contratos e termos de consentimento assinados digitalmente pelo paciente e profissional. Modelos prontos para toxina botulínica, preenchedor e bioestimulador.",
  },
];

export function Features() {
  return (
    <section id="recursos" className="bg-cream py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-16 md:mb-20">
          <p className="section-label mb-4">Recursos</p>
          <h2 className="text-3xl md:text-[2.5rem] md:leading-tight max-w-2xl mx-auto">
            Tudo que sua clínica precisa — e nada que não precisa
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="feature-card">
                <div className="w-12 h-12 rounded-xl bg-sage/10 flex items-center justify-center mb-6">
                  <Icon size={24} className="text-sage" />
                </div>
                <h3 className="text-xl md:text-2xl mb-3">{feature.title}</h3>
                <p className="text-charcoal/70 leading-relaxed text-[0.95rem]">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

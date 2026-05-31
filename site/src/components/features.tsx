import {
  PenTool,
  GitCompareArrows,
  Aperture,
  ClipboardList,
  ShieldCheck,
  Smartphone,
  DollarSign,
  Package,
  CalendarDays,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface FeatureGroup {
  label: string;
  features: Feature[];
}

const GROUPS: FeatureGroup[] = [
  {
    label: "Precisão Clínica Visual",
    features: [
      {
        icon: PenTool,
        title: "Diagrama Facial Interativo",
        description:
          "Mapeie cada ponto de aplicação no rosto do paciente. Produto, profundidade, quantidade e localização exata, tudo registrado visualmente e vinculado ao prontuário.",
      },
      {
        icon: GitCompareArrows,
        title: "Antes e Depois que Convence",
        description:
          "O sistema alinha as fotos automaticamente para que a comparação seja justa. Seu paciente vê o resultado real, você documenta com precisão.",
      },
      {
        icon: Aperture,
        title: "Captura Guiada + Anotações",
        description:
          "Guia de pose na câmera (frontal, perfil, oblíquo) com captura automática quando o rosto está alinhado e em foco. Anote com setas, círculos e régua de medição.",
      },
    ],
  },
  {
    label: "Fluxo sem Atrito",
    features: [
      {
        icon: ClipboardList,
        title: "Atendimento Guiado Passo a Passo",
        description:
          "O sistema conduz o fluxo: anamnese, avaliação, planejamento, aprovação, execução, acompanhamento. Você só segue. Nenhuma etapa esquecida.",
      },
      {
        icon: ShieldCheck,
        title: "Assinatura Digital pelo WhatsApp",
        description:
          "Termos de consentimento e contratos assinados pelo paciente no celular, direto pelo link no WhatsApp. 100% seguro, sem papel, sem complicação.",
      },
      {
        icon: Smartphone,
        title: "Anamnese e Agendamento Self-service",
        description:
          "O paciente agenda online e preenche a anamnese pelo celular antes da consulta. Sem cadastro, sem senha, sem ligar pra clínica.",
      },
    ],
  },
  {
    label: "Gestão do Negócio",
    features: [
      {
        icon: DollarSign,
        title: "Financeiro Completo",
        description:
          "Cobranças parceladas, despesas recorrentes, comissão por profissional, multa e juros automáticos, renegociação e estorno. Em breve: links de pagamento por PIX, boleto e cartão.",
      },
      {
        icon: Package,
        title: "Pacotes e Controle de Sessões",
        description:
          "Venda pacotes de procedimentos e acompanhe sessões realizadas vs. contratadas. Sem planilha, sem erro.",
      },
      {
        icon: CalendarDays,
        title: "Agenda com Google Calendar",
        description:
          "Visualização por profissional, agendamento online pelo paciente e sincronização bidirecional com Google Calendar. Sem conflito de horário.",
      },
    ],
  },
];

export function Features() {
  return (
    <section id="recursos" className="bg-cream py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-16 md:mb-20">
          <p className="section-label mb-4">Recursos</p>
          <h2 className="text-3xl md:text-[2.5rem] md:leading-tight max-w-2xl mx-auto">
            Feito para HOF. Não adaptado de outro sistema.
          </h2>
        </div>

        <div className="space-y-16 md:space-y-20">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sage mb-8 text-center">
                {group.label}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                {group.features.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div key={feature.title} className="feature-card">
                      <div className="w-12 h-12 rounded-xl bg-sage/10 flex items-center justify-center mb-6">
                        <Icon size={24} className="text-sage" />
                      </div>
                      <h3 className="text-xl md:text-2xl mb-3">
                        {feature.title}
                      </h3>
                      <p className="text-charcoal/70 leading-relaxed text-[0.95rem]">
                        {feature.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Check } from "lucide-react";

const SHARED_FEATURES = [
  "Diagrama facial interativo",
  "Comparação antes e depois com alinhamento automático",
  "Captura guiada com pose e auto-take",
  "Anotações em foto (setas, círculos, régua)",
  "Fluxo completo de atendimento guiado",
  "Confirmação e lembrete automático de consultas",
  "Anamnese self-service pelo celular",
  "Assinatura digital de termos e contratos",
  "CRM de pacientes com tags e acompanhamento",
  "Agendamento online (página pública)",
  "Integração WhatsApp bidirecional",
  "Sincronização com Google Calendar",
  "Prontuário digital com timeline de evolução",
  "Pacotes de procedimentos com controle de sessões",
  "Financeiro com parcelas, comissões e despesas",
  "Lembretes de aniversário",
  "Suporte por WhatsApp",
];

const PLANS = [
  {
    slug: "free",
    name: "Teste Grátis",
    price: "R$ 0",
    period: "por 14 dias",
    badge: "Sem cartão de crédito",
    highlights: [
      "Todas as funcionalidades",
      "20 créditos de WhatsApp/mês",
      "2 usuários",
      "WhatsApp integrado (número FloraClin)",
    ],
    cta: "Começar Grátis",
    featured: false,
  },
  {
    slug: "starter",
    name: "Starter",
    price: "R$ 99",
    period: "/mês",
    badge: "Mais popular",
    highlights: [
      "300 créditos de WhatsApp/mês",
      "5 usuários",
      "Pacientes ilimitados",
      "Número próprio de WhatsApp",
    ],
    cta: "Assinar Starter",
    featured: true,
  },
  {
    slug: "pro",
    name: "Pro",
    price: "R$ 199",
    period: "/mês",
    badge: "Para clínicas maiores",
    highlights: [
      "1000 créditos de WhatsApp/mês",
      "Usuários ilimitados",
      "Pacientes ilimitados",
      "Número próprio de WhatsApp",
    ],
    cta: "Assinar Pro",
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="precos" className="py-20 md:py-32 bg-white">
      <div className="mx-auto max-w-[1200px] px-6">
        {/* Label */}
        <div className="text-center mb-12">
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.2em] text-sage mb-4">
            PREÇOS
          </p>
          <h2 className="font-serif text-3xl md:text-[2.5rem] font-medium text-charcoal leading-tight">
            Simples e transparente
          </h2>
          <p className="text-mid mt-3 max-w-lg mx-auto">
            Teste grátis por 14 dias e escolha o plano que acompanha o tamanho
            da sua clínica. Todos os planos incluem todas as funcionalidades.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto mb-16">
          {PLANS.map((plan) => (
            <div
              key={plan.slug}
              className={`rounded-2xl border p-8 flex flex-col ${
                plan.featured
                  ? "border-forest bg-cream shadow-md relative"
                  : "border-sage/15 bg-cream/50 shadow-sm"
              }`}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-forest px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-cream">
                  {plan.badge}
                </span>
              )}
              <div className="text-center mb-6">
                <h3 className="font-serif text-xl font-medium text-charcoal mb-3">
                  {plan.name}
                </h3>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-serif text-4xl font-medium text-forest">
                    {plan.price}
                  </span>
                  <span className="text-sm text-mid">{plan.period}</span>
                </div>
                {!plan.featured && (
                  <p className="text-sage text-xs font-medium mt-2">{plan.badge}</p>
                )}
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.highlights.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <Check className="w-4 h-4 text-sage mt-0.5 shrink-0" />
                    <span className="text-sm text-charcoal">{item}</span>
                  </li>
                ))}
              </ul>

              <a
                href="https://app.floraclin.com.br/signup"
                className={`block w-full text-center font-sans font-medium text-sm uppercase tracking-wider py-3.5 rounded-lg transition-colors no-underline ${
                  plan.featured
                    ? "bg-forest text-cream hover:bg-sage"
                    : "border border-forest text-forest hover:bg-forest hover:text-cream"
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-mid mb-16 -mt-10">
          Sem cartão de crédito para começar. Cancele quando quiser.
        </p>

        {/* Shared features */}
        <div className="mx-auto max-w-3xl">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-sage mb-6">
            TUDO INCLUSO EM TODOS OS PLANOS
          </p>
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {SHARED_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check className="w-4 h-4 text-sage mt-0.5 shrink-0" />
                <span className="text-sm text-charcoal">{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

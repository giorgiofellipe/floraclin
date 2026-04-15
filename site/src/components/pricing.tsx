"use client";

import { useState } from "react";
import { Check } from "lucide-react";

const FEATURES = [
  "Agenda inteligente com visualização por profissional",
  "Prontuário digital completo",
  "Diagrama facial interativo",
  "Anamnese digital (preenchida pelo paciente)",
  "Assinatura digital de termos e contratos",
  "Financeiro com parcelas, multas e juros",
  "P&L por profissional",
  "Página pública de agendamento",
  "Confirmações via WhatsApp",
  "Fluxo completo de atendimento",
  "Fotos de evolução",
  "Relatórios e insights",
  "Usuários ilimitados (recepcionista, financeiro)",
  "Suporte por WhatsApp",
];

export function Pricing() {
  const [annual, setAnnual] = useState(true);

  const price = annual ? 74 : 89;
  const period = annual ? "/mês (cobrado anualmente)" : "/mês";
  const savings = annual ? "Economize R$180/ano por profissional" : null;

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
            Um plano, tudo incluso. Pague apenas pelos profissionais que atendem.
            Recepcionistas e equipe financeira são gratuitos.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mb-12">
          <span
            className={`text-sm font-medium transition-colors ${
              !annual ? "text-charcoal" : "text-mid"
            }`}
          >
            Mensal
          </span>
          <button
            type="button"
            onClick={() => setAnnual(!annual)}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              annual ? "bg-forest" : "bg-blush"
            }`}
            aria-label="Alternar entre plano mensal e anual"
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                annual ? "translate-x-7" : "translate-x-0"
              }`}
            />
          </button>
          <span
            className={`text-sm font-medium transition-colors ${
              annual ? "text-charcoal" : "text-mid"
            }`}
          >
            Anual
          </span>
          {annual && (
            <span className="ml-2 rounded-full bg-mint/20 px-2.5 py-0.5 text-xs font-medium text-forest">
              -17%
            </span>
          )}
        </div>

        {/* Pricing card */}
        <div className="mx-auto max-w-lg">
          <div className="rounded-2xl border border-sage/15 bg-cream p-8 md:p-10 shadow-sm">
            {/* Header */}
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sage mb-2">
                14 DIAS GRÁTIS
              </p>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-sm text-mid">R$</span>
                <span className="font-serif text-6xl font-medium text-forest">
                  {price}
                </span>
              </div>
              <p className="text-mid text-sm mt-1">
                por profissional{period}
              </p>
              {savings && (
                <p className="text-sage text-xs font-medium mt-2">
                  {savings}
                </p>
              )}
            </div>

            {/* CTA */}
            <a
              href="https://app.floraclin.com.br/login"
              className="block w-full text-center bg-forest text-cream font-sans font-medium text-sm uppercase tracking-wider py-4 rounded-lg hover:bg-sage transition-colors no-underline"
            >
              Começar Grátis — 14 Dias
            </a>

            <p className="text-center text-xs text-mid mt-3">
              Sem cartão de crédito. Cancele quando quiser.
            </p>

            {/* Divider */}
            <div className="border-t border-sage/10 my-8" />

            {/* Features */}
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sage mb-4">
              TUDO INCLUSO
            </p>
            <ul className="space-y-3">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <Check className="w-4 h-4 text-sage mt-0.5 shrink-0" />
                  <span className="text-sm text-charcoal">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

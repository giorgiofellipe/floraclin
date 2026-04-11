import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    question: "Preciso instalar alguma coisa?",
    answer:
      "Não. FloraClin funciona 100% no navegador, no computador ou celular. Nada para instalar.",
  },
  {
    question: "Funciona para clínicas com mais de um profissional?",
    answer:
      "Sim. A agenda mostra todos os profissionais lado a lado, com controle de acesso por perfil (proprietário, profissional, recepcionista, financeiro).",
  },
  {
    question: "Meus pacientes precisam criar conta?",
    answer:
      "Não. O paciente recebe um link por WhatsApp para preencher a anamnese. Sem cadastro, sem senha.",
  },
  {
    question: "Como funciona o financeiro?",
    answer:
      "Cobranças com parcelas, vencimentos personalizados, multa e juros automáticos, renegociação e estorno. Tudo integrado ao extrato e ao P&L por profissional.",
  },
  {
    question: "Posso migrar meus dados de outro sistema?",
    answer: "Sim. Entre em contato conosco e ajudamos na migração.",
  },
  {
    question: "Quanto custa?",
    answer:
      "Período de teste gratuito de 14 dias. Após isso, planos a partir de R$ XX/mês.",
  },
];

export function Faq() {
  return (
    <section className="bg-white py-16 md:py-32">
      <div className="mx-auto max-w-[800px] px-6">
        <div className="text-center mb-16 md:mb-20">
          <p className="section-label mb-4">Perguntas Frequentes</p>
          <h2 className="text-3xl md:text-[2.5rem] md:leading-tight">
            Tire suas dúvidas
          </h2>
        </div>

        <div className="flex flex-col gap-4">
          {FAQS.map((faq) => (
            <details
              key={faq.question}
              className="group bg-cream rounded-2xl border border-sage/10"
            >
              <summary className="flex items-center justify-between gap-4 px-6 py-5 md:px-8 md:py-6">
                <span className="font-medium text-forest text-base md:text-lg">
                  {faq.question}
                </span>
                <ChevronDown
                  size={20}
                  className="faq-chevron text-sage shrink-0"
                />
              </summary>
              <div className="px-6 pb-5 md:px-8 md:pb-6 -mt-1">
                <p className="text-charcoal/70 leading-relaxed">
                  {faq.answer}
                </p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

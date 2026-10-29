import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { isReferralRulesPagePublished, referralRewardsEndAt } from "@/lib/referral-lookup";
import {
  REFERRAL_BONUS_CREDITS_PER_EXTRA,
  REFERRAL_END_NOTICE_DAYS,
  REFERRAL_MAX_COUNTING_FOR_DISCOUNT,
  REFERRAL_NEW_CLINIC_WINDOW_MONTHS,
  REFERRAL_PERCENT_PER_REFERRAL,
  REFERRAL_TRIAL_DAYS,
  REFERRAL_WELCOME_MONTHS,
  REFERRAL_WELCOME_PERCENT,
  referralDiscountTable,
} from "@/lib/referral-rules";

export const metadata: Metadata = {
  title: "Indique e Ganhe FloraClin: Regras",
  description: "Regras do programa Indique e Ganhe FloraClin: quem pode indicar, como o desconto é calculado e o que não conta.",
  alternates: { canonical: "/indique" },
};

function formatEndDate(at: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(at);
}

export default async function IndiquePage() {
  if (!(await isReferralRulesPagePublished())) notFound();
  const endAt = referralRewardsEndAt();

  return (
    <>
      <Navigation />
      <main className="bg-cream min-h-screen pt-32 pb-16">
        <div className="mx-auto max-w-[720px] px-6">
          <h1 className="text-3xl md:text-4xl mb-4">Indique e Ganhe FloraClin: Regras</h1>
          <p className="text-charcoal/50 text-sm mb-8">Última atualização: 21 de outubro de 2026</p>

          {endAt && (
            <p className="mb-8 rounded-[3px] border border-sage/30 bg-mint/20 px-4 py-3 text-[15px] text-forest">
              O programa será encerrado em {formatEndDate(endAt)}.
            </p>
          )}

          <div className="text-charcoal/80 leading-relaxed space-y-8 text-[15px]">
            <section>
              <h2 className="text-xl mb-3">1. A regra em uma frase</h2>
              <p>
                Cada clínica indicada que está pagando vale {REFERRAL_PERCENT_PER_REFERRAL}% de desconto na sua
                assinatura. Com {REFERRAL_MAX_COUNTING_FOR_DISCOUNT}, o FloraClin sai de graça.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">2. Quem pode indicar</h2>
              <p>
                Clínicas com assinatura paga ativa do FloraClin (paga por cartão, pelo nosso sistema de pagamento).
                Clínicas em teste gratuito, em plano de cortesia ou com a assinatura encerrada não têm link ativo.
                Válido para planos mensais.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">3. O que a clínica indicada ganha</h2>
              <p>
                O teste normal de {REFERRAL_TRIAL_DAYS} dias, mais {REFERRAL_WELCOME_PERCENT}% de desconto nas{" "}
                {REFERRAL_WELCOME_MONTHS} primeiras mensalidades pagas do plano mensal, aplicado automaticamente pelo
                link. Não acumula com outras ofertas de entrada: vale a melhor delas.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">4. Como o desconto é calculado</h2>
              <table className="w-full max-w-sm border-collapse text-left">
                <thead>
                  <tr className="border-b border-charcoal/15">
                    <th className="py-2 pr-4 font-medium">Indicações que contam</th>
                    <th className="py-2 font-medium">Desconto</th>
                  </tr>
                </thead>
                <tbody>
                  {referralDiscountTable().map((row) => (
                    <tr key={row.counting} className="border-b border-charcoal/10">
                      <td className="py-2 pr-4">{row.counting}</td>
                      <td className="py-2">
                        {row.percent}%{row.percent === 100 ? " (grátis)" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3">
                {REFERRAL_MAX_COUNTING_FOR_DISCOUNT + 1} ou mais: 100% + {REFERRAL_BONUS_CREDITS_PER_EXTRA} créditos de
                WhatsApp por mês para cada clínica além da {REFERRAL_MAX_COUNTING_FOR_DISCOUNT}ª. O mês do bônus é o mês
                civil no horário de Brasília; planos ilimitados não recebem o bônus.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">5. Quando uma indicação conta</h2>
              <p>
                A partir da 2ª mensalidade paga do plano mensal da clínica indicada. A indicação fica pausada enquanto
                há pagamento pendente ou cancelamento agendado, e deixa de contar quando a assinatura é cancelada. Uma
                clínica que cancela e volta não conta de novo. Uma mudança no desconto vale a partir da{" "}
                <strong>próxima</strong> fatura, nunca proporcional. Descontos já aplicados nunca são retirados.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">6. Quem não conta</h2>
              <div className="space-y-3">
                <p>
                  Só contam clínicas novas no FloraClin (sem uso nos {REFERRAL_NEW_CLINIC_WINDOW_MONTHS} meses antes do
                  cadastro, por e-mail, telefone, registro profissional ou cartão).
                </p>
                <p>
                  Não vale autoindicação (mesma clínica ou profissional, e-mail, domínio da empresa, telefone,
                  registro, usuário ou cartão).
                </p>
                <p>Disputas de pagamento (chargebacks) tornam a indicação inelegível.</p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">7. Sem dinheiro</h2>
              <p>
                As recompensas são apenas desconto na assinatura da própria clínica no FloraClin e créditos de
                WhatsApp. Não há pagamento em dinheiro, Pix, crédito ou transferência, e as recompensas se perdem sem
                uma assinatura.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">8. Como divulgar</h2>
              <p>
                Identifique sempre o benefício com <strong>#publi #linkafiliado</strong> (CONAR). Sem fotos de antes e
                depois, imagens de pacientes, promessas de resultado ou superlativos. É a recomendação de uma
                ferramenta de gestão para colegas.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">9. Encerramento do programa</h2>
              <p>
                Se a FloraClin decidir encerrar o programa, avisaremos com pelo menos {REFERRAL_END_NOTICE_DAYS} dias de
                antecedência. A partir do aviso, novas indicações deixam de ser aceitas. Os descontos existentes
                continuam seguindo a contagem até a data de encerramento e passam a 0% a partir da fatura seguinte.
                Descontos já aplicados em faturas emitidas nunca são cobrados de volta.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

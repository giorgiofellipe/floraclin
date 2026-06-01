import type { Metadata } from "next";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Termos de Uso — FloraClin",
  description:
    "Termos de uso da plataforma FloraClin para gestão de clínicas de Harmonização Orofacial.",
  alternates: { canonical: "/termos" },
};

export default function TermosPage() {
  return (
    <>
      <Navigation />
      <main className="bg-cream min-h-screen pt-32 pb-16">
        <div className="mx-auto max-w-[720px] px-6">
          <h1 className="text-3xl md:text-4xl mb-4">Termos de Uso</h1>
          <p className="text-charcoal/50 text-sm mb-12">
            Última atualização: 31 de maio de 2026
          </p>

          <div className="text-charcoal/80 leading-relaxed space-y-8 text-[15px]">
            <section>
              <h2 className="text-xl mb-3">1. Aceitação dos Termos</h2>
              <p>
                Ao acessar ou utilizar a plataforma FloraClin
                (&quot;Plataforma&quot;), operada por Bullcode Servicos em
                Tecnologia LTDA, CNPJ 27.435.275/0001-04
                (&quot;FloraClin&quot;, &quot;nós&quot;), você
                (&quot;Usuário&quot;, &quot;você&quot;) concorda integralmente com
                estes Termos de Uso. Caso não concorde, interrompa imediatamente o
                uso da Plataforma.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">2. Descrição do Serviço</h2>
              <p>
                A FloraClin é uma plataforma SaaS (Software como Serviço) de
                gestão clínica desenvolvida exclusivamente para clínicas de
                Harmonização Orofacial (HOF). Os serviços incluem, entre outros:
                agenda e agendamento online, prontuário eletrônico, diagrama
                facial interativo, gestão financeira, assinatura digital de
                documentos, captura e comparação de fotos clínicas, e
                comunicação com pacientes.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">3. Cadastro e Conta</h2>
              <div className="space-y-3">
                <p>
                  3.1. Para utilizar a Plataforma, é necessário criar uma conta
                  fornecendo informações verdadeiras, completas e atualizadas.
                </p>
                <p>
                  3.2. Você é responsável por manter a confidencialidade de suas
                  credenciais de acesso e por todas as atividades realizadas em
                  sua conta.
                </p>
                <p>
                  3.3. Cada conta é pessoal e intransferível. O compartilhamento
                  de credenciais é proibido.
                </p>
                <p>
                  3.4. Notifique-nos imediatamente caso suspeite de uso não
                  autorizado da sua conta.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">4. Planos e Pagamento</h2>
              <div className="space-y-3">
                <p>
                  4.1. A FloraClin oferece um período de teste gratuito de 14
                  dias. Após esse período, o acesso requer a contratação de um
                  plano pago.
                </p>
                <p>
                  4.2. A cobrança é realizada por profissional cadastrado que
                  realiza atendimentos. Usuários administrativos (recepção,
                  financeiro) não geram cobrança adicional.
                </p>
                <p>
                  4.3. Os valores podem ser alterados mediante aviso prévio de 30
                  dias. As alterações não afetam o período já contratado.
                </p>
                <p>
                  4.4. O cancelamento pode ser solicitado a qualquer momento e
                  será efetivado ao final do período de cobrança vigente.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">5. Uso Adequado</h2>
              <div className="space-y-3">
                <p>O Usuário se compromete a:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    Utilizar a Plataforma exclusivamente para fins lícitos e
                    relacionados à gestão de clínicas de saúde.
                  </li>
                  <li>
                    Não tentar acessar áreas restritas, sistemas ou servidores da
                    Plataforma sem autorização.
                  </li>
                  <li>
                    Não utilizar a Plataforma para armazenar ou transmitir
                    conteúdo ilegal, difamatório ou que viole direitos de
                    terceiros.
                  </li>
                  <li>
                    Manter a conformidade com todas as regulamentações aplicáveis
                    ao exercício de sua atividade profissional, incluindo as
                    normas dos conselhos profissionais competentes.
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">6. Dados e Conteúdo do Usuário</h2>
              <div className="space-y-3">
                <p>
                  6.1. Todos os dados inseridos na Plataforma pelo Usuário
                  (prontuários, fotos, documentos, dados financeiros) são de
                  propriedade do Usuário.
                </p>
                <p>
                  6.2. A FloraClin atua como operadora dos dados pessoais de
                  pacientes, conforme definido na LGPD. O Usuário (clínica) é o
                  controlador desses dados.
                </p>
                <p>
                  6.3. Em caso de cancelamento, os dados do Usuário serão
                  mantidos por 30 dias para possibilitar a exportação. Após esse
                  período, serão permanentemente excluídos.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">7. Propriedade Intelectual</h2>
              <p>
                Todo o conteúdo da Plataforma — incluindo código-fonte, design,
                marcas, textos e ilustrações — é de propriedade exclusiva da
                FloraClin e protegido pela legislação brasileira de propriedade
                intelectual. É proibida a reprodução, distribuição ou modificação
                sem autorização prévia e por escrito.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">8. Disponibilidade e Suporte</h2>
              <div className="space-y-3">
                <p>
                  8.1. A FloraClin se compromete a manter a Plataforma disponível
                  24 horas por dia, 7 dias por semana, exceto durante
                  manutenções programadas ou eventos de força maior.
                </p>
                <p>
                  8.2. O suporte é oferecido por WhatsApp em horário comercial
                  (segunda a sexta, das 9h às 18h, horário de Brasília).
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">9. Limitação de Responsabilidade</h2>
              <div className="space-y-3">
                <p>
                  9.1. A FloraClin não se responsabiliza por decisões clínicas
                  tomadas com base nas informações registradas na Plataforma. A
                  responsabilidade pelo atendimento ao paciente é exclusivamente
                  do profissional de saúde.
                </p>
                <p>
                  9.2. A FloraClin não será responsável por danos indiretos,
                  incidentais, especiais ou consequenciais decorrentes do uso ou
                  impossibilidade de uso da Plataforma.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">10. Alterações nos Termos</h2>
              <p>
                A FloraClin poderá alterar estes Termos a qualquer momento. As
                alterações serão comunicadas por e-mail ou notificação na
                Plataforma com antecedência mínima de 15 dias. O uso continuado
                após a entrada em vigor das alterações constitui aceitação dos
                novos termos.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">11. Rescisão</h2>
              <p>
                A FloraClin poderá suspender ou encerrar o acesso do Usuário em
                caso de violação destes Termos, mediante notificação prévia,
                exceto em casos de violação grave que justifiquem a suspensão
                imediata.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">12. Foro e Legislação Aplicável</h2>
              <p>
                Estes Termos são regidos pela legislação brasileira. Fica eleito o
                foro da comarca de São Paulo/SP para dirimir quaisquer
                controvérsias, com renúncia a qualquer outro, por mais
                privilegiado que seja.
              </p>
            </section>

            <section className="border-t border-sage/10 pt-8">
              <h2 className="text-xl mb-3">Contato</h2>
              <p>
                Para dúvidas sobre estes Termos de Uso, entre em contato pelo
                e-mail{" "}
                <a
                  href="mailto:contato@floraclin.com.br"
                  className="text-sage hover:underline"
                >
                  contato@floraclin.com.br
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

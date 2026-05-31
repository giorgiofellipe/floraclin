import type { Metadata } from "next";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "LGPD — FloraClin",
};

export default function LgpdPage() {
  return (
    <>
      <Navigation />
      <main className="bg-cream min-h-screen pt-32 pb-16">
        <div className="mx-auto max-w-[720px] px-6">
          <h1 className="text-3xl md:text-4xl mb-4">
            LGPD — Lei Geral de Proteção de Dados
          </h1>
          <p className="text-charcoal/50 text-sm mb-12">
            Última atualização: 31 de maio de 2026
          </p>

          <div className="text-charcoal/80 leading-relaxed space-y-8 text-[15px]">
            <section>
              <h2 className="text-xl mb-3">Nosso Compromisso</h2>
              <p>
                A FloraClin, operada por Bullcode Servicos em Tecnologia LTDA
                (CNPJ 27.435.275/0001-04), está
                comprometida com a conformidade à Lei Geral de Proteção de Dados
                Pessoais (Lei nº 13.709/2018 — LGPD). Esta página detalha como
                cumprimos as exigências da lei no tratamento de dados pessoais e
                dados sensíveis de saúde.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">Papéis no Tratamento de Dados</h2>
              <div className="space-y-3">
                <p>
                  A LGPD define diferentes papéis para quem trata dados pessoais.
                  Na FloraClin, esses papéis se distribuem da seguinte forma:
                </p>
                <ul className="list-disc pl-6 space-y-3">
                  <li>
                    <strong>Controlador:</strong> a clínica (Usuário da
                    FloraClin) é a controladora dos dados pessoais dos seus
                    pacientes. É a clínica que define quais dados coletar, por
                    que e como utilizá-los no contexto do atendimento clínico.
                  </li>
                  <li>
                    <strong>Operador:</strong> a FloraClin atua como operadora,
                    processando os dados em nome da clínica por meio da
                    Plataforma. Seguimos estritamente as instruções do
                    controlador e as obrigações legais.
                  </li>
                  <li>
                    <strong>Encarregado (DPO):</strong> a FloraClin designou um
                    encarregado pelo tratamento de dados pessoais, acessível
                    pelo e-mail{" "}
                    <a
                      href="mailto:privacidade@floraclin.com.br"
                      className="text-sage hover:underline"
                    >
                      privacidade@floraclin.com.br
                    </a>
                    .
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">Dados Sensíveis de Saúde</h2>
              <div className="space-y-3">
                <p>
                  A FloraClin trata dados sensíveis de saúde (Art. 5º, II da
                  LGPD), incluindo informações de anamnese, histórico clínico,
                  fotografias de procedimentos e diagramas faciais. O tratamento
                  desses dados é realizado com base nas seguintes garantias:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Base legal:</strong> tutela da saúde (Art. 7º, VIII)
                    e consentimento do titular quando aplicável (Art. 11, I).
                  </li>
                  <li>
                    <strong>Finalidade específica:</strong> os dados são
                    utilizados exclusivamente para registro clínico,
                    acompanhamento de tratamentos e documentação de
                    procedimentos.
                  </li>
                  <li>
                    <strong>Minimização:</strong> coletamos apenas os dados
                    estritamente necessários para a prestação do serviço
                    clínico.
                  </li>
                  <li>
                    <strong>Segurança reforçada:</strong> dados sensíveis contam
                    com criptografia em trânsito e em repouso, controle de
                    acesso granular e auditoria de acessos.
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">Medidas de Segurança</h2>
              <div className="space-y-3">
                <p>
                  Implementamos medidas técnicas e administrativas para proteger
                  os dados pessoais contra acessos não autorizados, situações
                  acidentais ou ilícitas de destruição, perda, alteração ou
                  comunicação:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Criptografia TLS/SSL em todas as comunicações</li>
                  <li>Criptografia de dados em repouso</li>
                  <li>Autenticação segura com hash irreversível de senhas (bcrypt)</li>
                  <li>Controle de acesso baseado em papéis (RBAC) com isolamento por tenant</li>
                  <li>Backups automatizados com retenção e testes de restauração</li>
                  <li>Monitoramento contínuo de segurança e logs de auditoria</li>
                  <li>Row Level Security (RLS) no banco de dados para isolamento multi-tenant</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">Direitos dos Titulares</h2>
              <div className="space-y-3">
                <p>
                  A LGPD garante aos titulares de dados pessoais os seguintes
                  direitos, que podem ser exercidos a qualquer momento:
                </p>
                <div className="bg-white rounded-xl border border-sage/10 p-6 space-y-3">
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">I.</span>
                    <p><strong>Confirmação e acesso</strong> — saber se tratamos seus dados e obter cópia</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">II.</span>
                    <p><strong>Correção</strong> — corrigir dados incompletos, inexatos ou desatualizados</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">III.</span>
                    <p><strong>Anonimização, bloqueio ou eliminação</strong> — de dados desnecessários ou tratados em desconformidade</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">IV.</span>
                    <p><strong>Portabilidade</strong> — transferir seus dados a outro prestador de serviço</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">V.</span>
                    <p><strong>Eliminação</strong> — excluir dados tratados com base no consentimento</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">VI.</span>
                    <p><strong>Informação</strong> — saber com quais entidades seus dados foram compartilhados</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">VII.</span>
                    <p><strong>Revogação</strong> — revogar o consentimento a qualquer momento</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-sage font-medium shrink-0">VIII.</span>
                    <p><strong>Oposição</strong> — opor-se ao tratamento quando realizado sem consentimento e em desconformidade com a lei</p>
                  </div>
                </div>
                <p>
                  Para exercer qualquer desses direitos, envie uma solicitação
                  para{" "}
                  <a
                    href="mailto:privacidade@floraclin.com.br"
                    className="text-sage hover:underline"
                  >
                    privacidade@floraclin.com.br
                  </a>
                  . Responderemos em até 15 dias úteis, conforme o Art. 18, §5º
                  da LGPD.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">Incidentes de Segurança</h2>
              <p>
                Em caso de incidente de segurança que possa acarretar risco ou
                dano relevante aos titulares, a FloraClin comunicará à Autoridade
                Nacional de Proteção de Dados (ANPD) e aos titulares afetados em
                prazo razoável, conforme o Art. 48 da LGPD, informando: a
                natureza dos dados afetados, os titulares envolvidos, as medidas
                técnicas adotadas e as medidas para reverter ou mitigar os
                efeitos do incidente.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">Transferência Internacional</h2>
              <p>
                Alguns dos nossos provedores de infraestrutura (hospedagem,
                armazenamento em nuvem) podem processar dados fora do Brasil. Nos
                comprometemos a utilizar apenas provedores que ofereçam nível de
                proteção compatível com a LGPD, conforme os Arts. 33 a 36 da
                lei.
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">Responsabilidades da Clínica</h2>
              <div className="space-y-3">
                <p>
                  Como controladora dos dados dos seus pacientes, a clínica é
                  responsável por:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Obter o consentimento adequado dos pacientes para o tratamento de dados</li>
                  <li>Informar os pacientes sobre a coleta e uso dos seus dados</li>
                  <li>Atender às solicitações dos titulares (pacientes) em relação aos seus direitos</li>
                  <li>Manter os termos de consentimento atualizados e adequados</li>
                  <li>Restringir o acesso aos dados apenas a profissionais autorizados</li>
                </ul>
                <p>
                  A FloraClin oferece ferramentas para facilitar o cumprimento
                  dessas obrigações, como termos de consentimento digitais com
                  assinatura eletrônica e controle de acesso por perfil de
                  usuário.
                </p>
              </div>
            </section>

            <section className="border-t border-sage/10 pt-8">
              <h2 className="text-xl mb-3">Contato do Encarregado (DPO)</h2>
              <p>
                Para exercer seus direitos, esclarecer dúvidas ou reportar
                incidentes relacionados à proteção de dados pessoais, entre em
                contato com nosso Encarregado de Proteção de Dados pelo e-mail{" "}
                <a
                  href="mailto:privacidade@floraclin.com.br"
                  className="text-sage hover:underline"
                >
                  privacidade@floraclin.com.br
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

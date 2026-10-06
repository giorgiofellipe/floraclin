import type { Metadata } from "next";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Política de Privacidade — FloraClin",
  description:
    "Como a FloraClin coleta, utiliza e protege dados pessoais de usuários e pacientes, em conformidade com a LGPD.",
  alternates: { canonical: "/privacidade" },
};

export default function PrivacidadePage() {
  return (
    <>
      <Navigation />
      <main className="bg-cream min-h-screen pt-32 pb-16">
        <div className="mx-auto max-w-[720px] px-6">
          <h1 className="text-3xl md:text-4xl mb-4">Política de Privacidade</h1>
          <p className="text-charcoal/50 text-sm mb-12">
            Última atualização: 6 de outubro de 2026
          </p>

          <div className="text-charcoal/80 leading-relaxed space-y-8 text-[15px]">
            <section>
              <h2 className="text-xl mb-3">1. Introdução</h2>
              <p>
                A FloraClin, operada por Bullcode Servicos em Tecnologia LTDA
                (CNPJ 27.435.275/0001-04), está
                comprometida com a proteção da privacidade dos seus usuários e
                dos pacientes atendidos por meio da Plataforma. Esta Política de
                Privacidade descreve como coletamos, utilizamos, armazenamos e
                protegemos os dados pessoais, em conformidade com a Lei Geral de
                Proteção de Dados (LGPD — Lei nº 13.709/2018).
              </p>
            </section>

            <section>
              <h2 className="text-xl mb-3">2. Dados que Coletamos</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-sans font-medium text-charcoal mb-2">
                    2.1. Dados dos Profissionais (Usuários)
                  </h3>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>Nome completo, e-mail, telefone, CPF/CNPJ</li>
                    <li>Registro profissional (CRO, CRM ou equivalente)</li>
                    <li>Dados de acesso (e-mail e senha criptografada)</li>
                    <li>Dados de uso da Plataforma (logs, preferências)</li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-base font-sans font-medium text-charcoal mb-2">
                    2.2. Dados dos Pacientes
                  </h3>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>Nome completo, data de nascimento, CPF, telefone, e-mail</li>
                    <li>Dados de saúde: anamnese, histórico clínico, alergias, medicações</li>
                    <li>Fotografias clínicas (antes/depois, registro de procedimentos)</li>
                    <li>Diagrama facial com pontos de aplicação</li>
                    <li>Termos de consentimento assinados digitalmente</li>
                    <li>Dados financeiros relacionados a pagamentos</li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-base font-sans font-medium text-charcoal mb-2">
                    2.3. Dados Coletados Automaticamente
                  </h3>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>Endereço IP, tipo de navegador, sistema operacional</li>
                    <li>Páginas acessadas e tempo de permanência</li>
                    <li>Cookies essenciais para funcionamento da Plataforma</li>
                    <li>
                      Quando você autoriza cookies de marketing: eventos de navegação e conversão
                      (por exemplo, visualização de página, cadastro concluído e assinatura),
                      identificadores de campanha e tecnologias similares do Meta Pixel.
                    </li>
                    <li>
                      Dados de atribuição de campanhas capturados no primeiro contato, como
                      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
                      gclid, página de entrada, referência e data de captura.
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">3. Como Utilizamos os Dados</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  <strong>Prestação do serviço:</strong> gerenciar a agenda,
                  prontuários, documentos e fluxos clínicos da sua clínica.
                </li>
                <li>
                  <strong>Comunicação:</strong> enviar notificações sobre
                  agendamentos, lembretes, atualizações da Plataforma e suporte.
                </li>
                <li>
                  <strong>Segurança:</strong> prevenir fraudes, acessos não
                  autorizados e garantir a integridade dos dados.
                </li>
                <li>
                  <strong>Melhoria do serviço:</strong> analisar padrões de uso
                  (de forma agregada e anonimizada) para aprimorar a
                  experiência.
                </li>
                <li>
                  <strong>Medição de marketing:</strong> quando houver consentimento,
                  medir a efetividade de anúncios, entender a origem de cadastros
                  e evitar duplicidade na mensuração de conversões.
                </li>
                <li>
                  <strong>Obrigações legais:</strong> cumprir exigências
                  regulatórias e responder a solicitações de autoridades
                  competentes.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl mb-3">4. Base Legal para o Tratamento</h2>
              <div className="space-y-3">
                <p>O tratamento de dados pessoais pela FloraClin se fundamenta nas seguintes bases legais da LGPD:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Execução de contrato</strong> (Art. 7º, V): para
                    prestar o serviço contratado pelo Usuário.
                  </li>
                  <li>
                    <strong>Consentimento</strong> (Art. 7º, I): para dados de
                    pacientes inseridos pelo Usuário na Plataforma e para cookies,
                    identificadores e eventos de marketing não essenciais, incluindo
                    Meta Pixel e atribuição de campanhas.
                  </li>
                  <li>
                    <strong>Tutela da saúde</strong> (Art. 7º, VIII): para dados
                    sensíveis de saúde dos pacientes.
                  </li>
                  <li>
                    <strong>Interesse legítimo</strong> (Art. 7º, IX): para
                    melhorias do serviço, segurança, prevenção a fraudes e métricas
                    agregadas que não dependam de cookies de marketing.
                  </li>
                  <li>
                    <strong>Obrigação legal</strong> (Art. 7º, II): para
                    cumprimento de exigências regulatórias.
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">5. Compartilhamento de Dados</h2>
              <div className="space-y-3">
                <p>
                  A FloraClin não vende, aluga ou compartilha dados pessoais com
                  terceiros para fins comerciais. Os dados podem ser
                  compartilhados apenas nas seguintes situações:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Provedores de infraestrutura:</strong> serviços de
                    hospedagem (Vercel, Supabase) e armazenamento em nuvem,
                    sujeitos a acordos de proteção de dados.
                  </li>
                  <li>
                    <strong>Processadores de pagamento:</strong> para viabilizar
                    cobranças e transações financeiras.
                  </li>
                  <li>
                    <strong>Obrigação legal:</strong> quando exigido por lei,
                    ordem judicial ou autoridade competente.
                  </li>
                  <li>
                    <strong>Medição de anúncios (Meta):</strong> quando a
                    clínica ativa a integração com a Meta (Facebook e
                    Instagram), dados de contato do paciente, como telefone e
                    e-mail, podem ser compartilhados com a Meta em formato
                    criptografado (hash), para medir o resultado de campanhas
                    publicitárias. A Meta recebe apenas o hash, nunca o dado
                    em texto claro.
                  </li>
                  <li>
                    <strong>Marketing próprio da FloraClin (Meta e Google Ads):</strong>
                    quando você aceita cookies de marketing em floraclin.com.br ou
                    app.floraclin.com.br, podemos compartilhar eventos de navegação
                    e conversão, identificadores online e parâmetros de campanha com
                    a Meta (Facebook/Instagram). Também poderemos usar Google Ads/gtag
                    no futuro para finalidades equivalentes de mensuração e anúncios,
                    sempre condicionado à categoria de marketing.
                  </li>
                </ul>
                <p>
                  A FloraClin não vende dados pessoais. O paciente que não deseja ter seus
                  dados usados na medição de anúncios da clínica pode solicitar a exclusão
                  diretamente com a clínica responsável pelo seu atendimento, a qualquer
                  momento. Visitantes e usuários podem recusar ou revogar cookies de
                  marketing conforme descrito na seção 9.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">6. Armazenamento e Segurança</h2>
              <div className="space-y-3">
                <p>
                  6.1. Os dados são armazenados em servidores seguros com
                  criptografia em trânsito (TLS/SSL) e em repouso.
                </p>
                <p>
                  6.2. O acesso aos dados é restrito a colaboradores autorizados,
                  mediante autenticação e controle de acesso baseado em papéis.
                </p>
                <p>
                  6.3. Realizamos backups regulares e monitoramento contínuo para
                  garantir a integridade e disponibilidade dos dados.
                </p>
                <p>
                  6.4. Senhas de usuários são armazenadas com hash criptográfico
                  irreversível (bcrypt).
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">7. Retenção de Dados</h2>
              <div className="space-y-3">
                <p>
                  7.1. Os dados são mantidos enquanto a conta estiver ativa e
                  pelo período necessário para cumprir obrigações legais.
                </p>
                <p>
                  7.2. Dados de saúde (prontuários) devem ser mantidos por no
                  mínimo 20 anos, conforme Resolução CFM nº 1.821/2007. O
                  Usuário (clínica) é responsável por essa retenção.
                </p>
                <p>
                  7.3. Após o cancelamento da conta, os dados são mantidos por 30
                  dias para exportação e, em seguida, excluídos
                  permanentemente, exceto quando a retenção for obrigatória por
                  lei.
                </p>
                <p>
                  7.4. Dados de atribuição de campanhas coletados com consentimento
                  (UTMs, fbclid, gclid, página de entrada, referência e data de captura)
                  são armazenados por até 90 dias em cookie/localStorage e podem ser
                  salvos no cadastro da clínica para mensuração do primeiro contato.
                  A escolha de consentimento fica armazenada até que você a altere ou
                  limpe os dados do navegador.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">8. Direitos do Titular</h2>
              <div className="space-y-3">
                <p>
                  Conforme a LGPD, você tem direito a:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Confirmar a existência de tratamento dos seus dados</li>
                  <li>Acessar os dados que mantemos sobre você</li>
                  <li>Corrigir dados incompletos, inexatos ou desatualizados</li>
                  <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários</li>
                  <li>Solicitar a portabilidade dos seus dados</li>
                  <li>Revogar o consentimento a qualquer momento</li>
                  <li>Obter informações sobre o compartilhamento dos seus dados</li>
                </ul>
                <p>
                  Para exercer esses direitos, entre em contato pelo e-mail{" "}
                  <a
                    href="mailto:contato@floraclin.com.br"
                    className="text-sage hover:underline"
                  >
                    contato@floraclin.com.br
                  </a>
                  . Responderemos em até 15 dias úteis.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">9. Cookies</h2>
              <div className="space-y-3">
                <p>
                  Utilizamos cookies e tecnologias similares em duas categorias:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Necessários:</strong> essenciais para autenticação,
                    segurança, preferências de sessão e funcionamento do site e da
                    Plataforma. Esses cookies ficam sempre ativos.
                  </li>
                  <li>
                    <strong>Marketing:</strong> opcionais. Incluem Meta Pixel e
                    tecnologias similares para medir campanhas, criar relatórios de
                    conversão, entender a origem de cadastros e apoiar anúncios da
                    FloraClin. Nesta categoria também capturamos parâmetros de campanha
                    como UTM, fbclid e gclid no primeiro contato.
                  </li>
                </ul>
                <p>
                  O Meta Pixel não é carregado e a atribuição de campanha não é gravada
                  antes do seu aceite da categoria marketing. Você pode aceitar, recusar
                  ou alterar sua escolha pelo banner de cookies ou pelo link
                  &quot;Preferências de cookies&quot; no rodapé.
                </p>
                <p>
                  Você também pode limitar anúncios personalizados diretamente nas
                  configurações da Meta/Facebook e, quando Google Ads estiver em uso,
                  nas configurações de anúncios do Google. As preferências do navegador
                  permitem bloquear ou apagar cookies, mas isso pode afetar funcionalidades
                  necessárias.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl mb-3">10. Alterações nesta Política</h2>
              <p>
                Esta Política pode ser atualizada periodicamente. Alterações
                relevantes serão comunicadas por e-mail ou notificação na
                Plataforma com antecedência mínima de 15 dias. Recomendamos a
                revisão periódica desta página.
              </p>
            </section>

            <section className="border-t border-sage/10 pt-8">
              <h2 className="text-xl mb-3">Contato</h2>
              <p>
                Para dúvidas sobre esta Política de Privacidade ou sobre o
                tratamento dos seus dados, entre em contato pelo e-mail{" "}
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

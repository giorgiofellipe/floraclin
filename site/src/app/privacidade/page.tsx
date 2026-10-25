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
            Última atualização: 25 de outubro de 2026
          </p>

          <div className="text-charcoal/80 leading-relaxed space-y-8 text-[15px]">
            <section>
              <h2 className="text-xl mb-3">1. Introdução</h2>
              <p>
                A FloraClin, operada por Bullcode Serviços em Tecnologia LTDA
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
                      Se você aceitar a categoria &quot;Anúncios e medição&quot;: eventos de
                      navegação e conversão (por exemplo, visualização de página, cadastro
                      concluído e assinatura) e os cookies do Meta Pixel.
                    </li>
                    <li>
                      Ao concluir o cadastro e ao contratar um plano pago: um evento enviado
                      pelo nosso servidor à Meta (API de Conversões), com e-mail e, quando
                      houver, telefone convertidos em hash SHA-256, endereço IP, navegador
                      (user agent), identificador de clique do anúncio (fbclid, enviado como
                      &quot;fbc&quot;), o cookie &quot;_fbp&quot; quando existir no seu navegador
                      (ele só é criado pelo Meta Pixel, após o seu aceite) e, na assinatura, o
                      valor e a moeda do plano. Esse envio acontece independentemente da
                      escolha no banner de cookies, com base no interesse legítimo (seções 4 e 5).
                    </li>
                    <li>
                      Dados do primeiro acesso ao site, guardados no cookie próprio
                      &quot;floraclin_ft&quot; (item 7.4): utm_source, utm_medium, utm_campaign,
                      utm_content, utm_term, fbclid, gclid, página de entrada, domínio de
                      referência e data de captura.
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
                  <strong>Medição de campanhas:</strong> medir e otimizar os anúncios da
                  própria FloraClin, saber quais anúncios geram cadastros e assinaturas e
                  evitar contar a mesma conversão duas vezes. Não usamos esses dados para
                  vender a terceiros nem para anunciar produtos de outras empresas. O Meta
                  Pixel depende do seu consentimento. O envio dos eventos de cadastro e
                  assinatura pelo nosso servidor e o cookie de primeiro acesso se baseiam
                  no interesse legítimo (seção 4).
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
                    <strong>Consentimento</strong> (Art. 7º, I): para dados de pacientes
                    inseridos pelo Usuário na Plataforma, quando aplicável, e para cookies
                    não essenciais, incluindo o Meta Pixel.
                  </li>
                  <li>
                    <strong>Tutela da saúde</strong> (Art. 7º, VIII): para dados
                    sensíveis de saúde dos pacientes.
                  </li>
                  <li>
                    <strong>Interesse legítimo</strong> (Art. 7º, IX, e Art. 10): para
                    melhorias do serviço, segurança, prevenção a fraudes, métricas
                    agregadas, o registro do primeiro acesso (item 7.4) e o envio dos
                    eventos de cadastro concluído e assinatura à Meta pela API de
                    Conversões (seção 5). O interesse é medir e otimizar os anúncios da
                    própria FloraClin (apoio e promoção das nossas atividades, Art. 10, I).
                    Antes de adotar essa base, fizemos um teste de balanceamento entre esse
                    interesse e os seus direitos e expectativas. Ele considera, entre outros
                    pontos, que os dados são de quem se cadastrou diretamente conosco, que se
                    limitam a dois eventos, que e-mail e telefone seguem em hash e que você
                    pode se opor a qualquer momento (seção 8). Você pode pedir um resumo
                    desse teste pelo e-mail contato@floraclin.com.br. Esse envio não inclui
                    dados de pacientes nem dados sensíveis.
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
                  A FloraClin não vende nem aluga dados pessoais. Compartilhamos dados
                  apenas nas situações abaixo:
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
                    <strong>Anúncios próprios da FloraClin (Meta Platforms):</strong> para
                    medir e otimizar os anúncios da FloraClin no Facebook e no Instagram,
                    compartilhamos dados com a Meta Platforms, Inc. de duas formas: (a) pelo
                    Meta Pixel, somente se você aceitar a categoria &quot;Anúncios e
                    medição&quot; no banner de cookies; e (b) pelo nosso servidor (API de
                    Conversões), quando você conclui o cadastro e quando contrata um plano
                    pago. Nesse envio seguem e-mail e, quando houver, telefone em hash
                    SHA-256, endereço IP, navegador, identificador de clique do anúncio, o
                    cookie &quot;_fbp&quot; quando existir e, na assinatura, o valor do plano.
                    IP, navegador e identificador de clique seguem sem hash, pois a Meta
                    precisa deles nesse formato para associar o evento ao anúncio. O hash
                    protege o dado, mas não o torna anônimo: a Meta compara o hash com os
                    seus próprios registros para saber se o cadastro veio de um anúncio. A
                    FloraClin é a controladora desse envio e o faz com base no interesse
                    legítimo (seção 4). Depois do recebimento, a Meta trata esses dados
                    conforme os Termos das Ferramentas de Negócios da Meta e a sua Política
                    de Privacidade, inclusive quanto ao prazo de retenção, e esses termos
                    podem incluir usos próprios da Meta, fora do controle da FloraClin. A
                    Meta pode tratar os dados fora do Brasil, em especial nos Estados Unidos,
                    em transferência internacional realizada conforme o Art. 33 da LGPD.
                    Você pode se opor a esse envio conforme a seção 8. O gclid fica
                    registrado apenas no cookie de primeiro acesso e no cadastro, para
                    relatórios internos, e hoje não é enviado ao Google. Se passarmos a
                    enviá-lo, atualizaremos esta Política antes.
                  </li>
                </ul>
                <p>
                  O paciente que não deseja ter seus dados usados na medição de anúncios da
                  clínica deve falar diretamente com a clínica responsável pelo seu
                  atendimento. A integração da clínica com a Meta é separada dos anúncios
                  próprios da FloraClin e não usa os dados descritos no item acima.
                  Visitantes e usuários podem gerenciar cookies conforme a seção 9 e se
                  opor ao envio pela API de Conversões conforme a seção 8.
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
                  7.4. Para saber de onde vêm os cadastros, registramos o primeiro acesso
                  em um cookie próprio (&quot;floraclin_ft&quot;, no domínio
                  floraclin.com.br), por até 90 dias. O registro guarda os parâmetros UTM,
                  os identificadores de clique em anúncios (fbclid, gclid), a página de
                  entrada (sem parâmetros), o domínio de referência e a data de captura.
                  Esse registro se baseia no interesse legítimo e acontece
                  independentemente da escolha no banner de cookies. Além das
                  nossas ferramentas de análise de uso, ele só sai da FloraClin pelo
                  fbclid, que compõe o identificador de clique enviado à Meta nos eventos
                  de cadastro e assinatura (seção 5). Ao concluir o cadastro, esses dados são salvos no
                  cadastro da clínica. Você pode apagar o cookie no seu navegador a
                  qualquer momento e pode se opor a esse registro conforme a seção 8. A sua
                  escolha no banner de cookies fica guardada por até 180 dias ou até você
                  alterá-la ou limpar os dados do navegador.
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
                  <li>Opor-se a tratamento realizado com base no interesse legítimo</li>
                </ul>
                <p>
                  Quando o tratamento se baseia no interesse legítimo, como o envio dos
                  eventos de cadastro e assinatura à Meta e o registro do primeiro acesso,
                  você pode se opor a ele (Art. 18, § 2º), sem precisar justificar o
                  pedido. Basta escrever para contato@floraclin.com.br com o e-mail usado
                  no cadastro. A partir do registro do seu pedido, deixamos de enviar
                  eventos da sua conta à Meta e apagamos os dados de origem do primeiro
                  acesso guardados no seu cadastro. Eventos enviados antes do pedido já
                  estão com a Meta e não podem ser recolhidos por nós. Para pedir à Meta a
                  exclusão de dados que ela mantém, use as ferramentas de privacidade da
                  própria Meta. Se você não estiver satisfeito com a nossa resposta, pode
                  peticionar à ANPD.
                </p>
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
                    <strong>Anúncios e medição:</strong> opcionais. Incluem o Meta Pixel e
                    tecnologias similares no navegador, para medir campanhas e apoiar
                    anúncios da FloraClin. Ficam desligados até você aceitar.
                  </li>
                </ul>
                <p>
                  O que &quot;Recusar&quot; faz: o Meta Pixel não é carregado, e nenhum
                  evento é enviado pelo navegador à Meta. O que &quot;Recusar&quot; não faz:
                  não impede o registro do primeiro acesso no cookie próprio (item 7.4),
                  incluindo fbclid e gclid, nem o envio dos eventos de cadastro e
                  assinatura pelo nosso servidor à Meta (seção 5). Esses dois tratamentos
                  se baseiam no interesse legítimo, e a forma de se opor a eles é o pedido
                  descrito na seção 8. Você pode aceitar, recusar ou alterar sua escolha
                  pelo banner ou pelo link &quot;Preferências de cookies&quot; no rodapé.
                  Uma recusa posterior vale dali em diante e não desfaz o que já foi
                  enviado.
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

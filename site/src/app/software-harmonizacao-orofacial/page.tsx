import Image from "next/image";
import Link from "next/link";
import { ContentPage, contentPageMetadata, type FaqItem } from "@/components/content/content-page";
import { SignupLink } from "@/components/signup-link";

const PATH = "/software-harmonizacao-orofacial";

export const metadata = contentPageMetadata(PATH);

const FAQS: FaqItem[] = [
  {
    question: "O FloraClin é feito para harmonização orofacial?",
    answer:
      "Sim, só para HOF. O fluxo segue a rotina de quem trabalha com toxina, preenchedores e bioestimuladores: anamnese, avaliação, planejamento no diagrama facial, aprovação, execução com registro de produto e lote, fotos e retorno.",
  },
  {
    question: "O que fica registrado em cada ponto do diagrama facial?",
    answer:
      "Produto, princípio ativo, quantidade com a unidade (U ou mL), técnica, profundidade e observações. O diagrama tem vista frontal e perfis. O lote e a validade do produto ficam no registro de aplicação do procedimento.",
  },
  {
    question: "Como funciona o teste grátis?",
    answer:
      "Você cria a conta e usa o FloraClin por 14 dias, sem cadastrar cartão de crédito. Durante o teste, a conta tem 2 usuários e créditos de WhatsApp para testar as mensagens. Depois, você escolhe o Starter (R$ 99/mês) ou o Pro (R$ 199/mês).",
  },
  {
    question: "Preciso instalar alguma coisa?",
    answer:
      "Não. O FloraClin funciona no navegador do computador, do tablet ou do celular. A câmera do celular é usada para a captura guiada das fotos.",
  },
  {
    question: "O paciente precisa baixar um app?",
    answer:
      "Não. O paciente confirma a consulta com um toque na mensagem do WhatsApp e recebe links para preencher a anamnese e assinar os termos, sem cadastro nem senha.",
  },
  {
    question: "Consigo trazer meus pacientes de outro sistema?",
    answer: "Sim. Fale com a gente pelo WhatsApp ou pelo e-mail contato@floraclin.com.br e ajudamos na migração.",
  },
];

export default function SoftwareHofPage() {
  return (
    <ContentPage
      path={PATH}
      eyebrow="Software para HOF"
      heading="Software para Harmonização Orofacial: diagrama facial, prontuário e fotos alinhadas"
      article={false}
      faqs={FAQS}
      quickAnswer={
        <p>
          O FloraClin é um sistema feito só para clínicas de <strong>harmonização orofacial</strong>. Você marca no
          diagrama facial o produto e a quantidade de cada ponto, registra lote e validade no procedimento, tira fotos
          com guia de pose e compara o antes e depois com <strong>alinhamento automático</strong>. Agenda com
          confirmação pelo WhatsApp, anamnese e termos assinados no celular e financeiro vêm juntos. São{" "}
          <strong>14 dias grátis, sem cartão</strong>, e depois R$ 99/mês (Starter) ou R$ 199/mês (Pro).
        </p>
      }
      related={[
        "/guia-fotos-antes-e-depois",
        "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
        "/floraclin-vs-simplu",
        "/alternativa-ao-clinicorp",
      ]}
    >
      <figure className="not-prose my-8">
        <Image
          src="/product/face-diagram.webp"
          alt="Tela do FloraClin com o diagrama facial e os pontos de aplicação marcados por produto e dose"
          width={1600}
          height={966}
          sizes="(max-width: 768px) 100vw, 712px"
          className="w-full h-auto rounded-xl border border-sage/15 shadow-sm"
        />
        <figcaption className="text-sm text-mid mt-3">Diagrama facial na execução do procedimento.</figcaption>
      </figure>

      <h2>Diagrama facial com o que foi aplicado em cada ponto</h2>
      <p>
        Em vez de um campo de texto com &quot;toxina na glabela&quot;, você toca no rosto e o ponto guarda o produto, o
        princípio ativo, a quantidade (em U ou mL), a técnica e a profundidade. O diagrama tem vista
        frontal e de perfil, e o resumo soma o total por produto. Na sessão seguinte, você abre o mesmo mapa e sabe
        exatamente o que foi feito.
      </p>
      <p>
        O lote e a validade de cada produto ficam no registro de aplicação do procedimento e aparecem no prontuário
        impresso, o que facilita a rastreabilidade se houver uma intercorrência.
      </p>

      <h2>Prontuário completo, do primeiro contato ao retorno</h2>
      <ul>
        <li>
          <strong>Anamnese pelo celular:</strong> o paciente preenche antes de chegar, por um link.
        </li>
        <li>
          <strong>Termos e contratos assinados digitalmente:</strong> o paciente assina no celular e o documento fica no
          prontuário.
        </li>
        <li>
          <strong>Atendimento guiado:</strong> avaliação, planejamento, aprovação, execução e acompanhamento, sem pular
          etapa.
        </li>
        <li>
          <strong>Timeline de evolução</strong> com procedimentos, fotos e documentos de cada paciente, e exportação do
          prontuário em PDF.
        </li>
        <li>
          <strong>Pacotes</strong> de procedimentos com controle de sessões.
        </li>
      </ul>

      <h2>Fotos de antes e depois que dá para comparar</h2>
      <p>
        A câmera mostra o contorno da pose (frontal, 45° e perfis), confere a posição do rosto e tira a foto sozinha
        quando está tudo certo. Cada foto fica marcada no tempo (pré, pós-imediato, 7, 30 ou 90 dias). Na comparação,
        o FloraClin detecta os olhos nas duas fotos e alinha posição, escala e rotação, para que a diferença que
        aparece seja o resultado, não o enquadramento. Dá para comparar com cortina, lado a lado ou sobreposto, e
        anotar com setas, círculos e régua. O guia de{" "}
        <Link href="/guia-fotos-antes-e-depois">fotos de antes e depois padronizadas</Link> explica o resto do
        protocolo.
      </p>

      <h2>Agenda e WhatsApp</h2>
      <ul>
        <li>Agenda com filtro por profissional e sincronização com o Google Calendar.</li>
        <li>Agendamento online por uma página pública da clínica.</li>
        <li>
          Confirmação e lembrete automáticos pelo WhatsApp, além de mensagens de pré e pós-procedimento, retorno e
          lembrete de pagamento.
        </li>
        <li>Conversas de WhatsApp dentro do sistema, com o número da clínica nos planos pagos.</li>
      </ul>

      <h2>Financeiro da clínica</h2>
      <p>
        Parcelas, receita por profissional, despesas e vendas no cartão com as maquininhas e os repasses, ligados ao
        procedimento. Também há CRM de contatos e acompanhamento de retorno.
      </p>

      <h2>O que o FloraClin ainda não faz</h2>
      <p>
        Para você decidir com tudo na mesa: o FloraClin não tem controle de estoque, não emite
        nota fiscal, não tem odontograma nem transcrição do atendimento por IA, e não tem app nas lojas (funciona no
        navegador). Se algum desses pontos for decisivo, veja o{" "}
        <Link href="/melhores-sistemas-clinica-estetica-harmonizacao-2026">comparativo de sistemas</Link>, que mostra
        onde cada concorrente é melhor.
      </p>

      <h2>Planos</h2>
      <ul>
        <li>
          <strong>Teste grátis:</strong> 14 dias, sem cartão, com 2 usuários e créditos de WhatsApp para testar.
        </li>
        <li>
          <strong>Starter, R$ 99/mês:</strong> 300 créditos de WhatsApp por mês e número próprio de WhatsApp.
        </li>
        <li>
          <strong>Pro, R$ 199/mês:</strong> 1.000 créditos de WhatsApp por mês, usuários ilimitados e número próprio de
          WhatsApp.
        </li>
      </ul>
      <p>
        <SignupLink>Crie sua conta grátis</SignupLink> e cadastre seu primeiro paciente em poucos minutos.
      </p>
    </ContentPage>
  );
}

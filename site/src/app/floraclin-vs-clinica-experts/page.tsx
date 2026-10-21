import Link from "next/link";
import { ContentPage, contentPageMetadata, type FaqItem } from "@/components/content/content-page";
import { BiasNote, HeadToHead, SourceList } from "@/components/content/blocks";
import { COMPETITORS, FLORACLIN } from "@/content/competitors";
import { SignupLink } from "@/components/signup-link";

const PATH = "/floraclin-vs-clinica-experts";
const CE = COMPETITORS.clinicaExperts;

export const metadata = contentPageMetadata(PATH);

const FAQS: FaqItem[] = [
  {
    question: "Qual a diferença entre FloraClin e Clínica Experts?",
    answer:
      "O Clínica Experts é um sistema para várias áreas da saúde, com uma vertical de estética e IA forte (assistente no WhatsApp, transcrição do atendimento e análise de pele). O FloraClin é feito só para harmonização orofacial, com diagrama facial por ponto e fotos de antes e depois alinhadas automaticamente, a partir de R$ 99/mês.",
  },
  {
    question: "Quanto custa o Clínica Experts?",
    answer:
      "Na página oficial de planos, consultada em 21/10/2026, os preços do plano anual são: Essencial 12x R$ 249 (R$ 2.988 por ano, até 3 usuários) e Avançado 12x R$ 399 (R$ 4.788 por ano, até 10 usuários). O plano Experts é sob orçamento. As notificações de WhatsApp pela API oficial da Meta são cobradas à parte, entre R$ 0,08 e R$ 0,40 por janela de conversa. Não conseguimos verificar os preços do plano mensal.",
  },
  {
    question: "Qual tem o teste grátis mais longo?",
    answer:
      "O FloraClin: 14 dias grátis, sem cartão. O Clínica Experts oferece 7 dias grátis, segundo o próprio site.",
  },
  {
    question: "O Clínica Experts alinha as fotos de antes e depois?",
    answer:
      "O site oficial descreve a comparação de fotos como um arrastar sobre as imagens, e não fala em alinhamento automático. No FloraClin, a comparação detecta os olhos nas duas fotos e alinha posição, escala e rotação.",
  },
];

export default function FloraClinVsClinicaExpertsPage() {
  return (
    <ContentPage
      path={PATH}
      eyebrow="Comparativo"
      heading="FloraClin vs Clínica Experts: especialista em HOF ou sistema geral com IA"
      faqs={FAQS}
      quickAnswer={
        <p>
          O <strong>Clínica Experts</strong> é um sistema para várias áreas da saúde, com IA no WhatsApp, transcrição
          do atendimento e análise de pele, a partir de 12x R$ 249 no plano anual e 7 dias grátis. O{" "}
          <strong>FloraClin</strong> é feito só para harmonização orofacial: diagrama facial com produto e quantidade
          por ponto, fotos de antes e depois alinhadas automaticamente, R$ 99 ou R$ 199 por mês e 14 dias grátis sem
          cartão. Se a IA é o que você mais quer, o Clínica Experts está à frente. Se é o registro da HOF e fotos
          comparáveis, o FloraClin é mais focado.
        </p>
      }
      related={[
        "/alternativa-ao-clinica-experts",
        "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
        "/software-harmonizacao-orofacial",
        "/floraclin-vs-simplu",
      ]}
    >
      <BiasNote>
        Esta comparação foi escrita pelo FloraClin, então tem viés. Os dados do Clínica Experts vêm do site oficial,
        consultado em 21/10/2026, e dizemos abaixo onde ele é melhor do que nós.
      </BiasNote>

      <h2>Lado a lado</h2>
      <HeadToHead a={FLORACLIN} b={CE} />

      <h2>Onde o Clínica Experts é melhor</h2>
      <ul>
        <li>
          <strong>IA no WhatsApp 24h (Anna):</strong> responde, agenda e faz follow-up com pacientes. O FloraClin envia
          confirmações e lembretes automáticos, mas não tem um assistente de IA que conversa com o paciente.
        </li>
        <li>
          <strong>Transcrição do atendimento por IA</strong> direto no prontuário. O FloraClin não tem.
        </li>
        <li>
          <strong>Análise de pele por IA</strong> (Anna Skin Analysis) a partir de uma foto do rosto. O FloraClin não
          tem.
        </li>
        <li>
          <strong>Mais áreas e módulos:</strong> estoque com lotes e validades, nota fiscal, teleconsulta, odontograma e
          prescrição digital. Útil para clínicas multidisciplinares.
        </li>
      </ul>

      <h2>Onde o FloraClin é melhor</h2>
      <ul>
        <li>
          <strong>Feito só para HOF.</strong> O fluxo de atendimento, os termos e o diagrama facial foram pensados para
          toxina, preenchedores e bioestimuladores, não adaptados de um sistema geral.
        </li>
        <li>
          <strong>Diagrama facial por ponto:</strong> cada ponto guarda produto, quantidade, técnica e profundidade, em
          vista frontal e perfis. O planejador de injetáveis do Clínica Experts marca os pontos sobre a foto do
          paciente.
        </li>
        <li>
          <strong>Antes e depois alinhado automaticamente</strong>, com captura guiada por pose. O site do Clínica
          Experts descreve uma comparação por arrastar, sem alinhamento.
        </li>
        <li>
          <strong>Teste mais longo e sem cartão:</strong> 14 dias, contra 7.
        </li>
        <li>
          <strong>Preço de entrada:</strong> R$ 99/mês no Starter, contra 12x R$ 249 no Essencial anual.
        </li>
      </ul>

      <h2>Qual escolher</h2>
      <p>
        Se a sua clínica atende várias especialidades ou você quer um assistente de IA respondendo pacientes no
        WhatsApp, o Clínica Experts faz mais. Se a rotina é harmonização e você quer registrar cada aplicação e mostrar
        resultados com fotos comparáveis, <SignupLink>teste o FloraClin por 14 dias</SignupLink>. Para trocar com
        calma, veja a <Link href="/alternativa-ao-clinica-experts">alternativa ao Clínica Experts</Link>.
      </p>

      <SourceList sources={[...CE.sources, ...FLORACLIN.sources]} />
    </ContentPage>
  );
}

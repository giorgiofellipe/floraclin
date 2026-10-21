import Link from "next/link";
import { ContentPage, contentPageMetadata, type FaqItem } from "@/components/content/content-page";
import { BiasNote, HeadToHead, SourceList } from "@/components/content/blocks";
import { COMPETITORS, FLORACLIN } from "@/content/competitors";
import { SignupLink } from "@/components/signup-link";

const PATH = "/floraclin-vs-simplu";
const SIMPLU = COMPETITORS.simplu;

export const metadata = contentPageMetadata(PATH);

const FAQS: FaqItem[] = [
  {
    question: "Qual a diferença entre FloraClin e Simplu?",
    answer:
      "Os dois são feitos para harmonização e alinham as fotos de antes e depois automaticamente. O Simplu tem mapa facial 3D, baixa de estoque pelo lote aplicado, equilíbrio de luz nas fotos e tudo ilimitado por R$ 297/mês (R$ 252 no anual). O FloraClin custa R$ 99 ou R$ 199 por mês e pode ser testado por 14 dias sem cartão.",
  },
  {
    question: "O Simplu tem teste grátis?",
    answer:
      "Na página oficial, consultada em 21/10/2026, o Simplu oferece demonstração online gratuita e 7 dias de garantia com reembolso depois de assinar, mas não um teste grátis. O FloraClin tem 14 dias grátis sem cartão.",
  },
  {
    question: "Qual é mais barato, FloraClin ou Simplu?",
    answer:
      "O FloraClin: R$ 99/mês no Starter e R$ 199/mês no Pro, contra R$ 297/mês no mensal ou R$ 252/mês no anual do Simplu. Em troca, o Simplu inclui tudo ilimitado (pacientes, equipe, mensagens, notas fiscais e armazenamento), além de configuração e migração.",
  },
  {
    question: "Os dois alinham as fotos de antes e depois?",
    answer:
      "Sim. O Simplu diz que a IA alinha o rosto e equilibra a luz das duas fotos. O FloraClin detecta os olhos e alinha posição, escala e rotação na comparação, sem alterar a foto original, e guia a captura por pose para as fotos já saírem parecidas.",
  },
];

export default function FloraClinVsSimpluPage() {
  return (
    <ContentPage
      path={PATH}
      eyebrow="Comparativo"
      heading="FloraClin vs Simplu: qual sistema de harmonização escolher"
      faqs={FAQS}
      quickAnswer={
        <p>
          FloraClin e Simplu são os dois sistemas da lista feitos para harmonização que{" "}
          <strong>alinham automaticamente o antes e depois</strong>. O <strong>Simplu</strong> vai além em mapa facial
          3D, estoque pelo lote e equilíbrio de luz, e inclui tudo ilimitado por R$ 297/mês (R$ 252 no anual), sem teste
          grátis. O <strong>FloraClin</strong> custa R$ 99 ou R$ 199/mês, tem 14 dias grátis sem cartão e cobre
          diagrama facial, prontuário, fotos, WhatsApp e financeiro.
        </p>
      }
      related={[
        "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
        "/software-harmonizacao-orofacial",
        "/guia-fotos-antes-e-depois",
        "/floraclin-vs-clinica-experts",
      ]}
    >
      <BiasNote>
        Esta comparação foi escrita pelo FloraClin, então tem viés. Os dados do Simplu vêm do site oficial,
        consultado em 21/10/2026. Abaixo dizemos onde o Simplu é melhor.
      </BiasNote>

      <h2>Lado a lado</h2>
      <HeadToHead a={FLORACLIN} b={SIMPLU} />

      <h2>Onde o Simplu é melhor</h2>
      <ul>
        <li>
          <strong>Mapa facial 3D</strong>, com produto, dose e lote em cada ponto. O diagrama do FloraClin é 2D, com
          vista frontal e perfis, e o lote fica no registro do procedimento.
        </li>
        <li>
          <strong>Estoque:</strong> o Simplu dá baixa no estoque pelo lote aplicado. O FloraClin não tem controle de
          estoque.
        </li>
        <li>
          <strong>Luz das fotos:</strong> a IA do Simplu também equilibra a luz. O FloraClin alinha o rosto, mas não
          mexe na luz, por isso a padronização na captura importa (veja o{" "}
          <Link href="/guia-fotos-antes-e-depois">guia de fotos de antes e depois</Link>).
        </li>
        <li>
          <strong>Tudo ilimitado</strong>, inclusive notas fiscais, e configuração, migração e grupo de suporte no
          WhatsApp inclusos.
        </li>
      </ul>

      <h2>Onde o FloraClin é melhor</h2>
      <ul>
        <li>
          <strong>Preço:</strong> R$ 99/mês no Starter, cerca de um terço do Simplu, e R$ 199/mês no Pro com usuários
          ilimitados.
        </li>
        <li>
          <strong>Teste grátis de verdade:</strong> 14 dias sem cartão, em vez de pagar e pedir reembolso.
        </li>
        <li>
          <strong>Captura guiada:</strong> a câmera indica a pose (frontal, 45° e perfis) e tira a foto sozinha quando
          o rosto está na posição certa. O site do Simplu não menciona guia de captura.
        </li>
      </ul>

      <h2>Qual escolher</h2>
      <p>
        Se você quer o mapa 3D, estoque por lote e tudo ilimitado, e o preço cabe no orçamento, o Simplu é uma ótima
        escolha. Se você quer o essencial da HOF (diagrama por ponto, fotos alinhadas, prontuário, WhatsApp e
        financeiro) pagando menos e testando antes,{" "}
        <SignupLink>experimente o FloraClin por 14 dias</SignupLink>.
      </p>

      <SourceList sources={[...SIMPLU.sources, ...FLORACLIN.sources]} />
    </ContentPage>
  );
}

import Link from "next/link";
import { ContentPage, contentPageMetadata, type FaqItem } from "@/components/content/content-page";
import { BiasNote, ComparisonTable, SourceList } from "@/components/content/blocks";
import { COMPETITORS, FLORACLIN } from "@/content/competitors";
import { SignupLink } from "@/components/signup-link";

const PATH = "/alternativa-ao-clinica-experts";
const CE = COMPETITORS.clinicaExperts;
const ALTERNATIVES = [FLORACLIN, COMPETITORS.simplu, COMPETITORS.sante, COMPETITORS.agendiva, COMPETITORS.iter];

export const metadata = contentPageMetadata(PATH);

const FAQS: FaqItem[] = [
  {
    question: "Qual a melhor alternativa ao Clínica Experts para harmonização?",
    answer:
      "Para clínicas focadas em HOF, entre os sistemas cujo site mostra o registro de cada ponto de aplicação no rosto estão FloraClin, Simplu, Santé (módulo de HOF) e Agendiva (planos Pro e Studio). FloraClin e Simplu também alinham automaticamente as fotos de antes e depois. O FloraClin custa R$ 99 ou R$ 199 por mês, com 14 dias grátis sem cartão.",
  },
  {
    question: "Existe alternativa mais barata ao Clínica Experts?",
    answer:
      "Sim. Nos sites oficiais consultados em 21/10/2026: Agendiva a partir de R$ 39,90/mês, Iter Clinic a partir de R$ 69/mês e FloraClin a partir de R$ 99/mês, contra 12x R$ 249 no plano Essencial anual do Clínica Experts.",
  },
  {
    question: "Vou perder a IA no WhatsApp se trocar?",
    answer:
      "Se for para o FloraClin, sim: ele envia confirmações e lembretes automáticos, mas não tem um assistente de IA que conversa com o paciente como a Anna do Clínica Experts. Também não tem transcrição por IA nem análise de pele. Pese isso antes de trocar.",
  },
  {
    question: "Como levar meus dados do Clínica Experts para o FloraClin?",
    answer:
      "Peça a exportação dos seus pacientes ao Clínica Experts antes de encerrar o contrato e fale com a gente para importar. Use os 14 dias de teste para conferir tudo com o sistema antigo ainda ativo.",
  },
];

export default function AlternativaClinicaExpertsPage() {
  return (
    <ContentPage
      path={PATH}
      eyebrow="Alternativa ao Clínica Experts"
      heading="Alternativa ao Clínica Experts para clínicas de harmonização"
      faqs={FAQS}
      quickAnswer={
        <p>
          Se você usa ou está avaliando o Clínica Experts e sua clínica é de <strong>harmonização orofacial</strong>, o
          FloraClin é uma alternativa focada em HOF: diagrama facial por ponto, fotos de antes e depois alinhadas
          automaticamente e planos de R$ 99 e R$ 199 por mês, com 14 dias grátis sem cartão (o Clínica Experts dá 7). O
          que você deixa para trás é a IA: assistente no WhatsApp, transcrição e análise de pele, em que o Clínica
          Experts é mais forte.
        </p>
      }
      related={[
        "/floraclin-vs-clinica-experts",
        "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
        "/software-harmonizacao-orofacial",
        "/alternativa-ao-clinicorp",
      ]}
    >
      <BiasNote>
        Esta página foi escrita pelo FloraClin, que é uma das alternativas listadas. Os dados de todos os sistemas vêm
        dos sites oficiais, consultados em 21/10/2026.
      </BiasNote>

      <h2>Por que clínicas de HOF procuram uma alternativa</h2>
      <ul>
        <li>
          <strong>Foco:</strong> o Clínica Experts atende várias áreas da saúde, e a estética é uma delas. Quem só faz
          HOF pode preferir um fluxo feito para injetáveis.
        </li>
        <li>
          <strong>Preço:</strong> no plano anual, o Essencial sai por 12x R$ 249, até 3 usuários, e as mensagens de
          WhatsApp pela API oficial são cobradas pela Meta, direto do cliente.
        </li>
        <li>
          <strong>Fotos:</strong> a comparação de antes e depois é feita arrastando sobre as fotos, e o site não menciona
          alinhamento automático.
        </li>
        <li>
          <strong>Teste:</strong> 7 dias grátis.
        </li>
      </ul>

      <h2>Alternativas com foco em estética e HOF</h2>
      <ComparisonTable
        caption="Dados das páginas oficiais, consultadas em 21/10/2026. Role para o lado no celular."
        head={["Sistema", "Preço", "Teste grátis", "Mapa facial", "Antes e depois"]}
        rows={[CE, ...ALTERNATIVES].map((s) => [s.name, s.price, s.trial, s.facialMap, s.beforeAfter])}
      />

      <h2>Quando ficar no Clínica Experts</h2>
      <p>
        Se o assistente de IA no WhatsApp, a transcrição do atendimento ou a análise de pele já fazem parte da sua
        rotina, ou se a clínica atende outras especialidades com estoque, teleconsulta e nota fiscal (estes dois no plano Experts ou como adicionais), o Clínica
        Experts entrega mais do que o FloraClin nesses pontos. Para uma visão completa, veja o{" "}
        <Link href="/floraclin-vs-clinica-experts">FloraClin vs Clínica Experts</Link>.
      </p>

      <h2>Como trocar sem parar a clínica</h2>
      <ol>
        <li>
          <SignupLink>Crie sua conta no FloraClin</SignupLink> e use os 14 dias com pacientes reais.
        </li>
        <li>Peça ao Clínica Experts a exportação do cadastro dos pacientes antes de encerrar o contrato.</li>
        <li>Fale com a gente para importar a base e mantenha o sistema antigo até conferir tudo.</li>
      </ol>

      <SourceList sources={[...CE.sources, ...ALTERNATIVES.flatMap((s) => s.sources)]} />
    </ContentPage>
  );
}

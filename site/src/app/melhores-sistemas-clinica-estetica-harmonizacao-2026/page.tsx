import Link from "next/link";
import { ContentPage, contentPageMetadata, type FaqItem } from "@/components/content/content-page";
import { BiasNote, ComparisonTable, SourceList } from "@/components/content/blocks";
import { COMPETITORS, FLORACLIN, type CompetitorFacts } from "@/content/competitors";
import { SignupLink } from "@/components/signup-link";

const PATH = "/melhores-sistemas-clinica-estetica-harmonizacao-2026";

export const metadata = contentPageMetadata(PATH);

const SYSTEMS: CompetitorFacts[] = [
  FLORACLIN,
  COMPETITORS.simplu,
  COMPETITORS.sante,
  COMPETITORS.tuttohof,
  COMPETITORS.clinicaExperts,
  COMPETITORS.agendiva,
  COMPETITORS.iter,
  COMPETITORS.harmony,
  COMPETITORS.clinicorp,
  COMPETITORS.belle,
  COMPETITORS.trinks,
];

const FAQS: FaqItem[] = [
  {
    question: "Qual o melhor sistema para clínica de estética em 2026?",
    answer:
      "Depende do que pesa mais na sua rotina. Para harmonização orofacial, os sistemas que registram produto e quantidade em cada ponto do rosto são FloraClin, Simplu, Santé (módulo de HOF) e Agendiva (plano Pro); o Clínica Experts marca os pontos sobre a foto. Para quem atende sozinha e quer o menor preço, Agendiva e Iter Clinic têm planos de entrada abaixo de R$ 70/mês. Para redes, franquias e clínicas que também fazem odontologia geral, Clinicorp e Belle têm mais módulos.",
  },
  {
    question: "Qual sistema alinha automaticamente as fotos de antes e depois?",
    answer:
      "Entre os sistemas comparados, só FloraClin e Simplu dizem no próprio site que alinham as fotos automaticamente. O Simplu também equilibra a luz. Nos demais, a página oficial mostra comparação lado a lado ou com cortina, sem alinhamento automático informado.",
  },
  {
    question: "Quais sistemas têm teste grátis sem cartão?",
    answer:
      "Na data da consulta: FloraClin (14 dias), Agendiva (14 dias), Santé (7 dias) e TuttoHOF (90 dias) informam teste sem cartão. Belle oferece 14 dias, Clínica Experts 7 e Trinks 5, sem dizer na página consultada se pedem cartão. Harmony pede o cartão na ativação dos 7 dias. Simplu e Iter Clinic não têm teste grátis: oferecem garantia de reembolso de 7 e 14 dias.",
  },
  {
    question: "Esse comparativo é imparcial?",
    answer:
      "Não. Ele foi escrito pela equipe do FloraClin, que é um dos sistemas da lista. Por isso usamos só informações publicadas pelos próprios fornecedores, com link e data, marcamos o que não conseguimos verificar e dizemos onde cada concorrente é melhor do que nós.",
  },
  {
    question: "Quanto custa um sistema para clínica de estética?",
    answer:
      "Nos sites consultados, os planos vão de R$ 39,90/mês (Agendiva Solo) a mais de R$ 350/mês nos planos completos para equipes (Clinicorp Premium, Harmony Enterprise). Alguns cobram à parte por implementação, módulos ou mensagens de WhatsApp, então compare o custo total, não só a mensalidade.",
  },
];

function row(system: CompetitorFacts) {
  return [
    system.name,
    system.price,
    system.trial,
    system.prontuario,
    system.facialMap,
    system.beforeAfter,
    system.lgpd,
  ];
}

export default function MelhoresSistemasPage() {
  const competitors = SYSTEMS.filter((s) => s !== FLORACLIN);
  return (
    <ContentPage
      path={PATH}
      eyebrow="Comparativo 2026"
      heading="Melhores sistemas para clínica de estética e harmonização em 2026"
      faqs={FAQS}
      quickAnswer={
        <>
          <p>
            Para <strong>harmonização orofacial</strong>, os sistemas que registram cada ponto de aplicação no rosto são
            FloraClin, Simplu, Santé (módulo de HOF) e Agendiva (plano Pro). Só <strong>FloraClin e Simplu</strong>{" "}
            dizem alinhar automaticamente as fotos de antes e depois. Para pagar pouco atendendo sozinha, Agendiva (R$
            39,90/mês) e Iter Clinic (R$ 69/mês) são os mais baratos. Para redes e franquias, Clinicorp e Belle têm mais
            módulos.
          </p>
          <p>
            Este comparativo foi escrito pelo FloraClin, então tem viés. Todos os dados vêm dos sites oficiais,
            consultados em 21/10/2026.
          </p>
        </>
      }
    >
      <BiasNote>
        <strong>Somos o FloraClin, e o FloraClin está nesta lista.</strong> Temos viés, e é melhor você saber disso
        logo de cara. Para compensar, cada informação abaixo saiu da página oficial de cada sistema (os links estão no
        fim), marcamos como &quot;não verificado&quot; o que não conseguimos confirmar e, em cada concorrente, dizemos
        onde ele é melhor do que nós.
      </BiasNote>

      <h2>Como comparamos</h2>
      <p>
        Lemos as páginas de preços e de recursos de onze sistemas usados por clínicas de estética e de harmonização no
        Brasil. Olhamos seis pontos que pesam na rotina de quem trabalha com injetáveis:
      </p>
      <ul>
        <li>
          <strong>Preço publicado</strong>, incluindo cobranças à parte quando o site mostra.
        </li>
        <li>
          <strong>Teste grátis</strong>, com a duração e se pede cartão.
        </li>
        <li>
          <strong>Prontuário</strong> eletrônico.
        </li>
        <li>
          <strong>Mapa facial</strong>, ou seja, registrar produto e quantidade em cada ponto do rosto.
        </li>
        <li>
          <strong>Antes e depois alinhado</strong>: se o sistema alinha as fotos sozinho para a comparação ficar justa.
        </li>
        <li>
          <strong>LGPD</strong>: o que a página oficial declara.
        </li>
      </ul>
      <p>
        Não testamos os sistemas por dentro. &quot;Não verificado&quot; quer dizer que a página oficial não mostrava a
        informação na consulta. Não quer dizer que o recurso não existe.
      </p>

      <h2>Tabela comparativa</h2>
      <ComparisonTable
        caption="Dados das páginas oficiais, consultadas em 21/10/2026. Role para o lado no celular."
        head={["Sistema", "Preço", "Teste grátis", "Prontuário", "Mapa facial", "Antes e depois", "LGPD"]}
        rows={SYSTEMS.map(row)}
      />

      <h2>Cada sistema, em poucas linhas</h2>

      <h3>FloraClin</h3>
      <p>
        Feito só para harmonização orofacial. O diagrama facial guarda produto, quantidade, técnica e profundidade em
        cada ponto, na vista frontal e nos perfis, e o lote e a validade do produto ficam no registro do procedimento.
        As fotos são tiradas com guia de pose e captura automática, e a comparação de antes e depois alinha os rostos
        sozinha. A agenda confirma consultas pelo WhatsApp, o paciente preenche a anamnese e assina os termos pelo
        celular, e o financeiro cuida de parcelas, comissões e maquininhas. Custa R$ 99/mês (Starter) ou R$ 199/mês
        (Pro), com 14 dias grátis sem cartão.
      </p>
      <p>
        <strong>Onde ainda não chegamos:</strong> o FloraClin não tem controle de estoque com baixa automática, não emite
        nota fiscal, não tem odontograma nem transcrição do atendimento por IA, e funciona no navegador (não há app nas
        lojas). Se isso for essencial para você, alguns concorrentes abaixo atendem melhor.
      </p>

      {competitors.map((system) => (
        <div key={system.name}>
          <h3>{system.name}</h3>
          <p>
            {system.focus} Preço: {system.price}. Teste: {system.trial.charAt(0).toLowerCase() + system.trial.slice(1)}.
          </p>
          <p>
            <strong>Onde é melhor que o FloraClin:</strong> {system.strengths}
          </p>
        </div>
      ))}

      <h2>Qual escolher</h2>
      <ul>
        <li>
          <strong>Você faz HOF e quer o registro de cada ponto e fotos comparáveis:</strong> FloraClin ou Simplu. O
          Simplu tem mapa 3D e baixa de estoque pelo lote, por R$ 297/mês. O FloraClin custa a partir de R$ 99/mês e
          pode ser testado por 14 dias sem cartão. Veja o <Link href="/floraclin-vs-simplu">FloraClin vs Simplu</Link>.
        </li>
        <li>
          <strong>Você atende sozinha e quer gastar pouco:</strong> Agendiva ou Iter Clinic.
        </li>
        <li>
          <strong>Sua clínica também faz odontologia geral:</strong> Clinicorp ou Santé, que têm odontograma. Veja a{" "}
          <Link href="/alternativa-ao-clinicorp">alternativa ao Clinicorp</Link>.
        </li>
        <li>
          <strong>Você quer IA no WhatsApp e transcrição do atendimento:</strong> Clínica Experts. Veja o{" "}
          <Link href="/floraclin-vs-clinica-experts">FloraClin vs Clínica Experts</Link> e a{" "}
          <Link href="/alternativa-ao-clinica-experts">alternativa ao Clínica Experts</Link>.
        </li>
        <li>
          <strong>Você tem rede ou franquia:</strong> Clinicorp ou Belle.
        </li>
      </ul>
      <p>
        Antes de assinar qualquer um, peça uma demonstração ou use o teste com dados reais da sua clínica. Se quiser
        padronizar as fotos que vai comparar, o <Link href="/guia-fotos-antes-e-depois">guia de fotos de antes e
        depois</Link> ajuda, e a página do <Link href="/software-harmonizacao-orofacial">FloraClin para HOF</Link>{" "}
        mostra o que o sistema faz em detalhe. Para testar o FloraClin agora,{" "}
        <SignupLink>crie sua conta grátis</SignupLink>.
      </p>

      <SourceList sources={SYSTEMS.flatMap((s) => s.sources)} />
    </ContentPage>
  );
}

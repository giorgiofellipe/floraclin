import Link from "next/link";
import { ContentPage, contentPageMetadata, type FaqItem } from "@/components/content/content-page";
import { BiasNote, HeadToHead, SourceList } from "@/components/content/blocks";
import { COMPETITORS, FLORACLIN } from "@/content/competitors";
import { SignupLink } from "@/components/signup-link";

const PATH = "/alternativa-ao-clinicorp";
const CLINICORP = COMPETITORS.clinicorp;

export const metadata = contentPageMetadata(PATH);

const FAQS: FaqItem[] = [
  {
    question: "Qual é uma alternativa ao Clinicorp para harmonização orofacial?",
    answer:
      "Para clínicas que fazem principalmente HOF, o FloraClin é uma alternativa com diagrama facial por ponto, fotos de antes e depois alinhadas automaticamente e planos de R$ 99 e R$ 199 por mês, sem taxa de implementação. Simplu, Santé (módulo de HOF) e Agendiva também registram pontos de aplicação no rosto.",
  },
  {
    question: "Quanto custa o Clinicorp?",
    answer:
      "Na página oficial de planos, consultada em 21/10/2026: Standard R$ 159,90/mês e Premium R$ 369,90/mês no cartão, ou R$ 127,19 e R$ 330 por mês no pacote trimestral. A implementação é obrigatória e cobrada à parte, em valor único no primeiro mês, que não aparece na página.",
  },
  {
    question: "O Clinicorp é melhor que o FloraClin?",
    answer:
      "Para clínicas odontológicas com várias especialidades, redes e franquias, o Clinicorp tem mais recursos: odontograma, app do paciente, NFS-e, gestão de várias unidades e usuários ilimitados. Para uma clínica focada em harmonização que quer registrar cada ponto do rosto e comparar fotos alinhadas, o FloraClin é mais direto e custa menos.",
  },
  {
    question: "Dá para testar o FloraClin antes de sair do Clinicorp?",
    answer:
      "Sim. O teste é de 14 dias, sem cartão. Você pode cadastrar alguns pacientes reais e usar em paralelo antes de decidir. Para trazer a base, fale com a gente e ajudamos na migração.",
  },
];

export default function AlternativaClinicorpPage() {
  return (
    <ContentPage
      path={PATH}
      eyebrow="Alternativa ao Clinicorp"
      heading="Alternativa ao Clinicorp para clínicas de harmonização e estética"
      faqs={FAQS}
      quickAnswer={
        <p>
          O Clinicorp é um sistema amplo, pensado primeiro para odontologia e para redes, a partir de R$ 159,90/mês
          com implementação obrigatória cobrada à parte. Se a sua clínica vive de <strong>harmonização orofacial</strong>{" "}
          e o que você precisa é registrar cada ponto de aplicação e comparar fotos alinhadas, o FloraClin faz isso por
          R$ 99 ou R$ 199/mês, com 14 dias grátis sem cartão. Se você também faz odontologia geral ou tem várias
          unidades, o Clinicorp continua mais completo.
        </p>
      }
      related={[
        "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
        "/software-harmonizacao-orofacial",
        "/floraclin-vs-simplu",
        "/alternativa-ao-clinica-experts",
      ]}
    >
      <BiasNote>
        Esta página foi escrita pelo FloraClin, então tem viés. Os dados do Clinicorp vêm da página oficial de planos,
        consultada em 21/10/2026, e marcamos como &quot;não verificado&quot; o que ela não mostrava.
      </BiasNote>

      <h2>FloraClin e Clinicorp lado a lado</h2>
      <HeadToHead a={FLORACLIN} b={CLINICORP} />

      <h2>Quando o FloraClin é a melhor alternativa</h2>
      <ul>
        <li>
          <strong>Sua clínica é de HOF.</strong> O FloraClin foi feito só para harmonização. O diagrama facial guarda
          produto, quantidade, técnica e profundidade em cada ponto, e o lote e a validade ficam no procedimento.
        </li>
        <li>
          <strong>Você quer fotos comparáveis.</strong> A captura é guiada por pose e o antes e depois é alinhado
          automaticamente. Veja como padronizar no{" "}
          <Link href="/guia-fotos-antes-e-depois">guia de fotos de antes e depois</Link>.
        </li>
        <li>
          <strong>Você quer começar sem implementação.</strong> No FloraClin você cria a conta e começa no mesmo dia,
          sem taxa de implementação, e paga R$ 99 ou R$ 199 por mês.
        </li>
        <li>
          <strong>Você quer testar antes de pagar.</strong> São 14 dias grátis, sem cartão. A página de planos do
          Clinicorp oferece demonstração, sem teste grátis divulgado.
        </li>
      </ul>

      <h2>Quando o Clinicorp continua a melhor escolha</h2>
      <ul>
        <li>
          <strong>Você também faz odontologia geral</strong> (ortodontia, implantes, alinhadores) e precisa de
          odontograma e gestão de casos.
        </li>
        <li>
          <strong>Você tem várias unidades ou uma franquia</strong> e precisa de ranking e gestão por unidade.
        </li>
        <li>
          <strong>Você precisa de NFS-e, app do paciente e estoque</strong> dentro do sistema. Hoje o FloraClin não
          emite nota fiscal nem controla estoque.
        </li>
        <li>
          <strong>Você quer usuários ilimitados no plano de entrada.</strong> No FloraClin, usuários ilimitados estão
          no plano Pro.
        </li>
      </ul>

      <h2>Como trocar</h2>
      <ol>
        <li>
          <SignupLink>Crie sua conta no FloraClin</SignupLink> e use os 14 dias com alguns pacientes reais.
        </li>
        <li>Peça ao Clinicorp a exportação do cadastro dos seus pacientes.</li>
        <li>Fale com a gente para importar a base. Mantenha o sistema antigo até conferir tudo.</li>
      </ol>
      <p>
        Quer ver outras opções? O{" "}
        <Link href="/melhores-sistemas-clinica-estetica-harmonizacao-2026">comparativo de sistemas de 2026</Link> traz
        onze sistemas, com os preços publicados nos sites oficiais.
      </p>

      <SourceList sources={[...CLINICORP.sources, ...FLORACLIN.sources]} />
    </ContentPage>
  );
}

import Link from "next/link";
import { ContentPage, contentPageMetadata, type FaqItem } from "@/components/content/content-page";
import { SourceList } from "@/components/content/blocks";
import { SignupLink } from "@/components/signup-link";

const PATH = "/guia-fotos-antes-e-depois";

export const metadata = contentPageMetadata(PATH);

const FAQS: FaqItem[] = [
  {
    question: "Qual a melhor luz para fotos de antes e depois?",
    answer:
      "Luz difusa e frontal, vinda da mesma fonte em todas as sessões: um ring light ou dois softboxes a 45 graus, com as luzes do teto e a luz da janela iguais ou apagadas. O que mais importa é repetir a mesma luz no antes e no depois, porque a sombra muda a leitura de volume e de sulcos.",
  },
  {
    question: "Quais ângulos fotografar na harmonização facial?",
    answer:
      "O conjunto mais usado tem cinco fotos: frontal, três quartos (45 graus) para a direita e para a esquerda, e perfil direito e esquerdo. Para lábios, mento ou olhar, acrescente fotos de detalhe e, quando fizer sentido, fotos com expressão (sorriso, testa franzida) para toxina.",
  },
  {
    question: "Preciso de autorização do paciente para fotografar?",
    answer:
      "Sim. Foto de rosto ligada ao tratamento é dado pessoal sensível pela LGPD, e o uso da imagem também é protegido pelo Código Civil. Registre o consentimento específico para o prontuário e, à parte, a autorização de uso de imagem se pretende publicar. Os dois podem ser revogados pelo paciente.",
  },
  {
    question: "Dentista pode postar antes e depois de harmonização?",
    answer:
      "A Resolução CFO-196/2019 autoriza o cirurgião-dentista que fez o procedimento a divulgar imagens do diagnóstico e da conclusão do tratamento, com Termo de Consentimento Livre e Esclarecido. Vídeos ou fotos do procedimento em andamento são proibidos, fora publicações científicas, e toda publicação precisa ter o nome e o número de inscrição do profissional.",
  },
  {
    question: "Médico pode postar antes e depois?",
    answer:
      "Desde a Resolução CFM nº 2.336/2023, sim, com finalidade educativa: a imagem precisa vir com texto sobre indicações, fatores que influenciam o resultado e complicações; o antes e depois deve mostrar evoluções satisfatórias, insatisfatórias e complicações; o paciente não pode ser identificado; e é vedada qualquer edição ou melhoramento da imagem.",
  },
  {
    question: "O alinhamento automático do FloraClin altera a foto?",
    answer:
      "Não. Na comparação, o FloraClin detecta os olhos nas duas fotos e ajusta posição, escala e rotação da exibição para os rostos ficarem na mesma posição. A foto original fica guardada como foi tirada, sem mudar luz, pele ou contorno.",
  },
];

export default function GuiaFotosPage() {
  return (
    <ContentPage
      path={PATH}
      eyebrow="Guia prático"
      heading="Fotos de antes e depois padronizadas: guia para HOF e estética"
      faqs={FAQS}
      quickAnswer={
        <>
          <p>
            Para o antes e depois ser comparável, repita tudo entre as sessões: <strong>a mesma luz</strong> (difusa e
            frontal), <strong>a mesma distância e lente</strong> (cerca de 1 a 1,5 m, sem grande-angular),{" "}
            <strong>os mesmos cinco ângulos</strong> (frontal, 45° dos dois lados e perfis) e{" "}
            <strong>o mesmo fundo neutro</strong>, com o paciente sem maquiagem e com expressão neutra.
          </p>
          <p>
            Foto clínica de rosto é dado sensível pela LGPD: registre o consentimento para o prontuário e, à parte, a
            autorização de uso de imagem se for publicar. Para divulgar, siga a Resolução CFO-196/2019 (dentistas) ou a
            Resolução CFM nº 2.336/2023 (médicos).
          </p>
        </>
      }
      related={[
        "/software-harmonizacao-orofacial",
        "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
        "/floraclin-vs-simplu",
      ]}
      ctaTitle="Fotos comparáveis sem esforço"
      ctaText="No FloraClin, a câmera guia a pose, tira a foto sozinha e alinha o antes e depois. 14 dias grátis, sem cartão."
    >
      <p>
        Uma foto de antes e depois só serve se a diferença que aparece for o resultado do procedimento, e não da luz,
        do ângulo ou da distância. Na harmonização isso é ainda mais delicado: alguns milímetros de rotação ou uma
        sombra mais forte mudam a leitura de volume, de sulco e de contorno. Este guia reúne o que padronizar, como
        cuidar do consentimento e o que os conselhos permitem publicar.
      </p>

      <h2>1. Luz: difusa, frontal e sempre igual</h2>
      <ul>
        <li>
          Use uma fonte de luz difusa e de frente para o paciente: um ring light na altura do rosto ou dois softboxes a
          cerca de 45 graus, um de cada lado.
        </li>
        <li>
          Elimine as outras fontes. Luz de teto cria sombra nos olhos e no sulco nasogeniano, e luz de janela muda ao
          longo do dia.
        </li>
        <li>
          Fixe a temperatura de cor. Se o celular permitir, trave o balanço de branco e a exposição antes de
          fotografar.
        </li>
        <li>
          Desligue filtros de beleza, modo retrato e qualquer retoque automático. Eles alteram pele e contorno, que é
          justamente o que você quer comparar.
        </li>
      </ul>

      <h2>2. Distância e lente</h2>
      <ul>
        <li>
          Fotografe sempre da mesma distância, de preferência entre 1 e 1,5 metro, usando o zoom óptico (2x ou 3x)
          quando o celular tiver. A lente grande-angular, perto do rosto, aumenta o nariz e afina as laterais.
        </li>
        <li>
          Marque a posição do paciente e do fotógrafo no chão, ou use um tripé com altura anotada.
        </li>
        <li>Câmera na altura dos olhos do paciente, sem inclinar para cima ou para baixo.</li>
        <li>Use o mesmo aparelho em todas as sessões do mesmo paciente.</li>
      </ul>

      <h2>3. Os cinco ângulos</h2>
      <ol>
        <li>
          <strong>Frontal:</strong> olhar para a lente, cabeça reta. A linha entre as pupilas deve ficar horizontal.
        </li>
        <li>
          <strong>Três quartos (45°) direito e esquerdo:</strong> gire o corpo, não só a cabeça. A ponta do nariz fica
          perto do contorno da bochecha do lado oposto.
        </li>
        <li>
          <strong>Perfil direito e esquerdo:</strong> 90 graus, com a orelha visível e o olhar no horizonte.
        </li>
      </ol>
      <p>
        Mantenha a cabeça no plano de Frankfurt (da borda inferior da órbita ao trágus, na horizontal). Para lábios,
        mento e olheiras, acrescente fotos de detalhe. Para toxina botulínica, fotografe também em contração (sorriso,
        testa franzida, olhos fechados com força), porque o resultado aparece no movimento.
      </p>

      <h2>4. Fundo e preparo do paciente</h2>
      <ul>
        <li>Fundo liso, fosco e neutro (cinza claro, azul ou preto), sem objetos atrás.</li>
        <li>Cabelo preso atrás das orelhas, sem brincos, óculos ou maquiagem.</li>
        <li>Expressão neutra, boca relaxada e dentes em contato leve, salvo nas fotos de expressão.</li>
        <li>Roupa de cor neutra ou um avental padrão, para não refletir cor no rosto.</li>
      </ul>

      <h2>5. Quando fotografar</h2>
      <p>
        Combine marcos fixos e use sempre os mesmos: antes do procedimento, logo depois, e nos retornos (por exemplo 7,
        30 e 90 dias). Anote produto, quantidade e região no prontuário junto com as fotos, para saber exatamente o
        que cada imagem mostra.
      </p>

      <h2>6. Consentimento e LGPD</h2>
      <p>
        Pela Lei Geral de Proteção de Dados (Lei 13.709/2018), dado referente à saúde e dado biométrico ligados a uma
        pessoa são <strong>dados pessoais sensíveis</strong> (art. 5º, II). Uma foto de rosto feita para documentar um
        tratamento entra aí. O tratamento de dado sensível com base no consentimento exige que ele seja dado de forma
        específica e destacada, para finalidades específicas (art. 11, I), e consentimento é uma manifestação livre,
        informada e inequívoca (art. 5º, XII).
      </p>
      <p>Na prática:</p>
      <ul>
        <li>
          Separe a <strong>finalidade clínica</strong> (documentar no prontuário) da{" "}
          <strong>finalidade de divulgação</strong> (redes sociais, site, aulas). São autorizações diferentes.
        </li>
        <li>
          Na autorização de uso de imagem, diga onde a foto pode aparecer, se o rosto será mostrado ou recortado, e por
          quanto tempo. O direito à própria imagem também é protegido pelo Código Civil (art. 20).
        </li>
        <li>Guarde o termo assinado junto ao prontuário e registre se o paciente revogar.</li>
        <li>
          Não guarde fotos de pacientes na galeria pessoal do celular nem em grupos de WhatsApp. Use um sistema com
          acesso por usuário.
        </li>
      </ul>

      <h2>7. O que os conselhos permitem publicar</h2>
      <p>
        As regras mudam conforme a profissão de quem fez o procedimento. Este resumo não substitui a leitura da norma
        nem a orientação do seu conselho regional.
      </p>

      <h3>Cirurgiões-dentistas: Resolução CFO-196/2019</h3>
      <ul>
        <li>
          Autoriza divulgar imagens do <strong>diagnóstico e da conclusão</strong> do tratamento, feitas pelo
          cirurgião-dentista responsável pelo procedimento, com autorização prévia do paciente por Termo de
          Consentimento Livre e Esclarecido (art. 2º).
        </li>
        <li>
          Continua proibido usar expressões que caracterizem sensacionalismo, autopromoção, concorrência desleal,
          mercantilização da Odontologia ou promessa de resultado (art. 2º, § 1º).
        </li>
        <li>
          Proíbe vídeos e imagens do transcurso ou da realização do procedimento, exceto em publicações científicas
          (art. 3º).
        </li>
        <li>
          Toda publicação deve ter o nome e o número de inscrição do profissional, e é vedado divulgar casos de outros
          profissionais (art. 4º).
        </li>
      </ul>

      <h3>Médicos: Resolução CFM nº 2.336/2023</h3>
      <p>O art. 14 permite usar imagens de pacientes com finalidade educativa. Para demonstrar resultados:</p>
      <ul>
        <li>
          A imagem vem acompanhada de texto educativo com indicações, fatores que influenciam o resultado e
          complicações descritas na literatura.
        </li>
        <li>
          O antes e depois é apresentado num conjunto com indicações, evoluções satisfatórias, insatisfatórias e
          complicações e, quando aplicável, diferentes biotipos, faixas etárias e evoluções imediatas, mediatas e
          tardias.
        </li>
        <li>
          É vedado usar imagens de procedimentos que identifiquem o paciente e qualquer edição, manipulação ou
          melhoramento das imagens.
        </li>
        <li>
          Com fotos do próprio acervo, é preciso autorização do paciente, respeito ao pudor e à privacidade, e garantia
          de anonimato mesmo com a autorização.
        </li>
      </ul>

      <h3>Farmacêuticos, biomédicos e outras profissões</h3>
      <p>
        Farmacêuticos e biomédicos que atuam em estética seguem as normas de ética e publicidade do Conselho Federal de
        Farmácia (CFF) e do Conselho Federal de Biomedicina (CFBM). Consulte a versão vigente no site do seu conselho
        antes de publicar, e aplique de qualquer forma o cuidado com consentimento descrito acima.
      </p>

      <h2>8. Como o FloraClin ajuda na padronização</h2>
      <p>O FloraClin foi feito para que essas regras virem rotina, sem depender de memória:</p>
      <ul>
        <li>
          <strong>Captura guiada:</strong> a câmera mostra o contorno da pose (frontal, 45° e perfis), confere se o rosto
          está na posição e no tamanho certos e tira a foto sozinha quando está tudo certo.
        </li>
        <li>
          <strong>Alinhamento automático:</strong> na comparação, o sistema detecta os olhos nas duas fotos e coloca os
          rostos na mesma posição, escala e rotação. A foto original não é alterada.
        </li>
        <li>
          <strong>Linha do tempo:</strong> cada foto fica marcada como pré, pós-imediato, 7, 30 ou 90 dias, junto ao
          procedimento e ao diagrama facial.
        </li>
        <li>
          <strong>Anotações:</strong> setas, círculos e régua sobre a foto, sem mexer na imagem original.
        </li>
        <li>
          <strong>Termos assinados no celular:</strong> o paciente assina o consentimento por um link no WhatsApp, e o
          termo fica no prontuário.
        </li>
      </ul>
      <p>
        O alinhamento serve para comparar dentro do prontuário. Se for publicar, siga as regras do seu conselho, que
        podem vedar recortes ou edições.{" "}
        <Link href="/software-harmonizacao-orofacial">Veja o FloraClin para HOF</Link> ou{" "}
        <SignupLink>teste grátis por 14 dias</SignupLink>.
      </p>

      <SourceList
        intro="Normas consultadas nos sites oficiais em 21/10/2026. Confira sempre a versão vigente."
        sources={[
          {
            label: "Resolução CFO-196/2019 (Conselho Federal de Odontologia)",
            url: "https://sistemas.cfo.org.br/visualizar/atos/RESOLU%C3%87%C3%83O/SEC/2019/196",
          },
          {
            label: "Resolução CFM nº 2.336/2023 (Diário Oficial da União)",
            url: "https://www.in.gov.br/web/dou/-/resolucao-cfm-n-2.336-de-13-de-julho-de-2023-509398401",
          },
          {
            label: "Lei 13.709/2018, LGPD (Planalto)",
            url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm",
          },
          {
            label: "Código Civil, Lei 10.406/2002 (Planalto)",
            url: "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
          },
          { label: "Conselho Federal de Farmácia", url: "https://www.cff.org.br/" },
          { label: "Conselho Federal de Biomedicina", url: "https://cfbm.gov.br/" },
        ]}
      />
    </ContentPage>
  );
}

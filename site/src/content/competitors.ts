/**
 * Competitor facts for the comparison pages.
 *
 * Every value was read on the vendor's own public page on 21/10/2026 (see
 * `sources`). Anything the page didn't show is "não divulgado" (the vendor
 * doesn't publish it) or "não verificado" (we couldn't confirm it), never a
 * guess. Update `SOURCES_CHECKED_ON` in components/content/blocks.tsx and the
 * pages' `updated` date in lib/site-pages.ts when you re-check.
 */
export interface CompetitorFacts {
  name: string;
  /** One-line positioning, in the vendor's own terms. */
  focus: string;
  price: string;
  trial: string;
  prontuario: string;
  facialMap: string;
  beforeAfter: string;
  lgpd: string;
  /** Where it is better than FloraClin, stated plainly. */
  strengths: string;
  sources: { label: string; url: string }[];
}

export const FLORACLIN: CompetitorFacts = {
  name: "FloraClin",
  focus: "Feito para Harmonização Orofacial.",
  price: "Starter R$ 99/mês; Pro R$ 199/mês (cobrança mensal)",
  trial: "14 dias grátis, sem cartão",
  prontuario: "Sim, com timeline de evolução, anamnese e termos assinados no celular",
  facialMap:
    "Sim: diagrama facial (frente e perfis) com produto, quantidade, técnica e profundidade em cada ponto; lote e validade do produto no procedimento",
  beforeAfter: "Sim, alinhamento automático por detecção facial, com captura guiada por pose",
  lgpd: "Criptografia em trânsito e em repouso, registro de consentimentos e trilha de auditoria",
  strengths: "",
  sources: [{ label: "FloraClin, planos", url: "https://floraclin.com.br/#precos" }],
};

export const COMPETITORS = {
  clinicorp: {
    name: "Clinicorp",
    focus: "Odontologia e estética, com planos para redes e franquias.",
    price:
      "Standard R$ 159,90/mês e Premium R$ 369,90/mês no cartão; implementação obrigatória cobrada à parte (valor não divulgado)",
    trial: "Não divulgado (oferece demonstração)",
    prontuario: "Sim (prontuário e anamnese digital, fichas por especialidade)",
    facialMap: "Não verificado",
    beforeAfter: "Não verificado para fotos clínicas (o módulo adicional Clinicorp IA simula o antes e depois do sorriso)",
    lgpd: "Declara seguir a LGPD; prontuário criptografado em nuvem",
    strengths:
      "Usuários ilimitados em todos os planos, odontograma, app do paciente gratuito, emissão de NFS-e (com custo adicional), gestão de várias unidades e importação de dados em até 3 dias úteis.",
    sources: [
      { label: "Clinicorp, planos", url: "https://www.clinicorp.com/planos" },
      { label: "Clinicorp, página principal", url: "https://www.clinicorp.com/" },
    ],
  },
  belle: {
    name: "Belle Software",
    focus: "Clínicas de estética e odontologia, incluindo franquias.",
    price:
      "Não verificado (o valor depende do número de agendas e não aparece na página); módulos à parte, como WhatsApp R$ 229/mês e assinatura eletrônica R$ 45/mês",
    trial: "14 dias grátis, sem cartão",
    prontuario: "Sim, com IA que transcreve áudios",
    facialMap: "Não verificado (tem módulo de HOF)",
    beforeAfter: "Não verificado",
    lgpd: "Não verificado",
    strengths:
      "Usuários administrativos e cadastros ilimitados, armazenamento ilimitado, odontograma, app para clientes e muitos módulos para clínicas grandes e franquias.",
    sources: [
      { label: "Belle Software, planos e preços", url: "https://www.bellesoftware.com.br/precos/" },
      { label: "Belle Software, recursos", url: "https://www.bellesoftware.com.br/" },
    ],
  },
  simplu: {
    name: "Simplu",
    focus: "Feito para harmonização.",
    price: "R$ 297/mês no mensal ou R$ 252/mês no anual, tudo ilimitado",
    trial: "Não tem; oferece 7 dias de garantia com reembolso e demonstração gratuita",
    prontuario: "Sim, com relatório assinável e exportação em PDF e Excel",
    facialMap: "Sim: mapa facial 3D com produto, dose e lote em cada ponto, com baixa no estoque",
    beforeAfter: "Sim: a IA alinha o rosto e equilibra a luz das duas fotos",
    lgpd: "Declara conformidade com a LGPD",
    strengths:
      "Mapa facial 3D, baixa automática de estoque pelo lote aplicado, equilíbrio de luz nas fotos, pacientes, equipe e mensagens ilimitados, migração e configuração inclusas.",
    sources: [{ label: "Simplu, página principal e preços", url: "https://www.simplu.com.br/" }],
  },
  iter: {
    name: "Iter Clinic",
    focus: "Estética facial e corporal, medicina estética e áreas próximas.",
    price: "Solo R$ 69, Silver R$ 99, Gold R$ 169 e Platinum R$ 309 por mês; a partir de R$ 39/mês no anual",
    trial: "Não tem; oferece 14 dias de garantia com reembolso",
    prontuario: "Sim",
    facialMap: "Não verificado",
    beforeAfter: "Fotos de antes e depois; alinhamento automático não informado",
    lgpd: "Declara conformidade com a LGPD e dados hospedados no Brasil",
    strengths:
      "Preço de entrada mais baixo que o do FloraClin para quem atende sozinho, dados hospedados no Brasil e um assistente de gestão (Gênio) incluso em todos os planos.",
    sources: [{ label: "Iter Clinic, planos", url: "https://www.iterclinic.com/" }],
  },
  agendiva: {
    name: "Agendiva",
    focus: "Estética brasileira, de autônomas a estúdios com equipe.",
    price: "Solo R$ 39,90, Pro R$ 49,90 e Studio R$ 99,90 por mês",
    trial: "14 dias grátis, sem cartão",
    prontuario: "Sim, com anamnese assinada; o registro não pode ser apagado depois",
    facialMap: "Sim (Pro e Studio): mapa do rosto com dose por ponto, lote, validade e foto da etiqueta",
    beforeAfter: "Fotos lado a lado; alinhamento automático não informado",
    lgpd: "Declara conformidade com a LGPD e DPO ativo",
    strengths:
      "Preço de entrada baixo, recepcionista sem custo, WhatsApp incluso sem custo por envio e registro de injetáveis com foto da etiqueta.",
    sources: [
      { label: "Agendiva, preços", url: "https://agendiva.com.br/precos" },
      { label: "Agendiva, página principal", url: "https://agendiva.com.br/" },
    ],
  },
  harmony: {
    name: "Harmony",
    focus: "Clínicas e profissionais de estética.",
    price: "Essentials R$ 89,90/mês (1 membro), Profissional R$ 189,90/mês (até 5), Enterprise a partir de R$ 389,90/mês",
    trial: "7 dias grátis; o cartão é pedido na ativação",
    prontuario: "Sim, com anamnese assinada",
    facialMap: "Não verificado (permite desenhar o planejamento sobre a foto)",
    beforeAfter: "Comparação com cortina arrastável; alinhamento automático não informado",
    lgpd: "Não verificado",
    strengths:
      "Assistente no WhatsApp (Mony) incluso, assinaturas eletrônicas no plano, cobrança por Pix e cartão conciliada no financeiro.",
    sources: [
      { label: "Harmony, preços", url: "https://www.harmonyapp.com.br/pricing" },
      { label: "Harmony, página principal", url: "https://www.harmonyapp.com.br/" },
    ],
  },
  trinks: {
    name: "Trinks",
    focus: "Salões de beleza, barbearias, clínicas de estética e studios.",
    price: "Não verificado (os valores carregam por faixa de profissionais e não ficaram visíveis na consulta)",
    trial: "5 dias grátis",
    prontuario: "Não verificado",
    facialMap: "Não verificado",
    beforeAfter: "Não verificado",
    lgpd: "Não verificado",
    strengths:
      "Conta digital integrada, app de agendamento para clientes, clube de assinaturas e programa de fidelidade, pensados para o varejo de beleza.",
    sources: [{ label: "Trinks, planos", url: "https://negocios.trinks.com/planos/" }],
  },
  sante: {
    name: "Santé",
    focus: "Saúde em geral, com produtos para odontologia e para clínicas.",
    price: "A partir de R$ 117,52/mês no anual à vista (Santé Clinic e Santé Odonto)",
    trial: "7 dias grátis, sem cartão",
    prontuario: "Sim, com registro fotográfico de evolução",
    facialMap: "Sim: módulo de HOF com cada ponto na anatomia facial (produto, região, unidades e valor)",
    beforeAfter: "Comparação por sessão e exportação em PDF; alinhamento automático não informado",
    lgpd: "Declara conformidade com a LGPD; dados na AWS com criptografia e backup em 3 países",
    strengths:
      "Módulo de HOF junto com odontograma no mesmo sistema, importação gratuita do cadastro de pacientes e agente de atendimento com IA (contratado à parte).",
    sources: [
      { label: "Santé, página principal", url: "https://www.santesistemas.io/" },
      { label: "Santé, planos", url: "https://www.santesistemas.io/planos" },
      { label: "Santé, harmonização orofacial", url: "https://www.santesistemas.io/harmonizacao-orofacial" },
    ],
  },
  tuttohof: {
    name: "TuttoHOF",
    focus: "Feito para harmonização orofacial.",
    price: "R$ 49,99/mês (de R$ 69,99) para até 5 usuários, como exibido na página",
    trial: "90 dias grátis, sem cartão",
    prontuario: "Sim, por procedimento, com linha do tempo",
    facialMap: "Não verificado",
    beforeAfter: "Galeria lado a lado com marca d'água; alinhamento automático não informado",
    lgpd: "Auditoria de acessos, consentimentos e exportação",
    strengths:
      "Teste grátis muito mais longo, rastreabilidade de lote e validade com alerta de vencimento e separação de dados por clínica.",
    sources: [{ label: "TuttoHOF, página principal e planos", url: "https://tuttohof.com.br/" }],
  },
  clinicaExperts: {
    name: "Clínica Experts",
    focus: "Sistema para clínicas e consultórios de várias áreas da saúde, com vertical de estética.",
    price:
      "No anual: Essencial 12x R$ 249 (até 3 usuários) e Avançado 12x R$ 399 (até 10); Experts sob orçamento. Mensal: não verificado",
    trial: "7 dias grátis, sem cartão",
    prontuario: "Sim, com transcrição do atendimento por IA",
    facialMap: "Planejador de injetáveis com os pontos marcados sobre a foto",
    beforeAfter: "Comparação arrastando sobre as fotos; alinhamento automático não informado",
    lgpd: "Declara conformidade com a LGPD e registra histórico de acessos e modificações",
    strengths:
      "Assistente de IA no WhatsApp 24h (Anna), transcrição do atendimento, análise de pele por IA, nota fiscal e teleconsulta (no plano Experts ou como adicionais) e odontograma.",
    sources: [
      { label: "Clínica Experts, planos", url: "https://clinicaexperts.com.br/planos" },
      { label: "Clínica Experts, estética", url: "https://clinicaexperts.com.br/solucoes/estetica" },
      { label: "Clínica Experts, injetáveis", url: "https://clinicaexperts.com.br/features/injetaveis" },
      {
        label: "Clínica Experts, perguntas e respostas",
        url: "https://clinicaexperts.com.br/blog/50-perguntas-e-respostas-sobre-o-clinica-experts",
      },
    ],
  },
} satisfies Record<string, CompetitorFacts>;

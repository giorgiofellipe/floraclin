import { LLMS_SECTIONS, SITE_PAGES, absoluteUrl } from "@/lib/site-pages";
import { SIGNUP_URL } from "@/lib/marketing-attribution";

/** llms.txt (llmstxt.org format), generated from the page registry. */
export function buildLlmsTxt(): string {
  const sections = LLMS_SECTIONS.flatMap((section) => {
    const pages = SITE_PAGES.filter((page) => page.llmsSection === section);
    if (pages.length === 0) return [];
    const links = pages.map((page) => `- [${page.title}](${absoluteUrl(page.path)}): ${page.summary}`);
    return [[`## ${section}`, "", ...links].join("\n")];
  });

  return [
    "# FloraClin",
    "",
    "> Sistema de gestão clínica feito exclusivamente para clínicas de Harmonização Orofacial (HOF) no Brasil.",
    "",
    "FloraClin é uma plataforma SaaS que integra agenda, prontuário eletrônico, diagrama facial interativo, gestão financeira, assinatura digital, agendamento online, anamnese self-service, confirmações por WhatsApp e fotos de antes e depois com alinhamento automático, feita para dentistas e profissionais de HOF. Planos: Starter R$ 99/mês e Pro R$ 199/mês, com teste grátis de 14 dias sem cartão.",
    "",
    ...sections.flatMap((section) => [section, ""]),
    "## Links",
    "",
    `- [Cadastro gratuito](${SIGNUP_URL})`,
    "- [Aplicação](https://app.floraclin.com.br)",
    `- [Informações detalhadas](${absoluteUrl("/llms-full.txt")})`,
    "",
    "## Contato",
    "",
    "- Email: contato@floraclin.com.br",
    "- WhatsApp: +55 47 93618-1734",
    "- Instagram: @floraclin",
    "",
    "## Empresa",
    "",
    "Bullcode Serviços em Tecnologia LTDA",
    "CNPJ: 27.435.275/0001-04",
    "",
  ].join("\n");
}

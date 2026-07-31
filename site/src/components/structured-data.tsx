const SCHEMAS = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "FloraClin",
    legalName: "Bullcode Servicos em Tecnologia LTDA",
    url: "https://floraclin.com.br",
    logo: "https://floraclin.com.br/brand/logo-symbol.png",
    description:
      "Plataforma de gestão clínica para Harmonização Orofacial (HOF).",
    contactPoint: [
      {
        "@type": "ContactPoint",
        telephone: "+55-47-93618-2197",
        contactType: "customer service",
        availableLanguage: "Portuguese",
        areaServed: "BR",
      },
      {
        "@type": "ContactPoint",
        email: "contato@floraclin.com.br",
        contactType: "customer service",
        availableLanguage: "Portuguese",
      },
    ],
    sameAs: ["https://instagram.com/floraclin"],
    address: { "@type": "PostalAddress", addressCountry: "BR" },
    taxID: "27.435.275/0001-04",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FloraClin",
    description:
      "Plataforma SaaS de gestão clínica feita exclusivamente para clínicas de Harmonização Orofacial (HOF). Integra agenda, prontuário, diagrama facial, financeiro, assinatura digital e agendamento online.",
    url: "https://floraclin.com.br",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "pt-BR",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "BRL",
      lowPrice: "0",
      highPrice: "199",
      offerCount: "3",
      offers: [
        {
          "@type": "Offer",
          name: "Teste Grátis",
          price: "0",
          priceCurrency: "BRL",
          description: "Teste grátis de 14 dias com todas as funcionalidades, sem cartão de crédito.",
          priceValidUntil: "2027-12-31",
        },
        {
          "@type": "Offer",
          name: "Plano Starter",
          price: "99",
          priceCurrency: "BRL",
          description: "R$ 99/mês. 300 créditos de WhatsApp/mês, 5 usuários, número próprio de WhatsApp.",
          priceValidUntil: "2027-12-31",
        },
        {
          "@type": "Offer",
          name: "Plano Pro",
          price: "199",
          priceCurrency: "BRL",
          description: "R$ 199/mês. 1000 créditos de WhatsApp/mês, usuários ilimitados, número próprio de WhatsApp.",
          priceValidUntil: "2027-12-31",
        },
      ],
    },
    featureList: [
      "Diagrama facial interativo",
      "Comparação antes e depois com alinhamento automático",
      "Captura guiada com pose e auto-take",
      "Fluxo completo de atendimento guiado",
      "Anamnese self-service pelo celular",
      "Assinatura digital de termos e contratos",
      "Agendamento online",
      "Sincronização com Google Calendar",
      "Prontuário digital com timeline de evolução",
      "Financeiro com parcelas, comissões e despesas",
      "Pacotes de procedimentos com controle de sessões",
      "CRM de pacientes",
      "Confirmação e lembrete automático de consultas",
    ],
    provider: { "@type": "Organization", name: "FloraClin" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Preciso instalar alguma coisa?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Não. FloraClin funciona 100% no navegador, no computador ou celular. Nada para instalar.",
        },
      },
      {
        "@type": "Question",
        name: "Funciona para clínicas com mais de um profissional?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sim. A agenda mostra todos os profissionais lado a lado, com controle de acesso por perfil (proprietário, profissional, recepcionista, financeiro).",
        },
      },
      {
        "@type": "Question",
        name: "Meus pacientes precisam criar conta?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Não. O paciente recebe um link por WhatsApp para agendar, preencher a anamnese e assinar termos. Sem cadastro, sem senha.",
        },
      },
      {
        "@type": "Question",
        name: "Como funciona o alinhamento de fotos?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "O sistema detecta o rosto automaticamente e alinha as fotos de antes e depois para que a comparação seja precisa. Você também pode capturar com guia de pose, que indica a posição ideal e tira a foto sozinho quando está tudo certo.",
        },
      },
      {
        "@type": "Question",
        name: "Posso migrar meus dados de outro sistema?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sim. Entre em contato conosco e ajudamos na migração.",
        },
      },
      {
        "@type": "Question",
        name: "O sistema envia lembretes de consulta?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sim. O FloraClin envia confirmação e lembrete automático por WhatsApp. O paciente confirma ou reagenda sem precisar ligar.",
        },
      },
      {
        "@type": "Question",
        name: "Tem CRM de pacientes?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sim. Você tem o histórico completo de cada paciente, com tags e acompanhamento de retorno. Sabe exatamente quem precisa de follow-up.",
        },
      },
      {
        "@type": "Question",
        name: "Quanto custa?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "14 dias grátis, sem cartão. Depois, R$ 99/mês no plano Starter ou R$ 199/mês no Pro, que traz mais créditos de WhatsApp, usuários ilimitados e número próprio de WhatsApp.",
        },
      },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "FloraClin",
    url: "https://floraclin.com.br",
    inLanguage: "pt-BR",
    description:
      "Gestão clínica para Harmonização Orofacial — agenda, prontuário, diagrama facial, financeiro.",
  },
];

export function StructuredData() {
  return (
    <>
      {SCHEMAS.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}

export interface TemplateVariable {
  index: number
  key: string
  label: string
  example: string
}

export interface VariablePaletteItem {
  key: string
  label: string
  example: string
}

export interface TemplateBlueprint {
  slug: string
  purposeKey: string
  name: string
  category: 'UTILITY' | 'MARKETING'
  language: string
  components: Record<string, unknown>[]
  variables: TemplateVariable[]
  description: string
}

export const PREDEFINED_VARIABLES: VariablePaletteItem[] = [
  { key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
  { key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
  { key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
  { key: 'appointment_time', label: 'Horário', example: '14:30' },
  { key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
  { key: 'amount', label: 'Valor (R$)', example: '350,00' },
  { key: 'due_date', label: 'Data de vencimento', example: '20/04/2026' },
  { key: 'link', label: 'Link', example: 'https://app.floraclin.com/...' },
  { key: 'instructions', label: 'Orientações', example: 'Evitar exposição solar...' },
]

export const PURPOSE_LABELS: Record<string, string> = {
  appointment_reminder: 'Lembrete de consulta',
  appointment_confirmation: 'Confirmação de consulta',
  follow_up: 'Acompanhamento',
  reschedule_notification: 'Reagendamento',
  payment_reminder: 'Lembrete de pagamento',
  payment_confirmation: 'Confirmação de pagamento',
  anamnese_link: 'Link de anamnese',
  pre_procedure_instructions: 'Orientações pré-procedimento',
  post_procedure_care: 'Cuidados pós-procedimento',
  document_request: 'Solicitação de documentos',
  birthday_greeting: 'Aniversário',
  reactivation: 'Reativação',
  resume_conversation: 'Retomar conversa',
  consent_signing_link: 'Assinatura de termos',
}

function makeBody(text: string, variables: TemplateVariable[]): Record<string, unknown>[] {
  return [
    {
      type: 'BODY',
      text,
      example: {
        body_text: [variables.map((v) => v.example)],
      },
    },
  ]
}

export const TEMPLATE_BLUEPRINTS: TemplateBlueprint[] = [
  {
    slug: 'appointment_reminder',
    purposeKey: 'appointment_reminder',
    name: 'appointment_reminder',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Lembrete de consulta agendada',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
      { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
    ],
    components: makeBody(
      'Olá, {{1}}! Lembramos que você tem um atendimento agendado na {{2}} no dia {{3}}, às {{4}}. Caso precise reagendar, entre em contato conosco. Até lá!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
        { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
      ],
    ),
  },
  {
    slug: 'appointment_confirmation',
    purposeKey: 'appointment_confirmation',
    name: 'confirm_appointment',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Confirmação de presença na consulta',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
      { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
    ],
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{1}}! Gostaríamos de confirmar sua presença na {{2}} no dia {{3}}, às {{4}}. Por favor, confirme abaixo.',
        example: {
          body_text: [['Maria Silva', 'Clínica Flora', '15/04/2026', '14:30']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar' },
          { type: 'QUICK_REPLY', text: 'Reagendar' },
        ],
      },
    ],
  },
  {
    slug: 'follow_up',
    purposeKey: 'follow_up',
    name: 'follow_up',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Acompanhamento pós-procedimento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
    ],
    components: makeBody(
      'Olá, {{1}}! Passando para saber como você está se sentindo após o procedimento de {{2}}. Qualquer dúvida, estamos à disposição! 😊',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
      ],
    ),
  },
  {
    slug: 'reschedule',
    purposeKey: 'reschedule_notification',
    name: 'reschedule_notification',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Notificação de reagendamento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'appointment_date', label: 'Nova data', example: '20/04/2026' },
      { index: 3, key: 'appointment_time', label: 'Novo horário', example: '16:00' },
    ],
    components: makeBody(
      'Olá, {{1}}. Informamos que seu atendimento foi reagendado para o dia {{2}}, às {{3}}. Caso tenha alguma dúvida, estamos à disposição.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'appointment_date', label: 'Nova data', example: '20/04/2026' },
        { index: 3, key: 'appointment_time', label: 'Novo horário', example: '16:00' },
      ],
    ),
  },
  {
    slug: 'payment_reminder',
    purposeKey: 'payment_reminder',
    name: 'payment_reminder',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Lembrete de pagamento pendente',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
      { index: 3, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 4, key: 'due_date', label: 'Data de vencimento', example: '20/04/2026' },
    ],
    components: makeBody(
      'Olá, {{1}}. Informamos que o pagamento no valor de R$ {{2}} referente ao seu atendimento na {{3}} tem vencimento em {{4}}. Qualquer dúvida, estamos à disposição.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
        { index: 3, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 4, key: 'due_date', label: 'Data de vencimento', example: '20/04/2026' },
      ],
    ),
  },
  {
    slug: 'payment_confirmation',
    purposeKey: 'payment_confirmation',
    name: 'payment_confirmation',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Confirmação de recebimento de pagamento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
    ],
    components: makeBody(
      'Olá, {{1}}! Confirmamos o recebimento do seu pagamento no valor de R$ {{2}}. Agradecemos pela pontualidade! 😊',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
      ],
    ),
  },
  {
    slug: 'anamnese_link',
    purposeKey: 'anamnese_link',
    name: 'anamnesis_link',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Link para preenchimento de anamnese',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
    ],
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{1}}! Para agilizar seu atendimento na {{2}}, pedimos que preencha sua ficha de anamnese clicando no botão abaixo. Qualquer dúvida, estamos à disposição.',
        example: {
          body_text: [['Maria Silva', 'Clínica Flora']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Preencher anamnese',
            url: 'https://app.floraclin.com.br/a/{{1}}',
            example: ['abc123'],
          },
        ],
      },
    ],
  },
  {
    slug: 'pre_procedure',
    purposeKey: 'pre_procedure_instructions',
    name: 'pre_procedure_instructions',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Orientações pré-procedimento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Preenchimento labial' },
      { index: 3, key: 'instructions', label: 'Orientações', example: 'Evitar anti-inflamatórios 7 dias antes.' },
    ],
    components: makeBody(
      'Olá, {{1}}! Seu procedimento de {{2}} está se aproximando. Seguem orientações importantes para o preparo:\n\n{{3}}\n\nEm caso de dúvidas, entre em contato conosco.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Preenchimento labial' },
        { index: 3, key: 'instructions', label: 'Orientações', example: 'Evitar anti-inflamatórios 7 dias antes.' },
      ],
    ),
  },
  {
    slug: 'post_procedure',
    purposeKey: 'post_procedure_care',
    name: 'post_procedure_care',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Cuidados pós-procedimento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
      { index: 3, key: 'instructions', label: 'Cuidados', example: 'Não deitar por 4 horas.' },
    ],
    components: makeBody(
      'Olá, {{1}}! Seguem os cuidados recomendados após o seu procedimento de {{2}}:\n\n{{3}}\n\nLembre-se de seguir as orientações para o melhor resultado. Estamos à disposição!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
        { index: 3, key: 'instructions', label: 'Cuidados', example: 'Não deitar por 4 horas.' },
      ],
    ),
  },
  {
    slug: 'document_request',
    purposeKey: 'document_request',
    name: 'document_request',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Solicitação de documentos',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'instructions', label: 'Documentos', example: 'RG, CPF e comprovante de endereço.' },
    ],
    components: makeBody(
      'Olá, {{1}}. Para dar continuidade ao seu atendimento na {{2}}, precisamos dos seguintes documentos:\n\n{{3}}\n\nPor favor, envie assim que possível.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 3, key: 'instructions', label: 'Documentos', example: 'RG, CPF e comprovante de endereço.' },
      ],
    ),
  },
  {
    slug: 'birthday',
    purposeKey: 'birthday_greeting',
    name: 'birthday_greeting',
    category: 'MARKETING',
    language: 'pt_BR',
    description: 'Mensagem de aniversário',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
    ],
    components: makeBody(
      'Parabéns, {{1}}! 🎂 Toda a equipe da {{2}} deseja a você um dia muito especial e cheio de alegrias. Conte sempre conosco!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      ],
    ),
  },
  {
    slug: 'reactivation',
    purposeKey: 'reactivation',
    name: 'reactivation',
    category: 'MARKETING',
    language: 'pt_BR',
    description: 'Reativação de pacientes inativos',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
    ],
    components: makeBody(
      'Olá, {{1}}! Sentimos sua falta na {{2}}. 😊 Que tal agendar uma visita? Estamos com novidades que podem te interessar. Aguardamos seu contato!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      ],
    ),
  },
  {
    slug: 'resume_conversation',
    purposeKey: 'resume_conversation',
    name: 'resume_conversation',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Retomar conversa com paciente (abre janela de 24h)',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
    ],
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{1}}! Podemos retomar nossa conversa?',
        example: {
          body_text: [['Maria Silva']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Sim' },
          { type: 'QUICK_REPLY', text: 'Não' },
        ],
      },
    ],
  },
  {
    slug: 'consent_signing_link',
    purposeKey: 'consent_signing_link',
    name: 'consent_signing_link',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Link para assinatura remota de termos de consentimento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'link', label: 'Link de assinatura', example: 'https://app.floraclin.com/sign/abc123' },
    ],
    components: makeBody(
      'Olá {{1}}, a clínica {{2}} enviou os termos do seu procedimento para assinatura. Acesse o link para revisar e assinar:\n\n{{3}}\n\nEste link é válido por 24 horas.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 3, key: 'link', label: 'Link de assinatura', example: 'https://app.floraclin.com/sign/abc123' },
      ],
    ),
  },
]

export function generateTemplateName(tenantName: string, blueprintName: string): string {
  let slug = tenantName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  if (!slug || /^\d/.test(slug)) {
    slug = `fc_${slug}`
  }
  return `${slug}_${blueprintName}`
}

/**
 * A tenant's WhatsApp templates all share the prefix `${prefix}_`, derived
 * from the clinic name (see generateTemplateName). Every WABA on FloraClin
 * is shared across multiple tenants, so this prefix is the only reliable
 * way to tell which templates in a Meta API response belong to which clinic.
 */
export function resolveTemplatePrefix(
  tenantName: string,
  existingPrefix?: string | null,
): string {
  if (existingPrefix) return existingPrefix
  return generateTemplateName(tenantName, '').replace(/_$/, '')
}

/** True when a Meta template name belongs to the tenant identified by `prefix`. */
export function belongsToTemplatePrefix(templateName: string, prefix: string): boolean {
  if (!prefix) return false
  return templateName.startsWith(`${prefix}_`)
}

/**
 * Finds the blueprint whose `name` matches the end of a full template name
 * (`${prefix}_${blueprint.name}`). When more than one blueprint name would
 * match as a suffix, the longest one wins. A naive first-match can pick a
 * shorter blueprint name that happens to also be a suffix of a longer one.
 */
export function findBlueprintForTemplateName(
  templateName: string,
  blueprints: TemplateBlueprint[] = TEMPLATE_BLUEPRINTS,
): TemplateBlueprint | null {
  let best: TemplateBlueprint | null = null
  for (const blueprint of blueprints) {
    const matches =
      templateName === blueprint.name || templateName.endsWith(`_${blueprint.name}`)
    if (matches && (!best || blueprint.name.length > best.name.length)) {
      best = blueprint
    }
  }
  return best
}

/**
 * Friendly Portuguese label for a template row. Prefers the persisted
 * purposeKey (set by provisioning); falls back to matching the template
 * name against the blueprint list; falls back to the raw template name.
 */
export function getTemplateDisplayLabel(template: {
  purposeKey: string | null
  name: string
}): string {
  if (template.purposeKey && PURPOSE_LABELS[template.purposeKey]) {
    return PURPOSE_LABELS[template.purposeKey]
  }
  const blueprint = findBlueprintForTemplateName(template.name)
  if (blueprint && PURPOSE_LABELS[blueprint.purposeKey]) {
    return PURPOSE_LABELS[blueprint.purposeKey]
  }
  return template.name
}

export interface TemplatePreview {
  body: string
  buttons: string[]
}

interface PreviewableTemplate {
  name: string
  purposeKey: string | null
  components: unknown
  variableMapping?: unknown
}

// An empty array counts as absent, not as "this template has no variables":
// a row stored with variable_mapping [] would otherwise suppress the
// blueprint fallback and render raw {{1}} placeholders to the clinic.
function isVariableList(value: unknown): value is TemplateVariable[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as TemplateVariable).index === 'number' &&
        typeof (v as TemplateVariable).key === 'string' &&
        typeof (v as TemplateVariable).example === 'string',
    )
  )
}

function resolvePreviewVariables(template: PreviewableTemplate): TemplateVariable[] {
  if (isVariableList(template.variableMapping)) return template.variableMapping
  const byPurpose = template.purposeKey
    ? TEMPLATE_BLUEPRINTS.find((b) => b.purposeKey === template.purposeKey)
    : null
  const blueprint = byPurpose ?? findBlueprintForTemplateName(template.name)
  return blueprint?.variables ?? []
}

/**
 * Renders a template the way the patient receives it: body text with every
 * {{n}} replaced by an example value, and the clinic's real name in place of
 * the clinic_name variable. Used by the read-only view clinics on the shared
 * FloraClin number get instead of template management.
 *
 * Client-safe on purpose — lib/whatsapp.ts pulls in node crypto and the db
 * client, so resolveTemplateBody can't be reused from a client component.
 */
export function buildTemplatePreview(
  template: PreviewableTemplate,
  clinicName: string,
): TemplatePreview {
  const components = (
    Array.isArray(template.components) ? template.components : []
  ).filter(
    (c): c is Record<string, unknown> => typeof c === 'object' && c !== null,
  )

  const bodyComponent = components.find((c) => c.type === 'BODY')
  let body = typeof bodyComponent?.text === 'string' ? bodyComponent.text : ''

  for (const variable of resolvePreviewVariables(template)) {
    const value = variable.key === 'clinic_name' ? clinicName : variable.example
    body = body.replaceAll(`{{${variable.index}}}`, value)
  }

  const buttonsComponent = components.find((c) => c.type === 'BUTTONS')
  const buttons = Array.isArray(buttonsComponent?.buttons)
    ? (buttonsComponent.buttons as Record<string, unknown>[])
        .map((b) => (typeof b.text === 'string' ? b.text : ''))
        .filter(Boolean)
    : []

  return { body, buttons }
}

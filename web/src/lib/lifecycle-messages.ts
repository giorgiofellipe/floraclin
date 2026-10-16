import type { ActivationState } from '@/lib/activation'
import type { EmailContent } from '@/lib/email-layout'

export type LifecycleMessageKey =
  | 'trial_welcome'
  | 'trial_ending'
  | 'trial_feedback'
  | 'trial_setup_incomplete'
  | 'trial_first_patient'
  | 'trial_first_record'
  | 'trial_first_appointment'

interface LifecycleEmail {
  preheader: string
  heading: string
  intro: string
  points: string[]
  closing: string
}

export interface LifecycleMessage {
  key: LifecycleMessageKey
  templateName: string
  trackedTemplateName?: string
  category: 'UTILITY' | 'MARKETING'
  emailSubject: string
  body: string
  email: LifecycleEmail
  button: { label: string; path: string } | null
  isDue: (state: ActivationState) => boolean
}

export const OPT_OUT_FOOTER = 'Para não receber mais dicas, responda PARAR.'

const isTrialing = (state: ActivationState) => state.subscriptionStatus === 'trialing'

export const LIFECYCLE_MESSAGES: readonly LifecycleMessage[] = [
  {
    key: 'trial_welcome',
    templateName: 'trial_welcome',
    trackedTemplateName: 'trial_welcome_click',
    category: 'UTILITY',
    emailSubject: 'Sua conta na FloraClin está pronta',
    body: 'Olá, {{1}}! Sua conta na FloraClin está pronta. Comece pelo diagrama facial: cadastre um paciente e registre o primeiro procedimento em menos de 5 minutos.',
    email: {
      preheader: 'Comece pelo diagrama facial: o primeiro procedimento leva menos de 5 minutos.',
      heading: 'Sua conta está pronta',
      intro: 'Olá, {{1}}! Sua clínica já está criada na FloraClin e o teste gratuito de 14 dias começou. O melhor jeito de conhecer a plataforma é registrar um atendimento real:',
      points: [
        'Cadastre um paciente com nome e telefone',
        'No perfil do paciente, clique em Iniciar atendimento',
        'Marque os pontos no diagrama facial, com produto e quantidade',
      ],
      closing: 'Dúvidas no caminho? Responda a este e-mail. Lemos cada mensagem.',
    },
    button: { label: 'Abrir FloraClin', path: '/dashboard' },
    isDue: isTrialing,
  },
  {
    key: 'trial_ending',
    templateName: 'trial_ending',
    trackedTemplateName: 'trial_ending_click',
    category: 'MARKETING',
    emailSubject: 'Seu teste termina em 2 dias',
    body: 'Olá, {{1}}! Seu teste gratuito da FloraClin termina em 2 dias. Para manter a agenda, os pacientes e o WhatsApp funcionando, escolha um plano.',
    email: {
      preheader: 'Escolha um plano para continuar usando a agenda e o WhatsApp.',
      heading: 'Seu teste termina em 2 dias',
      intro: 'Olá, {{1}}! Seu teste gratuito da FloraClin termina em 2 dias. Para continuar sem interrupção, escolha um plano. Tudo o que você cadastrou continua no lugar:',
      points: [
        'Pacientes, prontuários e diagramas faciais',
        'Agenda e confirmações por WhatsApp',
        'Histórico financeiro e documentos assinados',
      ],
      closing: 'Quer ajuda para escolher o plano? Responda a este e-mail.',
    },
    button: { label: 'Ver planos', path: '/configuracoes?tab=assinatura' },
    isDue: (state) => isTrialing(state) && state.daysLeft === 2,
  },
  {
    key: 'trial_feedback',
    templateName: 'trial_feedback',
    category: 'MARKETING',
    emailSubject: 'O que faltou na FloraClin?',
    body: 'Olá, {{1}}! Seu teste na FloraClin terminou. O que faltou para você continuar? Responda esta mensagem, lemos cada resposta.',
    email: {
      preheader: 'Conte para a gente o que faltou. Lemos cada resposta.',
      heading: 'O que faltou na FloraClin?',
      intro: 'Olá, {{1}}! Seu teste na FloraClin terminou. Queremos entender o que faltou para você continuar. Uma frase já ajuda muito, por exemplo:',
      points: [
        'Uma funcionalidade que você precisava',
        'Algo que ficou difícil de usar',
        'Preço ou momento da clínica',
      ],
      closing: 'Basta responder a este e-mail. Lemos cada resposta e usamos para decidir as próximas melhorias.',
    },
    button: null,
    isDue: (state) =>
      state.subscriptionStatus === 'expired' &&
      state.subscriptionSource === 'trial' &&
      state.daysLeft <= -2,
  },
  {
    key: 'trial_setup_incomplete',
    templateName: 'trial_setup_incomplete',
    trackedTemplateName: 'trial_setup_incomplete_click',
    category: 'MARKETING',
    emailSubject: 'Faltam 3 minutos para liberar sua agenda',
    body: 'Olá, {{1}}! Faltam 3 minutos para terminar a configuração da sua clínica na FloraClin. Depois disso, a agenda e os pacientes ficam liberados.',
    email: {
      preheader: 'Termine a configuração e libere a agenda e os pacientes.',
      heading: 'Faltam 3 minutos para liberar sua agenda',
      intro: 'Olá, {{1}}! A configuração da sua clínica na FloraClin ainda não terminou. São só alguns dados e, depois disso, tudo fica liberado:',
      points: [
        'Dados da clínica',
        'Procedimentos e produtos que você usa',
        'Equipe que atende com você',
      ],
      closing: 'Se algo travou na configuração, responda a este e-mail e ajudamos.',
    },
    button: { label: 'Terminar configuração', path: '/onboarding' },
    isDue: (state) => isTrialing(state) && state.trialDay >= 1 && !state.onboardingDone,
  },
  {
    key: 'trial_first_patient',
    templateName: 'trial_first_patient',
    trackedTemplateName: 'trial_first_patient_click',
    category: 'MARKETING',
    emailSubject: 'Seu primeiro paciente na FloraClin',
    body: 'Olá, {{1}}! O primeiro passo na FloraClin é cadastrar um paciente. Leva 1 minuto e libera o diagrama facial, a agenda e o WhatsApp.',
    email: {
      preheader: 'Leva 1 minuto e libera o diagrama facial, a agenda e o WhatsApp.',
      heading: 'Cadastre seu primeiro paciente',
      intro: 'Olá, {{1}}! O primeiro passo na FloraClin é cadastrar um paciente. Leva 1 minuto, e com ele o resto da plataforma fica disponível:',
      points: [
        'Diagrama facial para marcar pontos, produto e quantidade',
        'Agenda com confirmação de consulta por WhatsApp',
        'Histórico pronto para a próxima sessão',
      ],
      closing: 'Dúvidas? Responda a este e-mail. Lemos cada mensagem.',
    },
    button: { label: 'Cadastrar paciente', path: '/pacientes?novo=1' },
    isDue: (state) => isTrialing(state) && state.trialDay >= 2 && !state.hasPatient,
  },
  {
    key: 'trial_first_record',
    templateName: 'trial_first_record',
    trackedTemplateName: 'trial_first_record_click',
    category: 'MARKETING',
    emailSubject: 'Registre um procedimento no diagrama facial',
    body: 'Olá, {{1}}! Já registrou um procedimento no diagrama facial? Marque os pontos, o produto e a quantidade. O histórico do paciente fica pronto para a próxima sessão.',
    email: {
      preheader: 'Marque pontos, produto e quantidade direto no rosto do paciente.',
      heading: 'Registre um procedimento no diagrama facial',
      intro: 'Olá, {{1}}! O diagrama facial é o coração da FloraClin. Para usar, abra o paciente e clique em Iniciar atendimento. Nele você registra tudo o que fez na sessão:',
      points: [
        'Pontos de aplicação marcados no rosto',
        'Produto, lote e quantidade aplicados',
        'Fotos de antes e depois no mesmo histórico',
      ],
      closing: 'Na próxima sessão, o histórico do paciente já está pronto para consulta.',
    },
    button: { label: 'Abrir pacientes', path: '/pacientes' },
    isDue: (state) => isTrialing(state) && state.trialDay >= 4 && !state.hasProcedureRecord,
  },
  {
    key: 'trial_first_appointment',
    templateName: 'trial_first_appointment',
    trackedTemplateName: 'trial_first_appointment_click',
    category: 'MARKETING',
    emailSubject: 'Agenda com confirmação por WhatsApp',
    body: 'Olá, {{1}}! Agende o próximo atendimento na FloraClin e deixe a confirmação por WhatsApp com a gente. O paciente confirma com um toque.',
    email: {
      preheader: 'O paciente confirma o horário com um toque no WhatsApp.',
      heading: 'Agenda com confirmação por WhatsApp',
      intro: 'Olá, {{1}}! Agende o próximo atendimento na FloraClin e deixe a confirmação com a gente:',
      points: [
        'Ative a confirmação de consulta nas configurações do WhatsApp',
        'O paciente confirma ou pede para remarcar com um toque',
        'A agenda atualiza o status sozinha',
      ],
      closing: 'Menos faltas e menos mensagens manuais para a sua equipe.',
    },
    button: { label: 'Abrir agenda', path: '/agenda?open=new' },
    isDue: (state) =>
      isTrialing(state) &&
      state.trialDay >= 7 &&
      (!state.hasAppointment || !state.hasWhatsappSend),
  },
]

const welcome = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_welcome')
if (!welcome) throw new Error('trial_welcome message is not defined')
export const LIFECYCLE_WELCOME: LifecycleMessage = welcome

export function selectDueMessages(
  state: ActivationState,
  completedKeys: ReadonlySet<string>,
): LifecycleMessage[] {
  return LIFECYCLE_MESSAGES.filter(
    (message) =>
      !completedKeys.has(message.key) &&
      message.isDue(state) &&
      !(state.optedOut && message.category === 'MARKETING'),
  )
}

export function renderLifecycleEmail(message: LifecycleMessage, firstName: string): EmailContent {
  const { intro, ...rest } = message.email
  return { ...rest, paragraphs: [intro.replace('{{1}}', () => firstName)] }
}

export function ownerFirstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || 'tudo bem'
}

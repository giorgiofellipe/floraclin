import type { ActivationState } from '@/lib/activation'

export type LifecycleMessageKey =
  | 'trial_welcome'
  | 'trial_ending'
  | 'trial_feedback'
  | 'trial_setup_incomplete'
  | 'trial_first_patient'
  | 'trial_first_record'
  | 'trial_first_appointment'

export interface LifecycleMessage {
  key: LifecycleMessageKey
  templateName: string
  category: 'UTILITY' | 'MARKETING'
  emailSubject: string
  body: string
  button: { label: string; path: string } | null
  isDue: (state: ActivationState) => boolean
}

export const OPT_OUT_FOOTER = 'Para não receber mais dicas, responda PARAR.'

const isTrialing = (state: ActivationState) => state.subscriptionStatus === 'trialing'

export const LIFECYCLE_MESSAGES: readonly LifecycleMessage[] = [
  {
    key: 'trial_welcome',
    templateName: 'trial_welcome',
    category: 'UTILITY',
    emailSubject: 'Sua conta na FloraClin está pronta',
    body: 'Olá, {{1}}! Sua conta na FloraClin está pronta. Comece pelo diagrama facial: cadastre um paciente e registre o primeiro procedimento em menos de 5 minutos.',
    button: { label: 'Abrir FloraClin', path: '/dashboard' },
    isDue: isTrialing,
  },
  {
    key: 'trial_ending',
    templateName: 'trial_ending',
    category: 'UTILITY',
    emailSubject: 'Seu teste termina em 2 dias',
    body: 'Olá, {{1}}! Seu teste gratuito da FloraClin termina em 2 dias. Para manter a agenda, os pacientes e o WhatsApp funcionando, escolha um plano.',
    button: { label: 'Ver planos', path: '/configuracoes?tab=assinatura' },
    isDue: (state) => isTrialing(state) && state.daysLeft === 2,
  },
  {
    key: 'trial_feedback',
    templateName: 'trial_feedback',
    category: 'MARKETING',
    emailSubject: 'O que faltou na FloraClin?',
    body: 'Olá, {{1}}! Seu teste na FloraClin terminou. O que faltou para você continuar? Responda esta mensagem, lemos cada resposta.',
    button: null,
    isDue: (state) =>
      state.subscriptionStatus === 'expired' &&
      state.subscriptionSource === 'trial' &&
      state.daysLeft <= -2,
  },
  {
    key: 'trial_setup_incomplete',
    templateName: 'trial_setup_incomplete',
    category: 'MARKETING',
    emailSubject: 'Faltam 3 minutos para liberar sua agenda',
    body: 'Olá, {{1}}! Faltam 3 minutos para terminar a configuração da sua clínica na FloraClin. Depois disso, a agenda e os pacientes ficam liberados.',
    button: { label: 'Terminar configuração', path: '/onboarding' },
    isDue: (state) => isTrialing(state) && state.trialDay >= 1 && !state.onboardingDone,
  },
  {
    key: 'trial_first_patient',
    templateName: 'trial_first_patient',
    category: 'MARKETING',
    emailSubject: 'Seu primeiro paciente na FloraClin',
    body: 'Olá, {{1}}! O primeiro passo na FloraClin é cadastrar um paciente. Leva 1 minuto e libera o diagrama facial, a agenda e o WhatsApp.',
    button: { label: 'Cadastrar paciente', path: '/pacientes?novo=1' },
    isDue: (state) => isTrialing(state) && state.trialDay >= 2 && !state.hasPatient,
  },
  {
    key: 'trial_first_record',
    templateName: 'trial_first_record',
    category: 'MARKETING',
    emailSubject: 'Registre um procedimento no diagrama facial',
    body: 'Olá, {{1}}! Já registrou um procedimento no diagrama facial? Marque os pontos, o produto e a quantidade. O histórico do paciente fica pronto para a próxima sessão.',
    button: { label: 'Abrir pacientes', path: '/pacientes' },
    isDue: (state) => isTrialing(state) && state.trialDay >= 4 && !state.hasProcedureRecord,
  },
  {
    key: 'trial_first_appointment',
    templateName: 'trial_first_appointment',
    category: 'MARKETING',
    emailSubject: 'Agenda com confirmação por WhatsApp',
    body: 'Olá, {{1}}! Agende o próximo atendimento na FloraClin e deixe a confirmação por WhatsApp com a gente. O paciente confirma com um toque.',
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

export function renderLifecycleBody(message: LifecycleMessage, firstName: string): string {
  return message.body.replace('{{1}}', firstName)
}

export function ownerFirstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || 'tudo bem'
}

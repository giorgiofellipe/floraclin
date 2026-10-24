import type { ActivationState } from '@/lib/activation'
import { brCalendarDaysBetween, brEndPhrase, formatBrDayMonth } from '@/lib/dates'
import type { EmailContent } from '@/lib/email-layout'
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_URL } from '@/lib/support'
import { trialRecapLines, usedTrial, type TrialRecap } from '@/lib/trial-recap'

export type LifecycleMessageKey =
  | 'trial_welcome'
  | 'trial_ending_soon'
  | 'trial_last_day'
  | 'trial_winback'
  | 'trial_help'
  | 'trial_final'
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

/** Per-clinic data a message can render with. Loaded only for messages that
 *  define `render`, right before the email goes out. */
export interface LifecycleRenderContext {
  now: Date
  /** End of the trial (current_period_end). */
  endsAt: Date
  recap: TrialRecap | null
  /** Win-back offer Stripe has just confirmed (see getValidatedWinbackOffer). */
  offer: { label: string; endsAt: string } | null
}

export interface LifecycleMessage {
  key: LifecycleMessageKey
  /**
   * Meta template for the WhatsApp channel. Each send checks its status on
   * Meta (lifecycle-template-status.ts): until it is APPROVED the message goes
   * out by email only and the WhatsApp channel is recorded as skipped.
   */
  templateName: string
  category: 'UTILITY' | 'MARKETING'
  emailSubject: string
  body: string
  email: LifecycleEmail
  button: { label: string; path: string } | null
  /** Email built from live data (dates, recap, offer) instead of the static
   *  `emailSubject` / `email`, which stay as the fallback and the admin copy. */
  render?: (ctx: LifecycleRenderContext) => { subject: string; email: LifecycleEmail }
  /** Overrides the default reply-to (contato@) for this message's email. */
  replyTo?: () => string
  /** Render needs the validated win-back offer (a Stripe check); others skip it. */
  usesOffer?: boolean
  isDue: (state: ActivationState) => boolean
}

/**
 * Never more than one marketing message every ~2 days. 44h rather than 48h so
 * a cron run a few minutes early never turns "two days later" into a skip.
 */
export const MARKETING_SPACING_MS = 44 * 60 * 60 * 1000

export const OPT_OUT_FOOTER = 'Para não receber mais dicas, responda PARAR.'

// A row can still say `trialing` for a few hours after the trial ended (the
// expiry cron runs at 00:00 BRT), but access ends at the exact instant, so
// nothing written for a running trial may go out after it.
const isTrialing = (state: ActivationState) => state.subscriptionStatus === 'trialing' && state.msLeft > 0

const DAY_MS = 24 * 60 * 60 * 1000

// Onboarding nudges stop 5 days before the end so the conversion messages
// (D-3, last day) always clear the spacing rule.
const isOnboardingWindow = (state: ActivationState) => isTrialing(state) && state.daysLeft >= 5

/** A free trial (not a gift or a lapsed paid plan) that ended N BR days ago. */
const expiredTrialDaysAgo = (state: ActivationState, from: number, to: number) =>
  state.subscriptionStatus === 'expired' &&
  state.subscriptionSource === 'trial' &&
  -state.daysLeft >= from &&
  -state.daysLeft <= to

/** "hoje às 18:30" / "amanhã às 18:30": the same words as the banner. */
export function trialEndPhrase(endsAt: Date, now: Date): string {
  return brEndPhrase(endsAt, now)
}

/** Win-back offers go into an email only with at least 72 hours left, so the
 *  date the email promises is always comfortably ahead. */
const OFFER_MIN_LEAD_MS = 72 * 60 * 60 * 1000

function emailOffer(ctx: LifecycleRenderContext) {
  if (!ctx.offer) return null
  return new Date(ctx.offer.endsAt).getTime() - ctx.now.getTime() >= OFFER_MIN_LEAD_MS ? ctx.offer : null
}

function recapPoints(ctx: LifecycleRenderContext, fallback: string[]): string[] {
  const lines = trialRecapLines(ctx.recap)
  return lines.length > 0 ? lines : fallback
}

/** Where help requests go. Defaults to the shared inbox; set
 *  LIFECYCLE_HELP_REPLY_TO to route them to a person. */
export function helpReplyTo(env: Record<string, string | undefined> = process.env): string {
  return env.LIFECYCLE_HELP_REPLY_TO?.trim() || SUPPORT_EMAIL
}

export const LIFECYCLE_MESSAGES: readonly LifecycleMessage[] = [
  {
    key: 'trial_welcome',
    templateName: 'trial_welcome_click',
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
    key: 'trial_last_day',
    templateName: 'trial_last_day_click',
    category: 'MARKETING',
    emailSubject: 'Último dia do seu teste na FloraClin',
    body: 'Olá, {{1}}! Seu teste gratuito da FloraClin termina em menos de 24 horas. Assine agora para não perder o acesso à agenda, aos pacientes e ao WhatsApp.',
    email: {
      preheader: 'Seu teste termina em menos de 24 horas. Assine para não perder o acesso.',
      heading: 'Último dia do seu teste',
      intro: 'Olá, {{1}}! Seu teste gratuito da FloraClin termina em menos de 24 horas. Depois disso a conta fica em modo leitura: você consulta e exporta tudo, mas não cadastra, não agenda e não envia WhatsApp. Assinando agora, nada para:',
      points: [
        'Agenda e confirmações por WhatsApp continuam funcionando',
        'Pacientes, prontuários e diagramas faciais seguem editáveis',
        'Leva 2 minutos, com cartão de crédito',
      ],
      closing: 'Ficou alguma dúvida sobre os planos? Responda a este e-mail.',
    },
    button: { label: 'Assinar agora', path: '/configuracoes?tab=assinatura' },
    render: (ctx) => {
      const when = trialEndPhrase(ctx.endsAt, ctx.now)
      const kept = trialRecapLines(ctx.recap)
      return {
        subject: `Seu teste na FloraClin termina ${when}`,
        email: {
          preheader: `Seu teste termina ${when}. Assine para não perder o acesso.`,
          heading: `Seu teste termina ${when}`,
          intro:
            kept.length > 0
              ? `Olá, {{1}}! Seu teste gratuito da FloraClin termina ${when}. Depois disso a conta fica em modo leitura: você consulta e exporta tudo, mas não cadastra, não agenda e não envia WhatsApp. Veja o que sua clínica já montou aqui:`
              : `Olá, {{1}}! Seu teste gratuito da FloraClin termina ${when}. Depois disso a conta fica em modo leitura: você consulta e exporta tudo, mas não cadastra, não agenda e não envia WhatsApp. Assinando agora, nada para:`,
          points: recapPoints(ctx, [
            'Agenda e confirmações por WhatsApp continuam funcionando',
            'Pacientes, prontuários e diagramas faciais seguem editáveis',
            'Leva 2 minutos, com cartão de crédito',
          ]),
          closing:
            kept.length > 0
              ? 'Assinando, tudo continua funcionando como hoje. Ficou alguma dúvida sobre os planos? Responda a este e-mail.'
              : 'Ficou alguma dúvida sobre os planos? Responda a este e-mail.',
        },
      }
    },
    // Within the last 24 hours rather than "on the BR calendar day of the end":
    // the cron runs at 10:00 BRT, so a trial ending at 08:00 would otherwise
    // never get its last-day message.
    isDue: (state) => isTrialing(state) && state.msLeft <= DAY_MS,
  },
  {
    key: 'trial_ending_soon',
    templateName: 'trial_ending_soon_click',
    category: 'MARKETING',
    emailSubject: 'Seu teste termina em 3 dias',
    body: 'Olá, {{1}}! Seu teste gratuito da FloraClin termina em 3 dias. Escolha um plano para manter a agenda, os pacientes e o WhatsApp funcionando.',
    email: {
      preheader: 'Faltam 3 dias. Escolha um plano para continuar sem interrupção.',
      heading: 'Seu teste termina em 3 dias',
      intro: 'Olá, {{1}}! Seu teste gratuito da FloraClin termina em 3 dias. Escolha um plano agora e continue sem interrupção. Tudo o que você cadastrou continua no lugar:',
      points: [
        'Pacientes, prontuários e diagramas faciais',
        'Agenda e confirmações por WhatsApp',
        'Histórico financeiro e documentos assinados',
      ],
      closing: 'Quer ajuda para escolher o plano? Responda a este e-mail.',
    },
    button: { label: 'Ver planos', path: '/configuracoes?tab=assinatura' },
    isDue: (state) => isTrialing(state) && state.daysLeft === 3,
  },
  // ─── After the trial ended ────────────────────────────────────────
  // One message around D+2 (win-back for clinics that used the trial, a help
  // offer for those that never got going) and one final message at D+7..10.
  // They replace the old D+2 "o que faltou?" email: the reply-to-this-email
  // question lives on in both.
  {
    key: 'trial_winback',
    usesOffer: true,
    templateName: 'trial_winback_click',
    category: 'MARKETING',
    emailSubject: 'Sua clínica continua salva na FloraClin',
    body: 'Olá, {{1}}! Seu teste na FloraClin terminou, mas tudo o que você cadastrou continua salvo. Assine para voltar a usar a agenda, os pacientes e o WhatsApp.',
    email: {
      preheader: 'Tudo o que você cadastrou continua salvo. Assine para continuar.',
      heading: 'Sua clínica continua salva',
      intro: 'Olá, {{1}}! Seu teste na FloraClin terminou, mas nada se perdeu. Assinando, você volta exatamente de onde parou:',
      points: [
        'Pacientes, prontuários e diagramas faciais',
        'Agenda e confirmações por WhatsApp',
        'Histórico financeiro e documentos assinados',
      ],
      closing: 'Se algo faltou para você continuar, responda a este e-mail. Lemos cada resposta.',
    },
    button: { label: 'Ver planos', path: '/configuracoes?tab=assinatura' },
    render: (ctx) => {
      const offer = emailOffer(ctx)
      return {
        subject: offer ? `Uma oferta para voltar à FloraClin: ${offer.label}` : 'Sua clínica continua salva na FloraClin',
        email: {
          preheader: offer
            ? `${offer.label}, válida até ${formatBrDayMonth(offer.endsAt)}.`
            : 'Tudo o que você cadastrou continua salvo. Assine para continuar.',
          heading: offer ? 'Uma oferta para você voltar' : 'Sua clínica continua salva',
          intro: offer
            ? `Olá, {{1}}! Seu teste na FloraClin terminou, mas nada se perdeu. Para você voltar de onde parou: ${offer.label}, aplicado automaticamente no pagamento até ${formatBrDayMonth(offer.endsAt)}. Sua clínica já tem:`
            : 'Olá, {{1}}! Seu teste na FloraClin terminou, mas nada se perdeu. Assinando, você volta exatamente de onde parou. Sua clínica já tem:',
          points: recapPoints(ctx, [
            'Pacientes, prontuários e diagramas faciais',
            'Agenda e confirmações por WhatsApp',
            'Histórico financeiro e documentos assinados',
          ]),
          closing: 'Se algo faltou para você continuar, responda a este e-mail. Lemos cada resposta.',
        },
      }
    },
    isDue: (state) => expiredTrialDaysAgo(state, 2, 6) && usedTrial(state),
  },
  {
    key: 'trial_help',
    templateName: 'trial_help_click',
    category: 'MARKETING',
    emailSubject: 'Precisa de ajuda para começar na FloraClin?',
    body: 'Olá, {{1}}! Vimos que você não chegou a usar a FloraClin no teste. Precisa de ajuda para começar? Responda esta mensagem e configuramos junto com você.',
    email: {
      preheader: 'Configuramos a clínica junto com você, sem custo.',
      heading: 'Precisa de ajuda para começar?',
      intro: 'Olá, {{1}}! Seu teste na FloraClin terminou antes de você conseguir cadastrar pacientes e montar a agenda. Isso é comum na correria da clínica. Se quiser, a gente ajuda a começar:',
      points: [
        'Uma conversa rápida para entender como sua clínica funciona',
        'Ajuda para cadastrar os primeiros pacientes e procedimentos',
        'Dicas para usar a agenda e as confirmações por WhatsApp',
      ],
      closing: 'É só responder a este e-mail ou chamar a gente no WhatsApp. Sua conta e o que você já cadastrou continuam salvos.',
    },
    button: { label: 'Falar no WhatsApp', path: SUPPORT_WHATSAPP_URL },
    replyTo: () => helpReplyTo(),
    isDue: (state) => expiredTrialDaysAgo(state, 2, 6) && !usedTrial(state),
  },
  {
    key: 'trial_final',
    usesOffer: true,
    templateName: 'trial_final_click',
    category: 'MARKETING',
    emailSubject: 'Sua conta na FloraClin continua guardada',
    body: 'Olá, {{1}}! Sua conta na FloraClin continua guardada, em modo leitura. Quando quiser voltar, é só escolher um plano. Esta é a nossa última mensagem sobre o teste.',
    email: {
      preheader: 'Quando quiser voltar, é só escolher um plano.',
      heading: 'Sua conta continua guardada',
      intro: 'Olá, {{1}}! Sua conta na FloraClin continua guardada, em modo leitura: você pode consultar e exportar tudo quando quiser. Para voltar a usar a agenda, os pacientes e o WhatsApp, é só escolher um plano.',
      points: [],
      closing: 'Esta é a nossa última mensagem sobre o seu teste. Se quiser conversar, responda a este e-mail.',
    },
    button: { label: 'Ver planos', path: '/configuracoes?tab=assinatura' },
    render: (ctx) => {
      const offer = emailOffer(ctx)
      return {
        subject: offer ? `Última chance: ${offer.label} na FloraClin` : 'Sua conta na FloraClin continua guardada',
        email: {
          preheader: offer
            ? `${offer.label} até ${formatBrDayMonth(offer.endsAt)}.`
            : 'Quando quiser voltar, é só escolher um plano.',
          heading: 'Sua conta continua guardada',
          intro: offer
            ? `Olá, {{1}}! Sua conta na FloraClin continua guardada, em modo leitura. A oferta para você voltar (${offer.label}) vale até ${formatBrDayMonth(offer.endsAt)}, aplicada automaticamente no pagamento.`
            : 'Olá, {{1}}! Sua conta na FloraClin continua guardada, em modo leitura: você pode consultar e exportar tudo quando quiser. Para voltar a usar a agenda, os pacientes e o WhatsApp, é só escolher um plano.',
          points: trialRecapLines(ctx.recap),
          closing: 'Esta é a nossa última mensagem sobre o seu teste. Se quiser conversar, responda a este e-mail.',
        },
      }
    },
    isDue: (state) => expiredTrialDaysAgo(state, 7, 10),
  },
  {
    key: 'trial_setup_incomplete',
    templateName: 'trial_setup_incomplete_click',
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
    isDue: (state) => isOnboardingWindow(state) && state.trialDay >= 1 && !state.onboardingDone,
  },
  {
    key: 'trial_first_patient',
    templateName: 'trial_first_patient_click',
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
    isDue: (state) => isOnboardingWindow(state) && state.trialDay >= 2 && !state.hasPatient,
  },
  {
    key: 'trial_first_record',
    templateName: 'trial_first_record_click',
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
    isDue: (state) => isOnboardingWindow(state) && state.trialDay >= 4 && !state.hasProcedureRecord,
  },
  {
    key: 'trial_first_appointment',
    templateName: 'trial_first_appointment_click',
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
      isOnboardingWindow(state) &&
      state.trialDay >= 7 &&
      (!state.hasAppointment || !state.hasWhatsappSend),
  },
]

const welcome = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_welcome')
if (!welcome) throw new Error('trial_welcome message is not defined')
export const LIFECYCLE_WELCOME: LifecycleMessage = welcome

export const MARKETING_MESSAGE_KEYS: readonly string[] = LIFECYCLE_MESSAGES.filter(
  (m) => m.category === 'MARKETING',
).map((m) => m.key)

export function selectDueMessages(
  state: ActivationState,
  completedKeys: ReadonlySet<string>,
  now: Date = new Date(),
): LifecycleMessage[] {
  const spaced =
    state.lastMarketingSentAt == null ||
    now.getTime() - state.lastMarketingSentAt.getTime() >= MARKETING_SPACING_MS
  return LIFECYCLE_MESSAGES.filter(
    (message) =>
      !completedKeys.has(message.key) &&
      message.isDue(state) &&
      !(message.category === 'MARKETING' && (state.optedOut || !spaced)),
  )
}

export function renderLifecycleEmail(
  message: LifecycleMessage,
  firstName: string,
  ctx?: LifecycleRenderContext,
): { subject: string; content: EmailContent } {
  const built = ctx && message.render ? message.render(ctx) : { subject: message.emailSubject, email: message.email }
  const { intro, points, ...rest } = built.email
  return {
    subject: built.subject,
    content: { ...rest, points: points.length > 0 ? points : undefined, paragraphs: [intro.replace('{{1}}', () => firstName)] },
  }
}

export function ownerFirstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || 'tudo bem'
}

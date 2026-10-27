import { Resend } from 'resend'
import { getAppUrl } from '@/lib/app-url'
import { renderEmailLayout, type EmailContent } from '@/lib/email-layout'

let _resend: Resend | null = null
function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}
const FROM = process.env.EMAIL_FROM ?? 'FloraClin <contato@floraclin.com.br>'
const LIFECYCLE_REPLY_TO = 'contato@floraclin.com.br'

export async function sendInviteEmail(email: string, url: string, clinicName: string) {
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: `Convite para ${clinicName}`,
    html: renderEmailLayout({
      preheader: `Crie sua conta e acesse ${clinicName} na FloraClin.`,
      heading: 'Você recebeu um convite',
      paragraphs: [
        `Você foi convidado(a) para a clínica ${clinicName} na FloraClin.`,
        'Clique no botão abaixo para criar sua conta e acessar o sistema.',
      ],
      button: { label: 'Aceitar convite', url },
      notes: ['Se você não esperava este convite, ignore este e-mail.'],
    }),
  })
}

export async function sendPasswordResetEmail(email: string, url: string) {
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Redefinir senha — FloraClin',
    html: renderEmailLayout({
      preheader: 'Use o link para criar uma nova senha.',
      heading: 'Redefinir sua senha',
      paragraphs: ['Recebemos uma solicitação para redefinir a senha da sua conta na FloraClin.'],
      button: { label: 'Redefinir senha', url },
      notes: [
        'Este link expira em 1 hora.',
        'Se você não solicitou a redefinição, ignore este e-mail. Sua senha não será alterada.',
      ],
    }),
  })
}

// Resend reports API rejections in the result instead of throwing.
async function sendOrThrow(payload: Parameters<Resend['emails']['send']>[0]): Promise<{ id: string }> {
  const { data, error } = await getResend().emails.send(payload)
  if (error) throw new Error(error.message)
  return { id: data.id }
}

export async function sendConfirmationEmail(email: string, url: string, clinicName: string) {
  await sendOrThrow({
    from: FROM,
    to: email,
    subject: 'Confirme seu e-mail',
    html: renderEmailLayout({
      preheader: 'Falta só um clique para começar seu teste gratuito.',
      heading: 'Confirme seu e-mail',
      paragraphs: [
        `Bem-vindo(a) à ${clinicName}! Falta só confirmar seu e-mail para começar a usar a FloraClin.`,
      ],
      button: { label: 'Confirmar e-mail', url },
      notes: [
        'Este link expira em 24 horas.',
        `Se não foi você quem criou a clínica ${clinicName}, não confirme e ignore este e-mail. Quem criou a conta continuaria com acesso a ela.`,
      ],
    }),
  })
}

export async function sendRejectionEmail(email: string, clinicName: string) {
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Atualização sobre sua solicitação — FloraClin',
    html: renderEmailLayout({
      preheader: `Atualização sobre a clínica ${clinicName}.`,
      heading: 'Atualização sobre sua solicitação',
      paragraphs: [`Infelizmente não foi possível aprovar a clínica ${clinicName} neste momento.`],
      notes: ['Se tiver dúvidas, entre em contato pelo e-mail contato@floraclin.com.br.'],
    }),
  })
}

export async function sendNewSignupNotification(opts: {
  adminEmail: string
  clinicName: string
  ownerName: string
  ownerEmail: string
  phone: string
}) {
  await getResend().emails.send({
    from: FROM,
    to: opts.adminEmail,
    subject: `Nova clínica cadastrada: ${opts.clinicName}`,
    html: renderEmailLayout({
      preheader: `${opts.ownerName} criou a clínica ${opts.clinicName}.`,
      heading: 'Nova clínica cadastrada',
      paragraphs: [
        `${opts.ownerName} criou a clínica ${opts.clinicName}. A conta já está ativa; nada precisa ser aprovado.`,
        `E-mail: ${opts.ownerEmail} · Telefone: ${opts.phone}`,
      ],
      button: { label: 'Ver clínica', url: `${getAppUrl()}/admin/tenants` },
    }),
  })
}

export async function sendLifecycleEmail(opts: {
  to: string
  subject: string
  content: EmailContent
  replyTo?: string
}): Promise<{ id: string }> {
  return sendOrThrow({
    from: FROM,
    to: opts.to,
    replyTo: opts.replyTo ?? LIFECYCLE_REPLY_TO,
    subject: opts.subject,
    html: renderEmailLayout(opts.content),
  })
}

export function sendConfirmationReminderEmail(email: string, url: string, clinicName: string) {
  return sendLifecycleEmail({
    to: email,
    subject: 'Falta confirmar seu e-mail',
    content: {
      preheader: 'Confirme seu e-mail para começar seu teste gratuito.',
      heading: 'Confirme seu e-mail para começar',
      paragraphs: [
        `Você criou a clínica ${clinicName} na FloraClin, mas ainda não confirmou seu e-mail. Confirme para começar a usar o sistema.`,
      ],
      button: { label: 'Confirmar e-mail', url },
      notes: [
        'Este link expira em breve.',
        `Se não foi você quem criou a clínica ${clinicName}, não confirme e ignore este e-mail. Quem criou a conta continuaria com acesso a ela.`,
      ],
    },
  })
}

export function sendFinishSetupReminderEmail(email: string) {
  return sendLifecycleEmail({
    to: email,
    subject: 'Termine de configurar sua clínica na FloraClin',
    content: {
      preheader: 'Faltam poucos passos para começar a usar a FloraClin.',
      heading: 'Sua clínica está quase pronta',
      paragraphs: [
        'Sua conta na FloraClin já está criada. Faltam só alguns dados da clínica para você começar a usar a agenda, os prontuários e o financeiro.',
      ],
      button: { label: 'Terminar configuração', url: `${getAppUrl()}/onboarding` },
    },
  })
}

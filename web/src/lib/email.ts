import { Resend } from 'resend'

/** Escape user-supplied strings before embedding in HTML email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let _resend: Resend | null = null
function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}
const FROM = process.env.EMAIL_FROM ?? 'FloraClin <contato@floraclin.com.br>'

export async function sendMagicLinkEmail(email: string, url: string) {
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Seu link de acesso — FloraClin',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Clique no botão abaixo para acessar sua conta:
        </p>
        <a href="${url}" style="display: inline-block; background: #4A6B52; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Acessar FloraClin
        </a>
        <p style="color: #7A7A7A; font-size: 13px; margin-top: 32px;">
          Se você não solicitou este acesso, ignore este e-mail.
        </p>
        <p style="color: #7A7A7A; font-size: 13px;">
          Este link expira em 24 horas.
        </p>
      </div>
    `,
  })
}

export async function sendInviteEmail(email: string, url: string, clinicName?: string) {
  const safeName = escapeHtml(clinicName ?? 'FloraClin')
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: `Convite para ${safeName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Você foi convidado(a) para a clínica <strong>${safeName}</strong>.
        </p>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Clique no botão abaixo para criar sua conta e acessar o sistema:
        </p>
        <a href="${url}" style="display: inline-block; background: #4A6B52; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Aceitar Convite
        </a>
        <p style="color: #7A7A7A; font-size: 13px; margin-top: 32px;">
          Se você não esperava este convite, ignore este e-mail.
        </p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(email: string, url: string) {
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Redefinir senha — FloraClin',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Recebemos uma solicitação para redefinir sua senha.
        </p>
        <a href="${url}" style="display: inline-block; background: #4A6B52; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Redefinir Senha
        </a>
        <p style="color: #7A7A7A; font-size: 13px; margin-top: 32px;">
          Se você não solicitou a redefinição, ignore este e-mail. Sua senha não será alterada.
        </p>
        <p style="color: #7A7A7A; font-size: 13px;">
          Este link expira em 1 hora.
        </p>
      </div>
    `,
  })
}

export async function sendApprovalEmail(email: string, clinicName: string) {
  const safeName = escapeHtml(clinicName)
  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/login`
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Sua clínica foi aprovada — FloraClin',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Sua clínica <strong>${safeName}</strong> foi aprovada!
        </p>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Faça login para começar a configurar sua clínica.
        </p>
        <a href="${loginUrl}" style="display: inline-block; background: #4A6B52; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Acessar FloraClin
        </a>
      </div>
    `,
  })
}

export async function sendRejectionEmail(email: string, clinicName: string) {
  const safeName = escapeHtml(clinicName)
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Atualização sobre sua solicitação — FloraClin',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Infelizmente não foi possível aprovar a clínica <strong>${safeName}</strong> neste momento.
        </p>
        <p style="color: #7A7A7A; font-size: 13px; margin-top: 32px;">
          Se tiver dúvidas, entre em contato pelo e-mail contato@floraclin.com.br.
        </p>
      </div>
    `,
  })
}

export async function sendNewSignupNotification(opts: {
  adminEmail: string
  clinicName: string
  ownerName: string
  ownerEmail: string
  phone: string
}) {
  const safeName = escapeHtml(opts.clinicName)
  const safeOwner = escapeHtml(opts.ownerName)
  const safeEmail = escapeHtml(opts.ownerEmail)
  const safePhone = escapeHtml(opts.phone)
  const adminUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/admin/tenants`
  await getResend().emails.send({
    from: FROM,
    to: opts.adminEmail,
    subject: `Nova clínica aguardando aprovação — ${opts.clinicName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin — Nova Solicitação</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          <strong>${safeOwner}</strong> solicitou a criação da clínica <strong>${safeName}</strong>.
        </p>
        <p style="color: #2A2A2A; font-size: 14px; line-height: 1.5;">
          E-mail: ${safeEmail}<br/>
          Telefone: ${safePhone}
        </p>
        <a href="${adminUrl}" style="display: inline-block; background: #4A6B52; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Revisar Solicitação
        </a>
      </div>
    `,
  })
}

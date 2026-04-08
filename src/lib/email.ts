import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM ?? 'FloraClin <noreply@floraclin.com.br>'

export async function sendMagicLinkEmail(email: string, url: string) {
  await resend.emails.send({
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
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Convite para ${clinicName ?? 'FloraClin'}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Você foi convidado(a) para a clínica <strong>${clinicName ?? 'FloraClin'}</strong>.
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
  await resend.emails.send({
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

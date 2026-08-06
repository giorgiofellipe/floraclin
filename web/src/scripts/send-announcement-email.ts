/**
 * FloraClin feature-announcement email sender.
 *
 * Reuses the app's Resend integration (RESEND_API_KEY + EMAIL_FROM) and the Drizzle
 * `users` / `tenant_users` tables for the audience. Mirrors the announce-features skill flow:
 * the skill edits FEATURES + SUBJECT each month, sends a TEST first, then (only on explicit
 * human approval) flips SEND_TO_ALL and sends to the userbase.
 *
 * Run (env from web/.env.local is loaded automatically):
 *   cd web && npx tsx --tsconfig tsconfig.json src/scripts/send-announcement-email.ts
 *
 * IMPORTANT: always leave SEND_TO_ALL = false when committing. The script must default to test mode.
 */
import { config as loadEnv } from 'dotenv'
import { Resend } from 'resend'
import { and, eq, isNull } from 'drizzle-orm'
import { users, tenantUsers } from '@/db/schema'

// Load env before the db client (which reads DATABASE_URL at import time) is dynamically imported.
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

// ─── Audience config ────────────────────────────────────────────────
// Test recipients used while SEND_TO_ALL is false.
const TEST_EMAILS: string[] = ['giorgiofellipe@gmail.com']
// Set to true ONLY after human approval to send to the real userbase.
const SEND_TO_ALL = false
// When sending to all, restrict to clinic owners instead of every active member.
const OWNERS_ONLY = false

const FROM = process.env.EMAIL_FROM ?? 'FloraClin <contato@floraclin.com.br>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://floraclin.com.br'

// ─── Content (the announce-features skill edits SUBJECT + FEATURES monthly) ──
const SUBJECT = '🌿 Novidades na FloraClin'

interface Feature {
  emoji: string
  title: string
  description: string
}

const FEATURES: Feature[] = [
  {
    emoji: '🗓️',
    title: 'Agenda mais ágil',
    description: 'Marque, remarque e confirme consultas em menos cliques, com a agenda do dia sempre à mão.',
  },
  {
    emoji: '💬',
    title: 'Lembretes automáticos por WhatsApp',
    description: 'A FloraClin avisa seus pacientes antes da consulta — menos faltas, menos ligações manuais.',
  },
]

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function featureCard(feature: Feature, highlighted: boolean): string {
  const bg = highlighted
    ? 'background: linear-gradient(135deg, #eef4ef 0%, #f6faf6 100%); border-left: 4px solid #4A6B52;'
    : 'background-color: #f8f9fa;'
  return `
    <div style="${bg} border-radius: 10px; padding: 20px 24px; margin: 12px 0;">
      <p style="margin: 0 0 6px; font-size: 17px; font-weight: 700; color: #1C2B1E;">${feature.emoji} ${escapeHtml(feature.title)}</p>
      <p style="margin: 0; font-size: 15px; line-height: 1.55; color: #2A2A2A;">${escapeHtml(feature.description)}</p>
    </div>`
}

function generateEmailHtml(userName: string): string {
  const greetingName = userName ? escapeHtml(userName.split(' ')[0]) : 'tudo bem'
  const cards = FEATURES.map((f, i) => featureCard(f, i === 0)).join('')
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f8f9fa;">
  <div style="background-color: #f8f9fa; padding: 40px 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.08);">
      <div style="padding: 28px 40px; text-align: center; border-bottom: 3px solid #4A6B52;">
        <h1 style="margin: 0; font-size: 24px; color: #1C2B1E;">FloraClin 🌿</h1>
      </div>
      <div style="padding: 32px 40px;">
        <p style="font-size: 16px; color: #2A2A2A;">Olá ${greetingName}! 👋</p>
        <p style="font-size: 16px; line-height: 1.55; color: #2A2A2A;">
          Temos novidades na FloraClin para deixar o dia a dia da sua clínica mais leve. Veja o que chegou:
        </p>
        ${cards}
        <div style="text-align: center; margin: 32px 0 8px;">
          <a href="${APP_URL}/dashboard" style="display: inline-block; background: #4A6B52; color: #ffffff; padding: 13px 28px; border-radius: 6px; text-decoration: none; font-weight: 600;">
            Acessar a FloraClin
          </a>
        </div>
        <p style="font-size: 14px; line-height: 1.55; color: #7A7A7A; margin-top: 28px;">
          Tem uma sugestão? É só responder este e-mail — a gente lê tudo. 💚
        </p>
      </div>
      <div style="padding: 20px 40px; border-top: 1px solid #eee; text-align: center;">
        <p style="font-size: 12px; color: #9AA0A6; margin: 0;">FloraClin · Gestão para clínicas · floraclin.com.br</p>
      </div>
    </div>
  </div>
</body>
</html>`
}

interface Recipient {
  email: string
  name: string
}

async function getRecipients(): Promise<Recipient[]> {
  if (!SEND_TO_ALL) {
    return TEST_EMAILS.map((email) => ({ email, name: '' }))
  }
  const { db } = await import('@/db/client')
  const conditions = [isNull(users.deletedAt), eq(tenantUsers.isActive, true)]
  if (OWNERS_ONLY) {
    conditions.push(eq(tenantUsers.role, 'owner'))
  }
  const rows = await db
    .selectDistinct({ email: users.email, name: users.fullName })
    .from(users)
    .innerJoin(tenantUsers, eq(tenantUsers.userId, users.id))
    .where(and(...conditions))
  return rows.map((r) => ({ email: r.email, name: r.name ?? '' }))
}

async function main(): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set (add it to web/.env.local)')
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  const recipients = await getRecipients()

  console.log(
    `Announcement "${SUBJECT}" — ${recipients.length} recipient(s) ` +
      `[SEND_TO_ALL=${SEND_TO_ALL}, OWNERS_ONLY=${OWNERS_ONLY}]`,
  )

  const results: { name: string; email: string; status: string }[] = []
  let success = 0
  let failed = 0

  for (const recipient of recipients) {
    const name = recipient.name || recipient.email.split('@')[0]
    try {
      const { error } = await resend.emails.send({
        from: FROM,
        to: recipient.email,
        subject: SUBJECT,
        html: generateEmailHtml(name),
      })
      if (error) {
        throw new Error(error.message)
      }
      success += 1
      results.push({ name, email: recipient.email, status: 'sent' })
    } catch (err) {
      failed += 1
      results.push({ name, email: recipient.email, status: `error: ${(err as Error).message}` })
    }
    // Gentle pacing to stay within Resend rate limits.
    await new Promise((resolve) => setTimeout(resolve, 600))
  }

  console.table(results)
  console.log(`Done — success=${success} error=${failed} (mode=${SEND_TO_ALL ? 'ALL' : 'TEST'})`)
  process.exit(failed > 0 && success === 0 ? 1 : 0)
}

void main().catch((err) => {
  console.error('Announcement send failed:', err)
  process.exit(1)
})

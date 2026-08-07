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

// This mailer targets real customers — always use the production sender and URLs,
// never whatever a dev .env.local carries (EMAIL_FROM=noreply, NEXT_PUBLIC_APP_URL=localhost).
const FROM = 'FloraClin <contato@floraclin.com.br>'
const APP_URL = 'https://app.floraclin.com.br' // the app (CTA button -> /dashboard)
const SITE_URL = 'https://floraclin.com.br' // the marketing site (footer)

// ─── Brand (FloraClin) ──────────────────────────────────────────────
// Logo lockup (symbol + wordmark) as a hosted PNG — email clients (Gmail/Outlook)
// don't render SVG <img>, so we host a raster. Regenerate via
// floraclin-content/_brand/render-logo.mjs in the openclaw-agents repo.
const LOGO_URL = 'https://bullcode-agent-content.s3.sa-east-1.amazonaws.com/floraclin-content/brand/logo-email.png'
// Brand fonts degrade gracefully: Apple Mail honors the linked web fonts; Gmail/Outlook
// strip the <link> and fall back to the stacks. No @font-face payload is embedded, so
// there's no deliverability/spam impact — just the brand feel where it's supported.
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
const SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

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
  const style = highlighted
    ? 'background: linear-gradient(135deg, #F2E8E1 0%, #FAF7F3 100%); border-left: 4px solid #4A6B52;'
    : 'background-color: #F7F5F1; border-left: 4px solid #8FB49A;'
  return `
    <div style="${style} border-radius: 12px; padding: 18px 22px; margin: 12px 0;">
      <p style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: #1C2B1E;">${feature.emoji} ${escapeHtml(feature.title)}</p>
      <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #2A2A2A;">${escapeHtml(feature.description)}</p>
    </div>`
}

function generateEmailHtml(userName: string): string {
  const greetingName = userName ? escapeHtml(userName.split(' ')[0]) : ''
  const hi = greetingName ? `Olá, ${greetingName}!` : 'Olá!'
  const cards = FEATURES.map((f, i) => featureCard(f, i === 0)).join('')
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background-color: #FAF7F3; font-family: ${SANS};">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">Novidades na FloraClin para deixar a gestão da sua clínica mais leve.</div>
  <div style="background-color: #FAF7F3; padding: 40px 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(28,43,30,0.08);">
      <div style="padding: 32px 40px 26px; text-align: center; background-color: #FFFFFF; border-bottom: 3px solid #4A6B52;">
        <img src="${LOGO_URL}" alt="FloraClin" width="196" style="display: inline-block; width: 196px; height: auto; border: 0;">
      </div>
      <div style="padding: 36px 40px 8px;">
        <h1 style="margin: 0 0 6px; font-family: ${SERIF}; font-weight: 600; font-size: 30px; line-height: 1.15; color: #1C2B1E;">${hi}</h1>
        <p style="margin: 0 0 22px; font-size: 16px; line-height: 1.6; color: #2A2A2A;">
          Temos novidades na FloraClin para deixar o dia a dia da sua clínica mais leve. Veja o que chegou:
        </p>
        ${cards}
        <div style="text-align: center; margin: 34px 0 10px;">
          <a href="${APP_URL}/dashboard" style="display: inline-block; background-color: #4A6B52; color: #FFFFFF; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">
            Acessar a FloraClin
          </a>
        </div>
        <p style="font-size: 14px; line-height: 1.6; color: #7A7A7A; margin: 26px 0 4px;">
          Tem uma sugestão? É só responder este e-mail — a gente lê tudo. 🌿
        </p>
      </div>
      <div style="padding: 22px 40px 28px; background-color: #FAF7F3; border-top: 1px solid #EFE7DF; text-align: center;">
        <p style="margin: 0 0 4px; font-family: ${SERIF}; font-size: 16px; color: #1C2B1E;">FloraClin</p>
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #9A9A9A;">Gestão para clínicas de Harmonização Orofacial · <a href="${SITE_URL}" style="color: #4A6B52; text-decoration: none;">floraclin.com.br</a></p>
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

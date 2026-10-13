import { getAppUrl } from '@/lib/app-url'

export interface EmailContent {
  preheader: string
  heading: string
  paragraphs: string[]
  points?: string[]
  button?: { label: string; url: string } | null
  closing?: string
  notes?: string[]
  optOutUrl?: string | null
}

const FOREST = '#1C2B1E'
const SAGE = '#4A6B52'
const MINT = '#8FB49A'
const CREAM = '#FAF7F3'
const PETAL = '#F2E8E1'
const CHARCOAL = '#2A2A2A'
const MID = '#7A7A7A'
const SANS = "'Jost', 'Helvetica Neue', Helvetica, Arial, sans-serif"
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
// Sent emails keep this URL forever, so it must not depend on the deploy that sent them.
const LOGO_URL = 'https://app.floraclin.com.br/brand/email-logo.png'
// Keeps inbox previews from pulling the wordmark and heading in after the preheader.
const PREHEADER_FILLER = '&zwnj;&nbsp;'.repeat(80)

// Apple Mail and Outlook for Mac honor the media query; Outlook.com marks the elements it
// recolors with data-ogsc (text) and data-ogsb (background). Gmail ignores both and inverts.
const DARK_RULES: [string, string][] = [
  ['.fc-bg', `background: #121A14 !important;`],
  ['.fc-card', `background: ${FOREST} !important; border-top-color: ${SAGE} !important;`],
  ['.fc-box', `background: #243628 !important;`],
  ['.fc-divider', `border-top-color: #2E4232 !important;`],
  ['.fc-h', `color: ${PETAL} !important;`],
  ['.fc-t', `color: #E6E1DA !important;`],
  ['.fc-m, .fc-m a', `color: #A3ADA5 !important;`],
  ['.fc-check', `color: ${MINT} !important;`],
  ['.fc-btn', `background: ${MINT} !important;`],
  ['.fc-btn a', `color: ${FOREST} !important;`],
]
const DARK_CSS = [
  `@media (prefers-color-scheme: dark) { ${DARK_RULES.map(([sel, decl]) => `${sel} { ${decl} }`).join(' ')} }`,
  ...DARK_RULES.map(([sel, decl]) =>
    sel
      .split(', ')
      .map((one) => `[data-ogsc] ${one}, [data-ogsb] ${one}`)
      .join(', ') + ` { ${decl} }`,
  ),
].join('\n')

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function paragraph(text: string): string {
  return `<p class="fc-t" style="margin: 0 0 16px; color: ${CHARCOAL}; font-family: ${SANS}; font-size: 16px; line-height: 1.6;">${escapeHtml(text)}</p>`
}

function pointList(points: string[]): string {
  const rows = points
    .map(
      (point) => `<tr>
        <td class="fc-check" width="28" valign="top" style="padding: 6px 0; color: ${SAGE}; font-family: ${SANS}; font-size: 16px; line-height: 1.5; font-weight: 600;">&#10003;</td>
        <td class="fc-t" valign="top" style="padding: 6px 0; color: ${CHARCOAL}; font-family: ${SANS}; font-size: 15px; line-height: 1.5;">${escapeHtml(point)}</td>
      </tr>`,
    )
    .join('')
  return `<table class="fc-box" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 4px 0 20px; background: ${CREAM}; border-radius: 8px;">
    <tr><td style="padding: 14px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </td></tr>
  </table>`
}

function buttonBlock(button: { label: string; url: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px 0 24px;">
    <tr><td class="fc-btn" style="border-radius: 6px; background: ${SAGE};">
      <a href="${escapeHtml(button.url)}" style="display: inline-block; padding: 14px 28px; color: #FFFFFF; font-family: ${SANS}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 6px;">${escapeHtml(button.label)}</a>
    </td></tr>
  </table>`
}

function note(text: string): string {
  return `<p class="fc-m" style="margin: 0 0 6px; color: ${MID}; font-family: ${SANS}; font-size: 13px; line-height: 1.5;">${escapeHtml(text)}</p>`
}

export function renderEmailLayout(content: EmailContent): string {
  const appUrl = getAppUrl()
  const notes = content.notes?.length
    ? `<tr><td class="fc-divider" style="padding: 20px 40px 32px; border-top: 1px solid ${PETAL};">${content.notes.map(note).join('')}</td></tr>`
    : ''
  const optOut = content.optOutUrl
    ? `<p class="fc-m" style="margin: 8px 0 0; color: ${MID}; font-family: ${SANS}; font-size: 12px; line-height: 1.5;">Não quer mais receber dicas da FloraClin? <a href="${escapeHtml(content.optOutUrl)}" style="color: ${MID}; text-decoration: underline;">Clique aqui</a>.</p>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
${DARK_CSS}
</style>
<title>${escapeHtml(content.heading)}</title>
</head>
<body class="fc-bg" style="margin: 0; padding: 0; background: ${CREAM};">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">${escapeHtml(content.preheader)}${PREHEADER_FILLER}</div>
<table class="fc-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${CREAM};">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px;">
      <tr><td style="padding: 0 8px 20px;">
        <a href="${escapeHtml(appUrl)}" style="text-decoration: none;">
          <img src="${LOGO_URL}" width="36" height="36" alt="" style="vertical-align: middle; border: 0;">
          <span class="fc-h" style="vertical-align: middle; margin-left: 8px; color: ${FOREST}; font-family: ${SERIF}; font-size: 24px; font-weight: 600;">FloraClin</span>
        </a>
      </td></tr>
      <tr><td class="fc-card" style="background: #FFFFFF; border-radius: 12px; border-top: 4px solid ${MINT};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding: 36px 40px 12px;">
            <h1 class="fc-h" style="margin: 0 0 20px; color: ${FOREST}; font-family: ${SERIF}; font-size: 28px; line-height: 1.25; font-weight: 600;">${escapeHtml(content.heading)}</h1>
            ${content.paragraphs.map(paragraph).join('')}
            ${content.points?.length ? pointList(content.points) : ''}
            ${content.button ? buttonBlock(content.button) : ''}
            ${content.closing ? paragraph(content.closing) : ''}
          </td></tr>
          ${notes}
        </table>
      </td></tr>
      <tr><td style="padding: 24px 8px 0; text-align: center;">
        <p class="fc-m" style="margin: 0; color: ${MID}; font-family: ${SANS}; font-size: 12px; line-height: 1.5;">FloraClin · Gestão para clínicas de harmonização facial<br><a href="mailto:contato@floraclin.com.br" style="color: ${MID};">contato@floraclin.com.br</a></p>
        ${optOut}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

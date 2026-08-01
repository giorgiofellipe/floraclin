/**
 * CRM pipeline and WhatsApp inbox content for the Clínica Lumé demo seed.
 *
 * Fixes the gap the review flagged (MEDIUM-6): without this file the CRM
 * board, the WhatsApp inbox and the antes/depois screen all render empty
 * after a successful seed run, because nothing else creates `prospects`,
 * `whatsapp_conversations`/`whatsapp_messages` or `photo_assets` rows.
 *
 * Like the sibling Group B generators (`revenue.ts`, `schedule.ts`), this
 * module is a pure function of its inputs -- no `Math.random()`, no bare
 * `new Date()` -- and returns plain planned data (`patientIndex` in place of
 * a real patient id where the caller doesn't hand us one) for a DB runner to
 * resolve into actual rows.
 *
 * SAFETY, the actual point of this task: none of the three builders below
 * may produce a row any sender or cron could pick up and transmit.
 * - `buildConversations` never returns a `whatsapp_queued_messages` shape.
 *   Every message it returns already carries a terminal `deliveryStatus` of
 *   `'delivered'` or `'read'` -- never `'queued'`, `'sent'` alone, or
 *   `'failed'` -- so nothing reads as "still going out." Checked against
 *   `web/src/app/api/cron/whatsapp-automations/route.ts`: that cron only
 *   ever reads `tenants`, `whatsapp_automations`, `whatsapp_templates` and
 *   `appointments`. It does not read `prospects` or `whatsapp_conversations`
 *   at all, so this module's output is structurally invisible to it.
 * - `buildProspects` never enables a `whatsapp_automations` row and carries
 *   no `assignedUserId`/webhook side effects; it is pure CRM history.
 * - `buildPhotoPairs` writes no bytes anywhere; it references the repo's
 *   existing pose-guide illustrations by path and lets the (separate) DB
 *   runner script decide how to get bytes into storage.
 *
 * Stage values are the exact literals the CRM board renders, confirmed in
 * `web/src/components/crm/types.ts` (`ProspectStage`) and
 * `web/src/components/crm/constants.ts` (`PROSPECT_STAGES`, the six board
 * columns): 'novo', 'contatado', 'qualificado', 'agendado', 'convertido'
 * (the "won"/converted-to-patient terminal stage -- there is no 'ganho'),
 * and 'perdido' (the "lost" terminal stage). `prospect_activities.action`
 * literals ('created', 'stage_changed', 'lost', 'converted', ...) are
 * confirmed against the icon/label map in
 * `web/src/components/crm/prospect-detail-panel.tsx` and the call sites in
 * `web/src/app/api/crm/prospects/**`. `whatsapp_messages.deliveryStatus`
 * literals ('sent', 'delivered', 'read', 'failed') are confirmed against
 * `web/src/components/whatsapp/message-bubble.tsx` and the webhook's status
 * map in `web/src/app/api/webhooks/whatsapp/route.ts`. `photo_assets`'s
 * `timelineStage` literals ('pre', 'immediate_post', '7d', '30d', '90d',
 * 'other') are confirmed against `TimelineStage` in `web/src/types/index.ts`.
 */

import { toBrYmd } from '@/lib/dates'
import { CATALOGUE } from './config'
import { generatePhone } from './identity'
import { FEATURED_PATIENT_COUNT } from './clinical'
import { PROSPECT_STAGES } from '@/components/crm/constants'
import type { ProspectStage, ProspectIntent, ProspectSentiment } from '@/components/crm/types'
import type { TimelineStage } from '@/types'
import type { SeededPatient } from './types'

// ─── Pure calendar helpers (no Date parsing, no host-TZ dependence) ──────
// Duplicated from revenue.ts/schedule.ts rather than shared -- each demo-seed
// generator is a self-contained pure function of its explicit inputs.

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = month - 1 + delta
  const shiftedYear = year + Math.floor(zeroBased / 12)
  const shiftedMonth = ((zeroBased % 12) + 12) % 12 + 1
  return { year: shiftedYear, month: shiftedMonth }
}

/** Adds (or subtracts, for a negative `delta`) whole days to a YYYY-MM-DD string via calendar arithmetic. */
function addDaysYmd(day: string, delta: number): string {
  const [y, m, d0] = day.split('-').map(Number)
  let year = y
  let month = m
  let d = d0 + delta
  while (d > daysInMonth(year, month)) {
    d -= daysInMonth(year, month)
    ;({ year, month } = shiftMonth(year, month, 1))
  }
  while (d < 1) {
    ;({ year, month } = shiftMonth(year, month, -1))
    d += daysInMonth(year, month)
  }
  return ymd(year, month, d)
}

function minutesToHHMM(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

// ─── Prospects (CRM pipeline) ─────────────────────────────────────────

export interface DemoProspectActivity {
  /** `prospect_activities.action` -- see the module doc comment for the confirmed literal set. */
  action: string
  details: Record<string, unknown> | null
  /** BR calendar day, YYYY-MM-DD. */
  date: string
}

export interface DemoProspect {
  name: string
  phone: string
  source: string
  stage: ProspectStage
  intent: ProspectIntent
  sentiment: ProspectSentiment
  value: number
  lostReason?: string
  /** BR calendar day, YYYY-MM-DD -- the lead's `created` activity date. */
  createdAt: string
  /** BR calendar day, YYYY-MM-DD -- the lead's most recent activity date. */
  updatedAt: string
  /** Chronological (oldest first) -- `date` is non-decreasing across the array. */
  activities: DemoProspectActivity[]
}

const PROSPECT_NAME_POOL = [
  'Isabela Ramos', 'Thainá Duarte', 'Carla Mendes', 'Roberta Nunes', 'Vitória Lopes',
  'Sabrina Freitas', 'Douglas Farias', 'Marina Azevedo', 'Yasmin Correia', 'Otávio Ribeiro',
  'Luana Barros', 'Caio Vasconcelos', 'Helena Prado', 'Nicolas Andrade', 'Rebeca Cunha',
  'Estela Moraes', 'Kevin Brito', 'Aline Tavares', 'Rayssa Peixoto', 'Igor Salgado',
]

/** Offset so prospect phone indices never collide with `buildPatients`' 1..50 range. */
const PROSPECT_PHONE_INDEX_OFFSET = 300

const PROSPECT_SOURCES = ['instagram', 'indicacao', 'google', 'whatsapp']
const PROSPECT_INTENTS: ProspectIntent[] = ['inquiry', 'scheduling', 'followup', 'other']
const PROSPECT_SENTIMENTS: ProspectSentiment[] = ['positive', 'neutral']
const LOST_REASONS = [
  'Não retornou contato após três tentativas de follow-up',
  'Achou o valor acima do orçamento disponível no momento',
  'Optou por outra clínica mais próxima de casa',
]

/** The funnel stages a lead walks through in order, before any terminal state. */
const FUNNEL_ORDER: ProspectStage[] = ['novo', 'contatado', 'qualificado', 'agendado']

interface StagePlanEntry {
  stage: ProspectStage
  count: number
  /** How many days before `today` the oldest lead in this stage bucket was created. */
  createdDaysAgoBase: number
  /** Extra days-ago spread applied across `count` leads in this bucket, oldest to newest. */
  createdDaysAgoSpread: number
}

/**
 * Covers every stage `PROSPECT_STAGES` renders on the board, funnel-shaped
 * (more leads at the top of the funnel than at the bottom), with `novo`
 * leads created recently and `convertido`/`perdido` leads dating back
 * furthest, since those needed the most time to resolve.
 */
const STAGE_PLAN: StagePlanEntry[] = [
  { stage: 'novo', count: 5, createdDaysAgoBase: 1, createdDaysAgoSpread: 4 },
  { stage: 'contatado', count: 4, createdDaysAgoBase: 5, createdDaysAgoSpread: 6 },
  { stage: 'qualificado', count: 3, createdDaysAgoBase: 10, createdDaysAgoSpread: 6 },
  { stage: 'agendado', count: 3, createdDaysAgoBase: 14, createdDaysAgoSpread: 8 },
  { stage: 'convertido', count: 2, createdDaysAgoBase: 24, createdDaysAgoSpread: 10 },
  { stage: 'perdido', count: 2, createdDaysAgoBase: 14, createdDaysAgoSpread: 10 },
]

/** The funnel stages walked to reach `stage`, oldest ('novo') first. */
function funnelStepsFor(stage: ProspectStage): ProspectStage[] {
  if (stage === 'convertido') return [...FUNNEL_ORDER, 'convertido']
  if (stage === 'perdido') return ['novo', 'contatado', 'qualificado']
  const idx = FUNNEL_ORDER.indexOf(stage)
  return FUNNEL_ORDER.slice(0, idx + 1)
}

/** `count` strictly non-increasing days-ago values, spread from `startDaysAgo` down towards 1. */
function spreadDaysAgo(startDaysAgo: number, count: number): number[] {
  if (count <= 1) return [startDaysAgo]
  const step = startDaysAgo / count
  return Array.from({ length: count }, (_, i) => Math.max(1, Math.round(startDaysAgo - i * step)))
}

function buildActivities(
  stage: ProspectStage,
  createdDaysAgo: number,
  source: string,
  lostReason: string | undefined,
  todayYmd: string,
): DemoProspectActivity[] {
  const steps = funnelStepsFor(stage)
  const eventCount = stage === 'perdido' ? steps.length + 1 : steps.length
  const daysAgo = spreadDaysAgo(createdDaysAgo, eventCount)

  const activities: DemoProspectActivity[] = steps.map((step, idx) => {
    const date = addDaysYmd(todayYmd, -daysAgo[idx])
    if (idx === 0) {
      return { action: 'created', details: { source }, date }
    }
    if (step === 'convertido') {
      // The real app logs a dedicated 'converted' action (not 'stage_changed')
      // when a prospect becomes a patient; no `patientId` is included here
      // since this demo prospect isn't linked to a real patient row.
      return { action: 'converted', details: null, date }
    }
    return { action: 'stage_changed', details: { from: steps[idx - 1], to: step }, date }
  })

  if (stage === 'perdido') {
    const date = addDaysYmd(todayYmd, -daysAgo[daysAgo.length - 1])
    activities.push({ action: 'lost', details: { reason: lostReason }, date })
  }

  return activities
}

/**
 * Builds a lead pipeline spread across every stage the CRM board renders
 * (`novo`, `contatado`, `qualificado`, `agendado`, `convertido`, `perdido`),
 * each with a `prospect_activities` history whose dates are chronologically
 * ordered and never later than `today`.
 */
export function buildProspects(today: Date): DemoProspect[] {
  const todayYmd = toBrYmd(today)
  const prospects: DemoProspect[] = []
  let globalIndex = 0

  for (const plan of STAGE_PLAN) {
    for (let i = 0; i < plan.count; i++) {
      const name = PROSPECT_NAME_POOL[globalIndex % PROSPECT_NAME_POOL.length]
      const phone = generatePhone(PROSPECT_PHONE_INDEX_OFFSET + globalIndex)
      const source = PROSPECT_SOURCES[globalIndex % PROSPECT_SOURCES.length]
      const isLost = plan.stage === 'perdido'
      const intent: ProspectIntent = isLost ? 'complaint' : PROSPECT_INTENTS[globalIndex % PROSPECT_INTENTS.length]
      const sentiment: ProspectSentiment = isLost ? 'negative' : PROSPECT_SENTIMENTS[globalIndex % PROSPECT_SENTIMENTS.length]
      const lostReason = isLost ? LOST_REASONS[i % LOST_REASONS.length] : undefined
      const catalogueItem = CATALOGUE[globalIndex % CATALOGUE.length]

      const spread = plan.count > 1 ? (i * plan.createdDaysAgoSpread) / (plan.count - 1) : 0
      const createdDaysAgo = Math.round(plan.createdDaysAgoBase + spread)

      const activities = buildActivities(plan.stage, createdDaysAgo, source, lostReason, todayYmd)

      prospects.push({
        name,
        phone,
        source,
        stage: plan.stage,
        intent,
        sentiment,
        value: catalogueItem.price,
        lostReason,
        createdAt: activities[0].date,
        updatedAt: activities[activities.length - 1].date,
        activities,
      })

      globalIndex += 1
    }
  }

  return prospects
}

// ─── WhatsApp inbox ────────────────────────────────────────────────────

/** Terminal delivery states only -- never 'queued', bare 'sent' or 'failed', so nothing here reads as still in flight. */
type DemoDeliveryStatus = 'delivered' | 'read'

export interface DemoWhatsappMessage {
  direction: 'inbound' | 'outbound'
  body: string
  deliveryStatus: DemoDeliveryStatus
  /** BR calendar day, YYYY-MM-DD. */
  date: string
  /** HH:MM, 24h. */
  time: string
}

export interface DemoWhatsappConversation {
  patientId: string
  phoneNumber: string
  profileName: string
  status: 'active'
  unreadCount: number
  messages: DemoWhatsappMessage[]
  /** Convenience mirrors of the last message in `messages` -- for `whatsapp_conversations.lastMessageAt`. */
  lastMessageDate: string
  lastMessageTime: string
  /** Convenience mirrors of the most recent inbound message, if any -- for `whatsapp_conversations.lastInboundAt`. */
  lastInboundDate?: string
  lastInboundTime?: string
}

interface ThreadMessageTemplate {
  direction: 'inbound' | 'outbound'
  body: string
}

/**
 * Five conversation shapes covering the ways a real HOF clinic inbox looks:
 * a price inquiry that turns into a booking, a post-procedure check-in, a
 * reschedule, an unanswered inbound question (the only thread that ends on
 * an inbound message, so it is the only one with a nonzero unread count),
 * and a share of a 30-day follow-up photo. `{first}` is substituted with the
 * patient's first name.
 */
const THREADS: ThreadMessageTemplate[][] = [
  [
    { direction: 'inbound', body: 'Oi, vi o story de vocês sobre harmonização facial. Vocês atendem particular?' },
    { direction: 'outbound', body: 'Oi, {first}! Sim, atendemos particular e parcelamos em até 6x. Posso te passar os valores?' },
    { direction: 'inbound', body: 'Pode sim, por favor' },
    { direction: 'outbound', body: 'O pacote de harmonização completa fica R$ 4.500. Quer que eu já veja um horário pra avaliação?' },
    { direction: 'inbound', body: 'Quero sim, obrigada!' },
    { direction: 'outbound', body: 'Perfeito, encontrei quinta às 14h. Qualquer dúvida me chama por aqui!' },
  ],
  [
    { direction: 'outbound', body: 'Oi {first}, tudo bem? Passando pra saber como você está depois da toxina de ontem' },
    { direction: 'inbound', body: 'Oi! Tudo ótimo, só uma vermelhidão leve nos pontinhos mas nada demais' },
    { direction: 'inbound', body: 'Já tá quase sumindo' },
    { direction: 'outbound', body: 'Que ótimo! Isso é totalmente esperado nas primeiras horas. Qualquer coisa me chama por aqui' },
  ],
  [
    { direction: 'inbound', body: 'Boa tarde! Preciso remarcar meu horário de sexta, surgiu um imprevisto' },
    { direction: 'outbound', body: 'Sem problemas, {first}! Tenho vaga na terça às 10h ou quarta às 16h, qual prefere?' },
    { direction: 'inbound', body: 'Terça às 10h fica ótimo' },
    { direction: 'outbound', body: 'Combinado, já ajustei aqui. Te espero terça!' },
  ],
  [
    { direction: 'inbound', body: 'Oi, vocês têm disponibilidade essa semana ainda pra preenchimento labial?' },
  ],
  [
    { direction: 'outbound', body: 'Oi {first}! Ficou pronta sua foto de 30 dias, quer que eu te mande pra comparar com o antes?' },
    { direction: 'inbound', body: 'Ahh quero muito! Manda sim' },
    { direction: 'outbound', body: 'Te enviei por aqui, olha que resultado lindo' },
    { direction: 'inbound', body: 'Fiquei apaixonada, muito obrigada por tudo!' },
    { direction: 'outbound', body: 'Imagina, foi um prazer cuidar de você!' },
  ],
]

/** Days-ago the conversation's messages happened, matched index-for-index to `THREADS`. */
const THREAD_DAY_OFFSETS = [2, 1, 4, 0, 6]

/** How many of `patients` get a seeded conversation. */
const CONVERSATION_PATIENT_COUNT = 8

function renderBody(template: string, name: string): string {
  return template.replaceAll('{first}', name)
}

/** Unread = trailing run of inbound messages after the last outbound one (0 if the thread ends outbound). */
function computeUnreadCount(thread: ThreadMessageTemplate[]): number {
  let count = 0
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].direction !== 'inbound') break
    count += 1
  }
  return count
}

/**
 * Builds `whatsapp_conversations` + `whatsapp_messages` content for a subset
 * of `patients`, written purely as data so the inbox looks alive without any
 * WhatsApp send ever occurring: every message already carries a terminal
 * `deliveryStatus` ('delivered' or 'read'), and this function never returns
 * a `whatsapp_queued_messages` shape.
 */
export function buildConversations(patients: SeededPatient[], today: Date): DemoWhatsappConversation[] {
  const todayYmd = toBrYmd(today)
  const chosen = patients.slice(0, Math.min(CONVERSATION_PATIENT_COUNT, patients.length))

  return chosen.map((patient, index) => {
    const threadIndex = index % THREADS.length
    const thread = THREADS[threadIndex]
    const date = addDaysYmd(todayYmd, -THREAD_DAY_OFFSETS[threadIndex])
    const name = firstName(patient.fullName)

    let outboundSeen = 0
    const messages: DemoWhatsappMessage[] = thread.map((template, msgIndex) => {
      const deliveryStatus: DemoDeliveryStatus =
        template.direction === 'outbound'
          ? (outboundSeen++ % 2 === 0 ? 'delivered' : 'read')
          : 'delivered'

      return {
        direction: template.direction,
        body: renderBody(template.body, name),
        deliveryStatus,
        date,
        time: minutesToHHMM(9 * 60 + msgIndex * 17 + threadIndex * 5),
      }
    })

    const last = messages[messages.length - 1]
    const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound')

    return {
      patientId: patient.id,
      phoneNumber: patient.phone,
      profileName: patient.fullName,
      status: 'active',
      unreadCount: computeUnreadCount(thread),
      messages,
      lastMessageDate: last.date,
      lastMessageTime: last.time,
      lastInboundDate: lastInbound?.date,
      lastInboundTime: lastInbound?.time,
    }
  })
}

// ─── Antes/depois photo pairs ──────────────────────────────────────────

export interface DemoPhotoAnnotation {
  annotationData: {
    note: string
    markers: Array<{ x: number; y: number; label: string }>
  }
}

export interface DemoPhotoAsset {
  /** Index into the patients array the (separate) DB runner resolves to a real patient id -- same convention as `PlannedProcedure.patientIndex`. */
  patientIndex: number
  timelineStage: TimelineStage
  /**
   * Repo-relative path (from the `web` package root) to the illustration
   * file the DB runner should read bytes from and upload. There is no
   * "aged"/after variant under `web/public/face-templates` today (only
   * `site/public/face-templates/female-front-antes.webp` exists, in a
   * different package) -- see the module doc comment and the task report
   * for the follow-up. Both stages of a pair therefore point at the same
   * pose-guide illustration for now, distinguished only by the timeline
   * label and notes, so the comparison screen at least has two photos to
   * place side by side instead of nothing.
   */
  sourceTemplatePath: string
  originalFilename: string
  mimeType: string
  notes: string
  annotation: DemoPhotoAnnotation
}

export interface DemoPhotoPair {
  patientIndex: number
  before: DemoPhotoAsset
  after: DemoPhotoAsset
}

const FACE_TEMPLATE_DIR = 'public/face-templates'

/** Alternates the pose-guide illustration so featured patients aren't all identical. */
function templateFor(patientIndex: number): 'female-front' | 'male-front' {
  return patientIndex % 2 === 0 ? 'female-front' : 'male-front'
}

/**
 * Builds `photo_assets` + `photo_annotations` content for
 * `FEATURED_PATIENT_COUNT` patients (the same "featured" set `clinical.ts`
 * gives a full anamnese/procedure-notes/face-diagram record to), one
 * before ('pre') and one after ('30d') asset per patient, each carrying an
 * annotation, so the antes/depois comparison screen has something to show.
 */
export function buildPhotoPairs(): DemoPhotoPair[] {
  return Array.from({ length: FEATURED_PATIENT_COUNT }, (_, patientIndex) => {
    const template = templateFor(patientIndex)
    const sourceTemplatePath = `${FACE_TEMPLATE_DIR}/${template}.webp`

    const before: DemoPhotoAsset = {
      patientIndex,
      timelineStage: 'pre',
      sourceTemplatePath,
      originalFilename: `${template}-pre.webp`,
      mimeType: 'image/webp',
      notes: 'Foto inicial, registrada antes do início do protocolo.',
      annotation: {
        annotationData: {
          note: 'Estado inicial antes do procedimento.',
          markers: [{ x: 50, y: 50, label: 'Área de avaliação' }],
        },
      },
    }

    const after: DemoPhotoAsset = {
      patientIndex,
      timelineStage: '30d',
      sourceTemplatePath,
      originalFilename: `${template}-30d.webp`,
      mimeType: 'image/webp',
      notes: 'Acompanhamento de 30 dias após o procedimento.',
      annotation: {
        annotationData: {
          note: 'Resultado em 30 dias, contorno mais definido.',
          markers: [{ x: 50, y: 45, label: 'Contorno' }],
        },
      },
    }

    return { patientIndex, before, after }
  })
}

/** Re-exported so callers/tests can assert full board coverage without duplicating the literal list. */
export { PROSPECT_STAGES }

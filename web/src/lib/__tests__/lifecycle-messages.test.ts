import { describe, expect, it } from 'vitest'
import type { ActivationState } from '@/lib/activation'
import { brCalendarDaysBetween } from '@/lib/dates'

const DAY_MS = 24 * 60 * 60 * 1000
import {
  LIFECYCLE_MESSAGES,
  MARKETING_SPACING_MS,
  helpReplyTo,
  trialEndPhrase,
  LIFECYCLE_WELCOME,
  ownerFirstName,
  renderLifecycleEmail,
  selectDueMessages,
} from '@/lib/lifecycle-messages'

function baseState(overrides: Partial<ActivationState> = {}): ActivationState {
  return {
    onboardingDone: false,
    hasPatient: false,
    hasAppointment: false,
    hasProcedureRecord: false,
    hasWhatsappSend: false,
    trialDay: 0,
    daysLeft: 14,
    // Follows daysLeft unless a case pins it: daysLeft days plus one hour.
    msLeft: ((overrides.daysLeft ?? 14) * 24 + 1) * 60 * 60 * 1000,
    subscriptionStatus: 'trialing',
    subscriptionSource: 'trial',
    optedOut: false,
    lastMarketingSentAt: null,
    ...overrides,
  }
}

const WELCOME_DONE = ['trial_welcome']

describe('selectDueMessages', () => {
  it.each([
    {
      name: 'day 0 sends only the welcome. Regression: nudges fire on signup day',
      state: baseState(),
      completed: [],
      expected: ['trial_welcome'],
    },
    {
      name: 'day 3 with nothing done nudges setup then first patient. Regression: priority order lost',
      state: baseState({ trialDay: 3, daysLeft: 11 }),
      completed: WELCOME_DONE,
      expected: ['trial_setup_incomplete', 'trial_first_patient'],
    },
    {
      name: 'day 3 with onboarding and a patient done sends nothing. Regression: nudging finished steps',
      state: baseState({ trialDay: 3, daysLeft: 11, onboardingDone: true, hasPatient: true }),
      completed: WELCOME_DONE,
      expected: [],
    },
    {
      name: 'day 12 sends trial_ending and no onboarding nudge: they stop 5 days before the end',
      state: baseState({ trialDay: 12, daysLeft: 2 }),
      completed: WELCOME_DONE,
      expected: ['trial_ending'],
    },
    {
      name: 'day 9 (5 days left) is the last day for onboarding nudges',
      state: baseState({ trialDay: 9, daysLeft: 5 }),
      completed: WELCOME_DONE,
      expected: ['trial_setup_incomplete', 'trial_first_patient', 'trial_first_record', 'trial_first_appointment'],
    },
    {
      name: 'opted out on day 12 gets no trial_ending. Regression: trial_ending goes back to UTILITY, but Meta approved it as MARKETING',
      state: baseState({ trialDay: 12, daysLeft: 2, optedOut: true }),
      completed: WELCOME_DONE,
      expected: [],
    },
    {
      name: 'day 11 (3 days left) sends trial_ending_soon',
      state: baseState({ trialDay: 11, daysLeft: 3, onboardingDone: true, hasPatient: true }),
      completed: WELCOME_DONE,
      expected: ['trial_ending_soon'],
    },
    {
      name: 'last 24 hours sends trial_last_day first, even when the end is tomorrow morning on the BR calendar',
      state: baseState({ trialDay: 13, daysLeft: 1, msLeft: 22 * 60 * 60 * 1000, onboardingDone: true, hasPatient: true, hasProcedureRecord: true, hasAppointment: true, hasWhatsappSend: true }),
      completed: WELCOME_DONE,
      expected: ['trial_last_day'],
    },
    {
      name: 'more than 24 hours left is not the last day yet',
      state: baseState({ trialDay: 13, daysLeft: 1, msLeft: 25 * 60 * 60 * 1000, onboardingDone: true, hasPatient: true, hasProcedureRecord: true, hasAppointment: true, hasWhatsappSend: true }),
      completed: WELCOME_DONE,
      expected: [],
    },
    {
      name: 'a trial past its end that still reads trialing (cron not run yet) gets no trial message',
      state: baseState({ trialDay: 14, daysLeft: 0, msLeft: -60 * 60 * 1000 }),
      completed: WELCOME_DONE,
      expected: [],
    },
    {
      name: 'opted out gets neither trial_ending_soon nor trial_last_day',
      state: baseState({ trialDay: 13, daysLeft: 1, msLeft: 60 * 60 * 1000, optedOut: true }),
      completed: WELCOME_DONE,
      expected: [],
    },
    {
      name: 'opted out still gets the UTILITY welcome. Regression: opt-out suppresses UTILITY',
      state: baseState({ optedOut: true }),
      completed: [],
      expected: ['trial_welcome'],
    },
    {
      name: 'extended trial at day 13 with 9 days left has no trial_ending. Regression: ending keyed to trial day',
      state: baseState({ trialDay: 13, daysLeft: 9, onboardingDone: true, hasPatient: true, hasProcedureRecord: true, hasAppointment: true, hasWhatsappSend: true }),
      completed: WELCOME_DONE,
      expected: [],
    },
    {
      name: 'a trial that was used (patient + appointment) gets the win-back 2 days after it ended',
      state: baseState({ trialDay: 16, daysLeft: -2, subscriptionStatus: 'expired', hasPatient: true, hasAppointment: true }),
      completed: [],
      expected: ['trial_winback'],
    },
    {
      name: 'a trial never really used gets the help offer instead',
      state: baseState({ trialDay: 16, daysLeft: -2, subscriptionStatus: 'expired', hasPatient: true }),
      completed: [],
      expected: ['trial_help'],
    },
    {
      name: 'from D+7 only the final message is due, never the D+2 one',
      state: baseState({ trialDay: 21, daysLeft: -7, subscriptionStatus: 'expired' }),
      completed: [],
      expected: ['trial_final'],
    },
    {
      name: 'one final message at D+7..10, then nothing',
      state: baseState({ trialDay: 25, daysLeft: -11, subscriptionStatus: 'expired' }),
      completed: [],
      expected: [],
    },
    {
      name: 'the final message goes once',
      state: baseState({ trialDay: 22, daysLeft: -8, subscriptionStatus: 'expired' }),
      completed: ['trial_final'],
      expected: [],
    },
    {
      name: 'opted out gets no post-expiry message',
      state: baseState({ trialDay: 16, daysLeft: -2, subscriptionStatus: 'expired', optedOut: true }),
      completed: [],
      expected: [],
    },
    {
      name: 'expired gift subscription gets no post-expiry message. Regression: source ignored',
      state: baseState({ trialDay: 16, daysLeft: -2, subscriptionStatus: 'expired', subscriptionSource: 'gift' }),
      completed: [],
      expected: [],
    },
    {
      name: 'active paid subscription gets nothing. Regression: status ignored',
      state: baseState({ trialDay: 16, daysLeft: -2, subscriptionStatus: 'active' }),
      completed: [],
      expected: [],
    },
  ])('$name', ({ state, completed, expected }) => {
    const keys = selectDueMessages(state, new Set(completed)).map((message) => message.key)
    expect(keys).toEqual(expected)
  })
})

describe('LIFECYCLE_MESSAGES copy', () => {
  it('has exactly one {{1}} that is neither first nor last. Regression: Meta rejects edge variables', () => {
    for (const message of LIFECYCLE_MESSAGES) {
      expect(message.body.split('{{1}}')).toHaveLength(2)
      expect(message.body.startsWith('{{1}}')).toBe(false)
      expect(message.body.endsWith('{{1}}')).toBe(false)
    }
  })

  it('puts {{1}} only in the email intro, once. Regression: a literal {{1}} ships in the email', () => {
    for (const { email } of LIFECYCLE_MESSAGES) {
      expect(email.intro.split('{{1}}')).toHaveLength(2)
      const { intro: _intro, ...rest } = email
      expect(JSON.stringify(rest)).not.toContain('{{1}}')
    }
  })
})

describe('greeting', () => {
  it.each([
    { name: 'full name uses the first word', fullName: '  Maria   da Silva ', greeting: 'Olá, Maria!' },
    { name: 'empty name still reads naturally. Regression: "Olá, !" goes out to owners', fullName: '', greeting: 'Olá, tudo bem!' },
    { name: 'missing name falls back too', fullName: null, greeting: 'Olá, tudo bem!' },
  ])('$name', ({ fullName, greeting }) => {
    expect(renderLifecycleEmail(LIFECYCLE_WELCOME, ownerFirstName(fullName)).content.paragraphs[0].startsWith(greeting)).toBe(true)
  })
})

describe('marketing spacing', () => {
  const now = new Date('2026-10-21T13:00:00.000Z')
  const HOUR = 60 * 60 * 1000

  it('holds a marketing message when the last one went out less than ~2 days ago', () => {
    const state = baseState({ trialDay: 11, daysLeft: 3, lastMarketingSentAt: new Date(now.getTime() - 24 * HOUR) })
    expect(selectDueMessages(state, new Set(WELCOME_DONE), now).map((m) => m.key)).toEqual([])
  })

  it('lets it go once ~2 days have passed', () => {
    const state = baseState({ trialDay: 11, daysLeft: 3, lastMarketingSentAt: new Date(now.getTime() - MARKETING_SPACING_MS) })
    expect(selectDueMessages(state, new Set(WELCOME_DONE), now).map((m) => m.key)).toEqual(['trial_ending_soon'])
  })

  it('never holds the UTILITY welcome', () => {
    const state = baseState({ lastMarketingSentAt: new Date(now.getTime() - HOUR) })
    expect(selectDueMessages(state, new Set(), now).map((m) => m.key)).toEqual(['trial_welcome'])
  })

  it.each(['08:00', '12:00', '18:30', '23:30'])(
    'daily runs send D-3 and then the last-day email for a trial ending at %s BRT',
    (time) => {
      // Regression: the 44h spacing must never swallow the last-day email.
      const end = new Date(`2026-10-24T${time}:00-03:00`)
      const others = LIFECYCLE_MESSAGES.map((m) => m.key).filter(
        (k) => !['trial_ending_soon', 'trial_ending', 'trial_last_day'].includes(k),
      )
      const sent: string[] = []
      let lastMarketingSentAt: Date | null = null
      // The 10:00 BRT cron (13:00 UTC), from D-5 until the trial ends.
      for (let run = new Date('2026-10-19T13:00:00.000Z'); run < end; run = new Date(run.getTime() + DAY_MS)) {
        const state = baseState({
          hasPatient: true,
          hasAppointment: true,
          onboardingDone: true,
          daysLeft: brCalendarDaysBetween(run, end),
          msLeft: end.getTime() - run.getTime(),
          lastMarketingSentAt,
        })
        const [next] = selectDueMessages(state, new Set([...others, ...sent]), run)
        if (!next) continue
        sent.push(next.key)
        lastMarketingSentAt = run
      }
      expect(sent).toEqual(['trial_ending_soon', 'trial_last_day'])
    },
  )
})

describe('post-expiry rendering', () => {
  const now = new Date('2026-10-21T13:00:00.000Z')
  const ctx = (offerEndsAt: string | null) => ({
    now,
    endsAt: new Date('2026-10-19T15:00:00.000Z'),
    recap: { patients: 12, appointments: 30, procedureRecords: 4, photos: 0, diagrams: 2 },
    offer: offerEndsAt ? { label: '30% de desconto nos 3 primeiros meses', endsAt: offerEndsAt } : null,
  })
  const winback = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_winback')!

  it('the win-back email carries the offer and the clinic numbers', () => {
    const { subject, content } = renderLifecycleEmail(winback, 'Ana', ctx('2026-11-02T15:00:00.000Z'))
    expect(subject).toContain('30% de desconto')
    expect(content.paragraphs[0]).toContain('até 02/11')
    expect(content.points).toEqual(['12 pacientes cadastrados', '30 agendamentos', '4 atendimentos registrados', '2 diagramas faciais'])
    expect(content.closing).toMatch(/responda a este e-mail/i)
  })

  it('leaves the offer out with less than 72h left on it', () => {
    const { subject, content } = renderLifecycleEmail(winback, 'Ana', ctx('2026-10-23T12:00:00.000Z'))
    expect(subject).not.toContain('desconto')
    expect(content.paragraphs[0]).not.toContain('desconto')
  })

  it('the help email offers no discount and routes replies to the help address', () => {
    const help = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_help')!
    const { content } = renderLifecycleEmail(help, 'Ana')
    expect(JSON.stringify(content)).not.toMatch(/desconto|7 dias|estend/i)
    expect(help.button?.path).toMatch(/^https:\/\/wa\.me\//)
    expect(help.replyTo?.()).toBe(helpReplyTo())
    expect(helpReplyTo({ LIFECYCLE_HELP_REPLY_TO: 'giorgio@example.com' })).toBe('giorgio@example.com')
  })

  it('every post-expiry message is email only until its template is approved', () => {
    for (const key of ['trial_winback', 'trial_help', 'trial_final']) {
      expect(LIFECYCLE_MESSAGES.find((m) => m.key === key)?.whatsapp).toBe(false)
    }
  })
})

describe('last-day wording', () => {
  it('says "hoje às" / "amanhã às" like the banner', () => {
    const now = new Date('2026-10-21T13:00:00.000Z') // 10:00 BRT
    expect(trialEndPhrase(new Date('2026-10-21T21:30:00.000Z'), now)).toBe('hoje às 18:30')
    expect(trialEndPhrase(new Date('2026-10-22T11:00:00.000Z'), now)).toBe('amanhã às 08:00')
    const lastDay = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_last_day')!
    const { subject } = renderLifecycleEmail(lastDay, 'Ana', {
      now,
      endsAt: new Date('2026-10-22T11:00:00.000Z'),
      recap: null,
      offer: null,
    })
    expect(subject).toBe('Seu teste na FloraClin termina amanhã às 08:00')
  })
})

import { describe, expect, it } from 'vitest'
import type { ActivationState } from '@/lib/activation'
import {
  LIFECYCLE_MESSAGES,
  LIFECYCLE_WELCOME,
  ownerFirstName,
  renderLifecycleBody,
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
    subscriptionStatus: 'trialing',
    subscriptionSource: 'trial',
    optedOut: false,
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
      name: 'day 12 puts trial_ending before the nudges. Regression: nudges starve the deadline message',
      state: baseState({ trialDay: 12, daysLeft: 2 }),
      completed: WELCOME_DONE,
      expected: [
        'trial_ending',
        'trial_setup_incomplete',
        'trial_first_patient',
        'trial_first_record',
        'trial_first_appointment',
      ],
    },
    {
      name: 'opted out keeps only the UTILITY deadline message. Regression: opt-out suppresses UTILITY, or nothing',
      state: baseState({ trialDay: 5, daysLeft: 2, optedOut: true }),
      completed: WELCOME_DONE,
      expected: ['trial_ending'],
    },
    {
      name: 'extended trial at day 13 with 9 days left has no trial_ending. Regression: ending keyed to trial day',
      state: baseState({ trialDay: 13, daysLeft: 9, onboardingDone: true, hasPatient: true, hasProcedureRecord: true, hasAppointment: true, hasWhatsappSend: true }),
      completed: WELCOME_DONE,
      expected: [],
    },
    {
      name: 'expired trial 2 days ago asks for feedback. Regression: feedback never fires',
      state: baseState({ trialDay: 16, daysLeft: -2, subscriptionStatus: 'expired' }),
      completed: [],
      expected: ['trial_feedback'],
    },
    {
      name: 'expired gift subscription gets no feedback ask. Regression: source ignored',
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
})

describe('greeting', () => {
  it.each([
    { name: 'full name uses the first word', fullName: '  Maria   da Silva ', greeting: 'Olá, Maria!' },
    { name: 'empty name still reads naturally. Regression: "Olá, !" goes out to owners', fullName: '', greeting: 'Olá, tudo bem!' },
    { name: 'missing name falls back too', fullName: null, greeting: 'Olá, tudo bem!' },
  ])('$name', ({ fullName, greeting }) => {
    expect(renderLifecycleBody(LIFECYCLE_WELCOME, ownerFirstName(fullName)).startsWith(greeting)).toBe(true)
  })
})

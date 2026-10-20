import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentsDuePreInstructions: vi.fn(),
  claimPreInstructions: vi.fn(),
  releasePreInstructions: vi.fn(),
}))
vi.mock('@/db/queries/procedures', () => ({
  getSessionCareRecipient: vi.fn(),
  getProcedureTypeCare: vi.fn(),
}))
vi.mock('@/lib/whatsapp-automation-event', () => ({
  runEventAutomation: vi.fn(),
}))

import { claimPreInstructions, getAppointmentsDuePreInstructions } from '@/db/queries/appointments'
import { getProcedureTypeCare, getSessionCareRecipient } from '@/db/queries/procedures'
import { runEventAutomation } from '@/lib/whatsapp-automation-event'
import { TEMPLATE_TEXT_PARAM_MAX } from '@/lib/whatsapp-blueprints'
import { loadDuePreInstructions, sendPostProcedureCare } from '../whatsapp-procedure-care'

const NOW = new Date('2026-10-18T12:00:00-03:00')

const SESSION = {
  patientId: 'p1',
  patientName: 'Maria Silva',
  patientPhone: '11999991234',
  performedAt: NOW,
  procedureTypeId: 'pt-botox',
  additionalTypeIds: null,
}

/** Runs the message loader the post-care send hands to the event runner. */
async function postCareMessages(sessionId = 's1') {
  await sendPostProcedureCare('t1', sessionId)
  const [, , loadMessages] = vi.mocked(runEventAutomation).mock.calls[0]
  return loadMessages({ tenantName: 'Clínica Lume' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(getAppointmentsDuePreInstructions).mockResolvedValue([])
  vi.mocked(getSessionCareRecipient).mockResolvedValue(SESSION)
  vi.mocked(getProcedureTypeCare).mockResolvedValue([
    { id: 'pt-botox', name: 'Botox', postProcedureCare: 'Não deitar por 4 horas' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadDuePreInstructions', () => {
  // Regression: looking up only today + N skips an appointment booked inside the window.
  it('looks up appointments from tomorrow through daysBeforeAppointment days ahead', async () => {
    await loadDuePreInstructions({ tenantId: 't1', tenantName: 'Clínica Lume', config: { daysBeforeAppointment: 3 } })

    expect(getAppointmentsDuePreInstructions).toHaveBeenCalledWith('t1', '2026-10-19', '2026-10-21')
  })

  // Regression: a care text typed on several lines reaching Meta as is, which rejects the whole send.
  it('flattens multi-line instructions into one line and claims that appointment', async () => {
    vi.mocked(getAppointmentsDuePreInstructions).mockResolvedValue([{
      id: 'a1',
      date: '2026-10-20',
      patientId: 'p1',
      patientName: 'Maria Silva',
      patientPhone: '11999991234',
      procedureTypeName: 'Preenchimento labial',
      instructions: 'Evitar anti-inflamatórios 7 dias antes\r\n\n  Não consumir álcool     na véspera.\t',
    }])
    vi.mocked(claimPreInstructions).mockResolvedValue(true)

    const [message] = await loadDuePreInstructions({ tenantId: 't1', tenantName: 'Clínica Lume', config: { daysBeforeAppointment: 3 } })

    expect(message.values).toEqual({
      patient_name: 'Maria',
      procedure_name: 'Preenchimento labial',
      instructions: 'Evitar anti-inflamatórios 7 dias antes. Não consumir álcool na véspera.',
    })
    await message.claim()
    expect(claimPreInstructions).toHaveBeenCalledWith('t1', 'a1')
  })
})

describe('sendPostProcedureCare', () => {
  it('sends the care text of the session procedure', async () => {
    expect(await postCareMessages()).toEqual([{
      ref: 'session s1',
      patientId: 'p1',
      patientName: 'Maria Silva',
      phone: '11999991234',
      values: { patient_name: 'Maria', procedure_name: 'Botox', instructions: 'Não deitar por 4 horas.' },
    }])
  })

  // Regression: a visit with two procedures sending one text that does not say which care is which,
  // listed in whatever order the database returned the types.
  it('labels each care text in session order when it covered several procedures, leaving out those without one', async () => {
    vi.mocked(getSessionCareRecipient).mockResolvedValue({ ...SESSION, additionalTypeIds: ['pt-filler', 'pt-peel'] })
    vi.mocked(getProcedureTypeCare).mockResolvedValue([
      { id: 'pt-peel', name: 'Peeling', postProcedureCare: '  ' },
      { id: 'pt-filler', name: 'Preenchimento', postProcedureCare: 'Evitar sol por 48h\nUsar protetor solar' },
      { id: 'pt-botox', name: 'Botox', postProcedureCare: 'Não deitar por 4 horas.' },
    ])

    const [message] = await postCareMessages()

    expect(message.values).toEqual({
      patient_name: 'Maria',
      procedure_name: 'Botox e Preenchimento',
      instructions: 'Botox: Não deitar por 4 horas. Preenchimento: Evitar sol por 48h. Usar protetor solar.',
    })
  })

  // Regression: two long care texts going past Meta's body cap, which rejects the whole send.
  it('cuts the combined care text to the template param limit', async () => {
    vi.mocked(getSessionCareRecipient).mockResolvedValue({ ...SESSION, additionalTypeIds: ['pt-filler'] })
    vi.mocked(getProcedureTypeCare).mockResolvedValue([
      { id: 'pt-botox', name: 'Botox', postProcedureCare: 'a'.repeat(600) },
      { id: 'pt-filler', name: 'Preenchimento', postProcedureCare: 'b'.repeat(600) },
    ])

    const [message] = await postCareMessages()

    expect(message.values.instructions).toHaveLength(TEMPLATE_TEXT_PARAM_MAX)
    expect(message.values.instructions).toMatch(/^Botox: a+\. Preenchimento: b+\.\.\.$/)
  })

  it.each([
    ['the procedure has no care text', () => vi.mocked(getProcedureTypeCare).mockResolvedValue([{ id: 'pt-botox', name: 'Botox', postProcedureCare: null }])],
    // Regression: staff recording last week's sessions texting each patient care advice now.
    ['the session is dated more than 2 BR days ago', () => vi.mocked(getSessionCareRecipient).mockResolvedValue({ ...SESSION, performedAt: new Date('2026-10-15T23:00:00-03:00') })],
  ])('sends nothing when %s', async (_label, arrange) => {
    arrange()

    expect(await postCareMessages()).toEqual([])
  })
})

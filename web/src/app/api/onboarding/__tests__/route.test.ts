import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const updateWhere = vi.fn()
const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }))

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(async () => ({ ctx: { tenantId: 'tenant-1', userId: 'user-1' }, blocked: null })),
}))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
const ownerLookup = vi.fn(async () => [{ fullName: 'Ana Souza', email: 'ana@b.com' }])
vi.mock('@/db/client', () => ({
  db: {
    update: vi.fn(() => ({ set: updateSet })),
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: ownerLookup }) }) })),
  },
}))
vi.mock('@/lib/discord', () => ({ notifyDiscord: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendNewSignupNotification: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/observability')>()),
  reportSideEffectFailure: vi.fn(),
}))
vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
  saveOnboardingClinic: vi.fn(async () => true),
  updateTenantSettings: vi.fn(),
  markOnboardingCompleted: vi.fn(async () => true),
  createProcedureType: vi.fn(),
  listProcedureTypes: vi.fn(async () => []),
}))
vi.mock('@/db/queries/admin-tenants', () => ({
  findAvailableSlug: vi.fn(async () => 'clinica-bela'),
  generateSlug: vi.fn(),
}))
vi.mock('@/lib/lifecycle-sender', () => ({ scheduleLifecycleWelcome: vi.fn() }))
vi.mock('@/db/queries/products', () => ({ listProducts: vi.fn(async () => []), createProduct: vi.fn() }))
vi.mock('@/db/queries/consent', () => ({
  createConsentTemplate: vi.fn(),
  listConsentTemplates: vi.fn(async () => ({ general: [{ id: 'c' }] })),
}))
vi.mock('@/db/queries/clinical-documents', () => ({
  listClinicalDocumentTemplates: vi.fn(async () => [{ id: 'd' }]),
  createClinicalDocumentTemplate: vi.fn(),
}))
vi.mock('@/db/queries/evaluation-templates', () => ({ createTemplate: vi.fn() }))
vi.mock('@/lib/analytics/server', () => ({ trackServerEvent: vi.fn() }))

import {
  createProcedureType,
  getTenant,
  markOnboardingCompleted,
  saveOnboardingClinic,
  updateTenantSettings,
} from '@/db/queries/tenants'
import { findAvailableSlug } from '@/db/queries/admin-tenants'
import { createProduct } from '@/db/queries/products'
import { createConsentTemplate, listConsentTemplates } from '@/db/queries/consent'
import { createClinicalDocumentTemplate, listClinicalDocumentTemplates } from '@/db/queries/clinical-documents'
import { createTemplate } from '@/db/queries/evaluation-templates'
import { trackServerEvent } from '@/lib/analytics/server'
import { notifyDiscord } from '@/lib/discord'
import { sendNewSignupNotification } from '@/lib/email'
import { reportSideEffectFailure } from '@/lib/observability'
import { createAuditLog } from '@/lib/audit'
import { scheduleLifecycleWelcome } from '@/lib/lifecycle-sender'
import { DEFAULT_WORKING_HOURS } from '@/lib/constants'
import { POST } from '../route'

function postOnboarding(clinic: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({ clinic, procedureTypes: [], selectedProducts: [] }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: {} } as never)
  updateSet.mockImplementation(() => ({ where: updateWhere }))
  vi.mocked(markOnboardingCompleted).mockResolvedValue(true)
  vi.mocked(saveOnboardingClinic).mockResolvedValue(true)
  vi.mocked(listConsentTemplates).mockResolvedValue({ general: [{ id: 'c' }] } as never)
  vi.mocked(listClinicalDocumentTemplates).mockResolvedValue([{ id: 'd' }] as never)
  ownerLookup.mockResolvedValue([{ fullName: 'Ana Souza', email: 'ana@b.com' }])
})

function expectNothingWrittenAfterTheClinicSave() {
  expect(createProcedureType).not.toHaveBeenCalled()
  expect(createTemplate).not.toHaveBeenCalled()
  expect(createProduct).not.toHaveBeenCalled()
  expect(createConsentTemplate).not.toHaveBeenCalled()
  expect(createClinicalDocumentTemplate).not.toHaveBeenCalled()
  expect(updateSet).not.toHaveBeenCalled()
  expect(scheduleLifecycleWelcome).not.toHaveBeenCalled()
  expect(markOnboardingCompleted).not.toHaveBeenCalled()
  expect(updateTenantSettings).not.toHaveBeenCalled()
  expect(trackServerEvent).not.toHaveBeenCalled()
  expect(notifyDiscord).not.toHaveBeenCalled()
  expect(sendNewSignupNotification).not.toHaveBeenCalled()
  expect(createAuditLog).not.toHaveBeenCalled()
}

describe('POST /api/onboarding', () => {
  // Regression: a taken booking link failed onboarding with a generic 500.
  it('answers 409 with a clear message when the slug is taken, and goes no further', async () => {
    vi.mocked(saveOnboardingClinic).mockRejectedValue(
      new Error('Failed query', { cause: { code: '23505', constraint_name: 'tenants_slug_unique' } }),
    )

    const res = await postOnboarding({ name: 'Clinica Bela', slug: 'clinica-bela', phone: '(11) 98888-7777', workingHours: DEFAULT_WORKING_HOURS })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Este link já está em uso. Escolha outro.')
    expectNothingWrittenAfterTheClinicSave()
  })

  it('answers 404 and writes nothing when the clinic is missing', async () => {
    vi.mocked(getTenant).mockResolvedValue(null)

    const res = await postOnboarding({ name: 'Clínica Bella', phone: '(11) 98888-7777', workingHours: DEFAULT_WORKING_HOURS })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ success: false })
    expect(saveOnboardingClinic).not.toHaveBeenCalled()
    expectNothingWrittenAfterTheClinicSave()
  })

  describe('when onboarding was already completed', () => {
    const realClinic = { name: 'Clínica Bella', phone: '(11) 98888-7777', workingHours: DEFAULT_WORKING_HOURS }
    const postWithEverything = () =>
      POST(new Request('http://localhost/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          clinic: realClinic,
          procedureTypes: [{ name: 'Toxina', category: 'botox' }],
          selectedProducts: [{ name: 'Botox', category: 'botox' }],
        }),
      }))

    // Nothing seeded yet, so any step that got this far would write.
    beforeEach(() => {
      vi.mocked(listConsentTemplates).mockResolvedValue({} as never)
      vi.mocked(listClinicalDocumentTemplates).mockResolvedValue([])
    })

    // Regression: a stale wizard's resubmit rewrote the clinic and re-ran every step.
    it('answers 409 and writes nothing', async () => {
      vi.mocked(getTenant).mockResolvedValue({
        id: 'tenant-1',
        settings: { onboarding_completed: true, clinic_name_placeholder: true },
        lifecycleNoticeAt: null,
      } as never)

      const res = await postWithEverything()

      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ success: false, error: 'onboarding_already_completed' })
      expect(findAvailableSlug).not.toHaveBeenCalled()
      expect(saveOnboardingClinic).not.toHaveBeenCalled()
      expectNothingWrittenAfterTheClinicSave()
    })

    it('answers 409 and goes no further when another save completed it after the check', async () => {
      vi.mocked(getTenant).mockResolvedValue({
        id: 'tenant-1',
        settings: { clinic_name_placeholder: true },
        lifecycleNoticeAt: null,
      } as never)
      vi.mocked(saveOnboardingClinic).mockResolvedValue(false)

      const res = await postWithEverything()

      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ success: false, error: 'onboarding_already_completed' })
      expect(saveOnboardingClinic).toHaveBeenCalledTimes(1)
      expectNothingWrittenAfterTheClinicSave()
    })
  })

  // The wizard checks the phone in the browser; a request that skips it must
  // not finish onboarding (and release the held trial welcome) without one.
  it.each([
    ['no phone', undefined],
    ['an empty phone', ''],
    ['a phone without DDD', '9888-7777'],
  ])('answers 400 and changes nothing for %s', async (_label, phone) => {
    vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: { clinic_name_placeholder: true } } as never)

    const res = await postOnboarding({ name: 'Clínica Bella', ...(phone === undefined ? {} : { phone }), workingHours: DEFAULT_WORKING_HOURS })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Informe o telefone da clínica com DDD')
    expect(updateSet).not.toHaveBeenCalled()
    expect(saveOnboardingClinic).not.toHaveBeenCalled()
    expect(updateTenantSettings).not.toHaveBeenCalled()
    expect(markOnboardingCompleted).not.toHaveBeenCalled()
    expect(scheduleLifecycleWelcome).not.toHaveBeenCalled()
    expect(notifyDiscord).not.toHaveBeenCalled()
  })

  // Regression: an emptied address was skipped, so the one autosaved before stayed.
  it('clears the stored address when every field was emptied', async () => {
    updateWhere.mockResolvedValue(undefined)
    vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: {}, lifecycleNoticeAt: new Date() } as never)

    const res = await postOnboarding({
      name: 'Clínica Bella',
      phone: '(11) 98888-7777',
      address: { street: '', city: '' },
      workingHours: DEFAULT_WORKING_HOURS,
    })

    expect(res.status).toBe(200)
    expect(saveOnboardingClinic).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ address: null }))
  })

  describe('a clinic created on arrival after Google sign-up', () => {
    beforeEach(() => {
      updateWhere.mockResolvedValue(undefined)
    })

    it('saves the real name and phone, clears the stand-in flag, then sends the trial welcome', async () => {
      vi.mocked(getTenant).mockResolvedValue({
        id: 'tenant-1',
        settings: { clinic_name_placeholder: true },
      } as never)

      const res = await postOnboarding({ name: 'Clínica Bella', phone: '(11) 98888-7777', workingHours: DEFAULT_WORKING_HOURS })

      expect(res.status).toBe(200)
      expect(saveOnboardingClinic).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
        name: 'Clínica Bella',
        phone: '(11) 98888-7777',
      }))
      expect(markOnboardingCompleted).toHaveBeenCalledWith('tenant-1', { onboarding_draft: null, clinic_name_placeholder: false })
      expect(updateTenantSettings).not.toHaveBeenCalled()
      // The lifecycle notice was first shown on the wizard's phone field.
      expect(updateSet).toHaveBeenCalledWith({ lifecycleNoticeAt: expect.anything() })
      const stampCall = updateSet.mock.calls.findIndex(([values]) => 'lifecycleNoticeAt' in values)
      expect(updateSet.mock.invocationCallOrder[stampCall]).toBeLessThan(
        vi.mocked(markOnboardingCompleted).mock.invocationCallOrder[0],
      )
      expect(scheduleLifecycleWelcome).toHaveBeenCalledTimes(1)
      expect(scheduleLifecycleWelcome).toHaveBeenCalledWith({ tenantId: 'tenant-1' })
      // The welcome reads the phone from the clinic, so it is scheduled after the save.
      expect(vi.mocked(saveOnboardingClinic).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(scheduleLifecycleWelcome).mock.invocationCallOrder[0],
      )
    })

    // Regression: the flag was cleared before the stamp, so a failed stamp left
    // the clinic with no flag and no stamp, out of every lifecycle message.
    it('keeps the stand-in flag when the lifecycle stamp fails, so a retry stamps again', async () => {
      vi.mocked(getTenant).mockResolvedValue({
        id: 'tenant-1',
        settings: { clinic_name_placeholder: true },
      } as never)
      updateSet.mockImplementation((values) => ({
        where: 'lifecycleNoticeAt' in values ? vi.fn().mockRejectedValue(new Error('connection reset')) : updateWhere,
      }))

      const res = await postOnboarding({ name: 'Clínica Bella', phone: '(11) 98888-7777', workingHours: DEFAULT_WORKING_HOURS })

      expect(res.status).toBe(500)
      expect(markOnboardingCompleted).not.toHaveBeenCalled()
      expect(updateTenantSettings).not.toHaveBeenCalled()
      expect(scheduleLifecycleWelcome).not.toHaveBeenCalled()
      expect(notifyDiscord).not.toHaveBeenCalled()
    })

    // Regression: the stamp and welcome were keyed on the stand-in flag, which
    // autosave now clears with the first saved name.
    it('still stamps the notice and sends the welcome when autosave already cleared the stand-in flag', async () => {
      vi.mocked(getTenant).mockResolvedValue({
        id: 'tenant-1',
        settings: { clinic_name_placeholder: false, onboarding_draft: { step: 3 } },
        lifecycleNoticeAt: null,
      } as never)

      const res = await postOnboarding({ name: 'Clínica Bella', phone: '(11) 98888-7777', workingHours: DEFAULT_WORKING_HOURS })

      expect(res.status).toBe(200)
      expect(updateSet).toHaveBeenCalledWith({ lifecycleNoticeAt: expect.anything() })
      expect(scheduleLifecycleWelcome).toHaveBeenCalledWith({ tenantId: 'tenant-1' })
      expect(markOnboardingCompleted).toHaveBeenCalledWith('tenant-1', { onboarding_draft: null })
    })

    it('leaves a clinic that saw the notice before alone: its welcome already went out', async () => {
      vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: {}, lifecycleNoticeAt: new Date() } as never)

      const res = await postOnboarding({ name: 'Clínica Bella', phone: '(11) 98888-7777', workingHours: DEFAULT_WORKING_HOURS })

      expect(res.status).toBe(200)
      expect(markOnboardingCompleted).toHaveBeenCalledWith('tenant-1', { onboarding_draft: null })
      expect(updateSet).not.toHaveBeenCalledWith({ lifecycleNoticeAt: expect.anything() })
      expect(scheduleLifecycleWelcome).not.toHaveBeenCalled()
    })
  })

  describe('telling the team onboarding is done', () => {
    const fourMinutesAgo = () => new Date(Date.now() - 4 * 60_000 - 5_000)

    beforeEach(() => {
      updateWhere.mockResolvedValue(undefined)
      vi.stubEnv('ADMIN_NOTIFICATION_EMAIL', 'admin@floraclin.test')
    })
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    const realClinic = {
      name: 'Clínica Bella',
      phone: '(11) 98888-7777',
      address: { city: 'São Paulo', state: 'SP' },
      workingHours: DEFAULT_WORKING_HOURS,
    }

    it.each([
      ['a Google clinic created on arrival', { clinic_name_placeholder: true }],
      ['an e-mail clinic named at sign-up', {}],
    ])('posts "Cadastro concluído" once with the real data for %s', async (_label, settings) => {
      vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings, createdAt: fourMinutesAgo() } as never)

      const res = await postOnboarding(realClinic)

      expect(res.status).toBe(200)
      expect(notifyDiscord).toHaveBeenCalledTimes(1)
      expect(notifyDiscord).toHaveBeenCalledWith({
        kind: 'onboarding.completed',
        tenantId: 'tenant-1',
        tenantName: 'Clínica Bella',
        phone: '(11) 98888-7777',
        city: 'São Paulo',
        state: 'SP',
        elapsed: 'em 4 min',
      })
      expect(sendNewSignupNotification).toHaveBeenCalledTimes(1)
      expect(sendNewSignupNotification).toHaveBeenCalledWith({
        adminEmail: 'admin@floraclin.test',
        clinicName: 'Clínica Bella',
        ownerName: 'Ana Souza',
        ownerEmail: 'ana@b.com',
        phone: '(11) 98888-7777',
      })
    })

    it('posts nothing when a concurrent save completed onboarding first', async () => {
      vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: {}, createdAt: fourMinutesAgo() } as never)
      vi.mocked(markOnboardingCompleted).mockResolvedValue(false)

      const res = await postOnboarding(realClinic)

      expect(res.status).toBe(200)
      expect(notifyDiscord).not.toHaveBeenCalled()
      expect(sendNewSignupNotification).not.toHaveBeenCalled()
    })

    it('clears a leftover stand-in flag on a concurrent save without posting again', async () => {
      vi.mocked(getTenant).mockResolvedValue({
        id: 'tenant-1',
        settings: { clinic_name_placeholder: true },
        createdAt: fourMinutesAgo(),
      } as never)
      vi.mocked(markOnboardingCompleted).mockResolvedValue(false)

      const res = await postOnboarding(realClinic)

      expect(res.status).toBe(200)
      expect(updateTenantSettings).toHaveBeenCalledWith('tenant-1', {
        onboarding_completed: true,
        clinic_name_placeholder: false,
      })
      expect(notifyDiscord).not.toHaveBeenCalled()
    })

    // Regression: the report ran after the audit log, so a failed audit insert
    // left the flag set and no later save would ever report the clinic.
    it('still reports the clinic when a later step fails after the flag is set', async () => {
      vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: {}, createdAt: fourMinutesAgo() } as never)
      vi.mocked(createAuditLog).mockRejectedValueOnce(new Error('connection reset'))

      const res = await postOnboarding(realClinic)

      expect(res.status).toBe(500)
      expect(notifyDiscord).toHaveBeenCalledTimes(1)
      expect(notifyDiscord).toHaveBeenCalledWith(expect.objectContaining({ kind: 'onboarding.completed' }))
      expect(sendNewSignupNotification).toHaveBeenCalledTimes(1)
    })

    it('still answers 200 when telling the team fails', async () => {
      vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: {}, createdAt: fourMinutesAgo() } as never)
      ownerLookup.mockRejectedValue(new Error('connection reset'))

      const res = await postOnboarding(realClinic)

      expect(res.status).toBe(200)
      expect(reportSideEffectFailure).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
        area: 'onboarding',
        step: 'notify_completed',
      }))
    })
  })
})

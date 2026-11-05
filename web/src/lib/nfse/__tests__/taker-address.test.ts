import { describe, expect, it } from 'vitest'
import { resolveNfseTaker } from '../taker-address'

const CPF = '529.982.247-25'
const PATIENT = { street: 'Av. Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', zip: '01310-100' }
const CLINIC = { street: 'Rua XV de Novembro', number: '50', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zip: '80020-310' }

describe('resolveNfseTaker', () => {
  it.each([
    ['a complete patient address wins over the fallback', CPF, PATIENT, CLINIC, true, { ok: true, source: 'patient', cityCode: '3550308' }],
    ['an empty patient address uses the clinic when the fallback is on', CPF, null, CLINIC, true, { ok: true, source: 'clinic', cityCode: '4106902' }],
    ['an empty patient address asks for it when the fallback is off', CPF, null, CLINIC, false, { ok: false, source: 'patient', missing: ['zip', 'street', 'number', 'neighborhood', 'city', 'state'] }],
    ['a partial patient address asks to complete it, never mixing in the clinic', CPF, { ...PATIENT, number: '' }, CLINIC, true, { ok: false, source: 'patient', missing: ['number'] }],
    ['an incomplete clinic address asks for the patient address', CPF, {}, { ...CLINIC, zip: '' }, true, { ok: false, source: 'patient', missing: ['zip', 'street', 'number', 'neighborhood', 'city', 'state'] }],
    ['the CPF stays required with the clinic address', null, null, CLINIC, true, { ok: false, source: 'clinic', missing: ['cpf'] }],
  ])('%s', (_name, cpf, patientAddress, clinicAddress, clinicAddressFallback, expected) => {
    expect(resolveNfseTaker({ cpf, patientAddress, clinicAddress, clinicAddressFallback })).toMatchObject(expected)
  })
})

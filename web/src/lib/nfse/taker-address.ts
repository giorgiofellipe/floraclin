import { findMunicipalityCode } from '@bullcode/fiscal'
import { isValidCep, isValidCpf, onlyDigits } from '@/lib/br-documents'
import type { NfseAddress } from './types'

export type NfseTakerField = 'cpf' | 'zip' | 'street' | 'number' | 'neighborhood' | 'city' | 'state'
export type NfseAddressSource = 'patient' | 'clinic'

export type NfseTakerResolution =
  | { ok: true; source: NfseAddressSource; cpf: string; address: NfseAddress; cityCode: string }
  | { ok: false; source: NfseAddressSource; missing: NfseTakerField[] }

type StoredAddress = Record<string, string | null | undefined>

function asAddress(value: unknown): StoredAddress {
  return (value ?? {}) as StoredAddress
}

function missingAddressFields(a: StoredAddress): Exclude<NfseTakerField, 'cpf'>[] {
  const missing: Exclude<NfseTakerField, 'cpf'>[] = []
  if (!isValidCep(a.zip ?? '')) missing.push('zip')
  if (!a.street?.trim()) missing.push('street')
  if (!a.number?.trim()) missing.push('number')
  if (!a.neighborhood?.trim()) missing.push('neighborhood')
  if (!a.city?.trim() || (a.state && !findMunicipalityCode(a.city, a.state))) missing.push('city')
  if (!a.state?.trim()) missing.push('state')
  return missing
}

const ADDRESS_KEYS = ['zip', 'street', 'number', 'complement', 'neighborhood', 'city', 'state'] as const

function isEmpty(a: StoredAddress): boolean {
  return ADDRESS_KEYS.every((key) => !a[key]?.trim())
}

export function isCompleteAddress(address: unknown): boolean {
  return missingAddressFields(asAddress(address)).length === 0
}

/**
 * The clinic address stands in only for a patient with no address at all: a
 * partly filled one is asked to be completed, so the two are never mixed.
 */
export function resolveNfseTaker(input: {
  cpf: string | null
  patientAddress: unknown
  clinicAddress: unknown
  clinicAddressFallback: boolean
}): NfseTakerResolution {
  const patient = asAddress(input.patientAddress)
  const clinic = asAddress(input.clinicAddress)
  const useClinic = input.clinicAddressFallback && isEmpty(patient) && isCompleteAddress(clinic)
  const source: NfseAddressSource = useClinic ? 'clinic' : 'patient'
  const chosen = useClinic ? clinic : patient

  const missing: NfseTakerField[] = [...missingAddressFields(chosen)]
  if (!isValidCpf(input.cpf ?? '')) missing.unshift('cpf')
  if (missing.length > 0) return { ok: false, source, missing }

  return {
    ok: true,
    source,
    cpf: onlyDigits(input.cpf ?? ''),
    address: {
      zip: onlyDigits(chosen.zip ?? ''),
      street: chosen.street!.trim(),
      number: chosen.number!.trim(),
      complement: chosen.complement?.trim() || null,
      neighborhood: chosen.neighborhood!.trim(),
      city: chosen.city!.trim(),
      state: chosen.state!.trim().toUpperCase(),
    },
    cityCode: findMunicipalityCode(chosen.city!, chosen.state!)!,
  }
}

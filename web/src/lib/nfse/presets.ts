import type { NfseFiscalSettingsInput, NfseServiceCodes, NfseServicePresetId } from './types'

const COMMON = { tribISSQN: 1, cIndOp: '100301', CST: '000', cClassTrib: '000001' } as const

export const NFSE_SERVICE_PRESETS: Record<NfseServicePresetId, { label: string } & NfseServiceCodes> = {
  odontologia: { label: 'Odontologia', cTribNac: '041201', cNBS: '123012300', ...COMMON },
  medicina: { label: 'Medicina', cTribNac: '040101', cNBS: '123012200', ...COMMON },
  biomedicina: { label: 'Biomedicina', cTribNac: '040102', cNBS: '123019900', ...COMMON },
  enfermagem: { label: 'Enfermagem', cTribNac: '040601', cNBS: '123019100', ...COMMON },
  estetica: { label: 'Estética (esteticista)', cTribNac: '060201', cNBS: '126029000', ...COMMON },
}

export function resolveServiceCodes(
  s: Pick<NfseFiscalSettingsInput, 'servicePreset' | 'advancedCodes'>,
): NfseServiceCodes {
  if (s.servicePreset) {
    const { label: _label, ...codes } = NFSE_SERVICE_PRESETS[s.servicePreset]
    return codes
  }
  if (s.advancedCodes) return s.advancedCodes
  throw new Error('NFS-e service codes are not configured')
}

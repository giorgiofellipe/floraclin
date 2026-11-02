import { findMunicipality } from '@bullcode/fiscal'
import { z } from 'zod'
import { NFSE_SERVICE_PRESETS } from '@/lib/nfse/presets'
import type { NfseFiscalSettingsInput, NfseServicePresetId } from '@/lib/nfse/types'

export const nfseCertificateUploadSchema = z.object({
  pfxBase64: z.string().min(1, 'Selecione o certificado').max(65536, 'Certificado grande demais'),
  password: z.string().min(1, 'Informe a senha').max(200),
})

const rate = z.number().min(0, 'Mínimo 0').max(100, 'Máximo 100')
const digits = (n: number, label: string) => z.string().regex(new RegExp(`^\\d{${n}}$`), `${label} deve ter ${n} dígitos`)

const advancedCodesSchema = z.object({
  cTribNac: digits(6, 'Código de tributação nacional'),
  cNBS: digits(9, 'Código NBS'),
  tribISSQN: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  cIndOp: digits(6, 'Indicador de operação'),
  CST: digits(3, 'CST'),
  cClassTrib: digits(6, 'Classificação tributária'),
})

export const nfseFiscalSettingsSchema = z
  .object({
    municipalityCode: z
      .string()
      .regex(/^\d{7}$/, 'Código do município deve ter 7 dígitos')
      .refine((code) => findMunicipality(code) !== null, 'Município não encontrado'),
    municipalRegistration: z.string().trim().max(15).nullable(),
    simplesNacionalOption: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    simplesNacionalRegime: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    simplesNacionalTaxRate: rate.nullable(),
    servicePreset: z
      .enum(Object.keys(NFSE_SERVICE_PRESETS) as [NfseServicePresetId, ...NfseServicePresetId[]])
      .nullable(),
    advancedCodes: advancedCodesSchema.nullable(),
    issRate: rate.nullable(),
    issWithheld: z.boolean(),
    emissionMode: z.enum(['ask', 'always']),
    emailPatient: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.simplesNacionalOption === 3) {
      if (value.simplesNacionalRegime === null) {
        ctx.addIssue({ code: 'custom', path: ['simplesNacionalRegime'], message: 'Informe o regime de apuração' })
      }
      if (value.simplesNacionalTaxRate === null) {
        ctx.addIssue({ code: 'custom', path: ['simplesNacionalTaxRate'], message: 'Informe a alíquota do Simples' })
      }
    }
    if (value.servicePreset === null && value.advancedCodes === null) {
      ctx.addIssue({ code: 'custom', path: ['servicePreset'], message: 'Escolha o serviço prestado' })
    }
  }) satisfies z.ZodType<NfseFiscalSettingsInput>

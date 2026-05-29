import { z } from 'zod'

const clinicSettingsSchema = z.object({
  defaultPackageValidityMonths: z.number().int().min(1).max(120).nullable().optional(),
}).passthrough()

export type ClinicSettings = z.infer<typeof clinicSettingsSchema>

export function getDefaultPackageValidityMonths(settings: unknown): number | null {
  const parsed = clinicSettingsSchema.safeParse(settings ?? {})
  if (!parsed.success) return null
  return parsed.data.defaultPackageValidityMonths ?? null
}

export const clinicSettingsKey = 'defaultPackageValidityMonths'

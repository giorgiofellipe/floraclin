import { z } from 'zod'

export const cartLineSchema = z.object({
  procedureTypeId: z.string().uuid(),
  procedureTypeName: z.string().min(1),
  sessions: z.number().int().min(1).max(50),
  defaultPrice: z.number().nonnegative(),
  sourceTemplateLineId: z.string().uuid().nullable(),
})

export const encounterCartSchema = z.object({
  templateId: z.string().uuid().nullable(),
  templateName: z.string().nullable(),
  templateDefaultPrice: z.number().nonnegative().nullable(),
  templateValidityMonths: z.number().int().min(1).max(120).nullable(),
  lines: z.array(cartLineSchema).min(1),
  totalOverride: z.number().nonnegative().nullable(),
}).refine(
  (c) => c.lines.length === new Set(c.lines.map((l) => l.procedureTypeId)).size || c.templateId !== null,
  { message: 'Linhas ad-hoc não podem repetir o mesmo procedimento.' }
)

export type EncounterCart = z.infer<typeof encounterCartSchema>
export type CartLine = z.infer<typeof cartLineSchema>

export function isBundleCart(cart: EncounterCart): boolean {
  return cart.templateId !== null || cart.lines.some((l) => l.sessions > 1)
}

export function computeCartTotal(cart: EncounterCart): number {
  if (cart.totalOverride !== null) return cart.totalOverride
  const adhocSubtotal = cart.lines
    .filter((l) => l.sourceTemplateLineId === null)
    .reduce((sum, l) => sum + l.defaultPrice * l.sessions, 0)
  const templateSubtotal = cart.templateDefaultPrice ?? 0
  return adhocSubtotal + templateSubtotal
}

export function autoPackageName(cart: EncounterCart): string {
  if (cart.templateId !== null && cart.templateName) return cart.templateName
  if (cart.lines.length === 1) {
    const l = cart.lines[0]
    return `Pacote ${l.procedureTypeName} — ${l.sessions} sessões`
  }
  const parts = cart.lines.map((l) => `${l.sessions}× ${l.procedureTypeName}`)
  return `Pacote: ${parts.join(' + ')}`
}

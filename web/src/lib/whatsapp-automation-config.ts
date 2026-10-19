import { z } from 'zod'

export const AUTOMATION_DAYS_MAX = 30
export const ANAMNESIS_STALE_DAYS_MAX = 365

export const AUTOMATION_CONFIG_SCHEMAS = {
  appointment_confirmation: z.object({
    autoAnamnesisEnabled: z.boolean().default(false),
    anamnesisStaleDays: z.number().int().min(1).max(ANAMNESIS_STALE_DAYS_MAX).default(60),
  }),
  payment_reminder: z.object({
    daysBeforeDue: z.number().int().min(1).max(AUTOMATION_DAYS_MAX).default(3),
  }),
  follow_up: z.object({
    daysAfterProcedure: z.number().int().min(1).max(AUTOMATION_DAYS_MAX).default(7),
  }),
}

export type AutomationTrigger = keyof typeof AUTOMATION_CONFIG_SCHEMAS
export type AutomationConfig<T extends AutomationTrigger> = z.infer<(typeof AUTOMATION_CONFIG_SCHEMAS)[T]>

export function isAutomationTrigger(value: string): value is AutomationTrigger {
  return Object.hasOwn(AUTOMATION_CONFIG_SCHEMAS, value)
}

export function parseAutomationConfig<T extends AutomationTrigger>(
  trigger: T,
  raw: unknown,
): AutomationConfig<T> {
  return AUTOMATION_CONFIG_SCHEMAS[trigger].parse(raw ?? {}) as AutomationConfig<T>
}

export function automationConfigDefaults<T extends AutomationTrigger>(trigger: T): AutomationConfig<T> {
  return parseAutomationConfig(trigger, {})
}

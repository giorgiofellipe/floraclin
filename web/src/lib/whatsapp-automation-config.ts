import { z } from 'zod'

export const AUTOMATION_DAYS_MAX = 30

/** An event older than this is bookkeeping catch-up, not news to the patient. */
export const MAX_EVENT_AGE_DAYS = 2

/** A patient gets at most one reactivation message in this many days. */
export const REACTIVATION_COOLDOWN_DAYS = 30
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
  payment_confirmation: z.object({}),
  post_procedure_care: z.object({}),
  pre_procedure_instructions: z.object({
    daysBeforeAppointment: z.number().int().min(1).max(AUTOMATION_DAYS_MAX).default(3),
  }),
}

export type AutomationTrigger = keyof typeof AUTOMATION_CONFIG_SCHEMAS
/** Sent when something happens in the app, not by a cron. */
export type EventAutomationTrigger = Extract<AutomationTrigger, 'payment_confirmation' | 'post_procedure_care'>
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

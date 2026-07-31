/**
 * Clínica Lumé: a fictional tenant used to produce marketing screenshots.
 *
 * Every value here is deliberate. The financial targets are reproduced by
 * `revenue.ts` and asserted by `verify.ts`, so changing one without the other
 * makes the seed fail loudly rather than produce a wrong screenshot.
 */

/** Fixed so re-runs replace the same tenant instead of accumulating copies. */
export const DEMO_TENANT_ID = '00000000-0000-4000-8000-00000000d3m0'
export const DEMO_SLUG = 'clinica-lume'

export const CLINIC = {
  name: 'Clínica Lumé',
  city: 'São Paulo',
  state: 'SP',
  email: 'contato@example.com',
  phone: '(11) 90000-0100',
} as const

export const PRACTITIONER = {
  fullName: 'Dra. Camila Ferreira',
  email: 'camila.ferreira@example.com',
  professionalTitle: 'Cirurgiã-dentista',
  registryType: 'CRO',
  registryNumber: '12.847',
  registryState: 'SP',
} as const

/**
 * Keeps the tenant out of the WhatsApp automations cron. The cron keeps a
 * tenant when the mode is unset or 'floraclin', so both fields are required:
 * the mode alone would still pass if whatsapp_enabled were truthy.
 */
export const SAFETY_SETTINGS = {
  whatsapp_mode: 'own',
  whatsapp_enabled: false,
  is_demo: true,
} as const

/** RFC 2606 reserves example.com, so no address can receive real mail. */
export const EMAIL_DOMAIN = 'example.com'
/** Prefix chosen so a leaked send cannot reach a real subscriber. */
export const PHONE_PREFIX = '(11) 90000-0'

export const PATIENT_COUNT = 50

export interface CatalogueItem {
  name: string
  category: string
  price: number
  durationMin: number
}

export const CATALOGUE: CatalogueItem[] = [
  { name: 'Harmonização facial completa', category: 'harmonizacao', price: 4500, durationMin: 120 },
  { name: 'Bioestimulador de colágeno (Sculptra)', category: 'bioestimulador', price: 2200, durationMin: 60 },
  { name: 'Toxina botulínica completa', category: 'toxina', price: 1800, durationMin: 45 },
  { name: 'Toxina botulínica parcial (glabela/testa)', category: 'toxina', price: 900, durationMin: 30 },
  { name: 'Preenchimento de olheiras', category: 'preenchimento', price: 1600, durationMin: 60 },
  { name: 'Preenchimento malar', category: 'preenchimento', price: 1500, durationMin: 60 },
  { name: 'Preenchimento labial', category: 'preenchimento', price: 1400, durationMin: 45 },
  { name: 'Skinbooster', category: 'skinbooster', price: 1200, durationMin: 45 },
  { name: 'Limpeza de pele profunda', category: 'estetica', price: 350, durationMin: 60 },
]

/** Current-month targets, all reproduced by revenue.ts. */
export const TARGETS = {
  proceduresThisMonth: 23,
  grossThisMonth: 42000,
  receivedThisMonth: 34200,
  pendingThisMonth: 7800,
  expensesThisMonth: 8400,
  /** receivedThisMonth - expensesThisMonth, computed by the app. */
  netProfitThisMonth: 25800,
} as const

/**
 * The catalogue admits no combination of 23 items totalling exactly 42.000.
 * The closest natural mix lands on 40.850, so one Harmonização is sold as a
 * package at PACKAGE_PRICE, which is how a clinic actually closes that gap.
 */
export const MONTH_MIX: Array<{ name: string; qty: number }> = [
  { name: 'Harmonização facial completa', qty: 2 },
  { name: 'Bioestimulador de colágeno (Sculptra)', qty: 3 },
  { name: 'Toxina botulínica completa', qty: 6 },
  { name: 'Toxina botulínica parcial (glabela/testa)', qty: 3 },
  { name: 'Preenchimento de olheiras', qty: 2 },
  { name: 'Preenchimento malar', qty: 2 },
  { name: 'Preenchimento labial', qty: 2 },
  { name: 'Skinbooster', qty: 2 },
  { name: 'Limpeza de pele profunda', qty: 1 },
]
export const PACKAGE_PRICE = 5650

/** Received per month, oldest first; the last entry is the current month. */
export const SIX_MONTH_RECEIVED = [18200, 22500, 26800, 29400, 37100, 34200] as const

export const MONTHLY_EXPENSES = [
  { description: 'Aluguel da clínica', category: 'Aluguel', amount: 4500 },
  { description: 'Materiais e insumos', category: 'Materiais', amount: 2600 },
  { description: 'Plataformas e sistemas', category: 'Plataformas', amount: 1300 },
]

export const FORWARD_DAYS = 15
export const MIN_PER_DAY = 3
export const MAX_PER_DAY = 5
export const TODAY_APPOINTMENTS = 4

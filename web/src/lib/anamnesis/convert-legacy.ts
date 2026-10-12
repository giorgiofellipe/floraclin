import type { FormResponses } from '@/lib/forms/types'

export interface LegacyAnamnesisRow {
  main_complaint: string | null
  patient_goals: string | null
  medical_history: Record<string, unknown> | null
  medications: unknown
  allergies: unknown
  previous_surgeries: unknown
  chronic_conditions: unknown
  is_pregnant: boolean | null
  is_breastfeeding: boolean | null
  lifestyle: Record<string, unknown> | null
  skincare_routine: unknown
  previous_aesthetic_treatments: unknown
}

const MEDICAL_HISTORY: Record<string, string> = {
  diabetes: 'Diabetes',
  hipertensao: 'Hipertensão',
  autoimune: 'Doença autoimune',
  cardiovascular: 'Doença cardiovascular',
  hepatite: 'Hepatite',
  hiv: 'HIV/AIDS',
  cancer: 'Câncer',
  epilepsia: 'Epilepsia',
  disturbioCoagulacao: 'Distúrbio de coagulação',
  queloides: 'Queloides',
  herpes: 'Herpes',
}

const SEVERITY = { leve: 'Leve', moderada: 'Moderada', grave: 'Grave' }
const SATISFACTION = {
  muito_insatisfeito: 'Muito insatisfeito',
  insatisfeito: 'Insatisfeito',
  neutro: 'Neutro',
  satisfeito: 'Satisfeito',
  muito_satisfeito: 'Muito satisfeito',
}
const SMOKING = { nao: 'Não', ex_fumante: 'Ex-fumante', sim_ocasional: 'Sim, ocasional', sim_diario: 'Sim, diário' }
const ALCOHOL = { nao: 'Não', ocasional: 'Ocasional', moderado: 'Moderado', frequente: 'Frequente' }
const EXERCISE = { sedentario: 'Sedentário', leve: 'Leve', moderado: 'Moderado', intenso: 'Intenso' }
const SLEEP = { ruim: 'Ruim', regular: 'Regular', bom: 'Bom', excelente: 'Excelente' }
const DIET = { desequilibrada: 'Desequilibrada', regular: 'Regular', equilibrada: 'Equilibrada', restritiva: 'Restritiva' }
const SUN_EXPOSURE = { minima: 'Mínima', moderada: 'Moderada', alta: 'Alta', muito_alta: 'Muito alta' }

const LIFESTYLE: Record<string, { id: string; labels: Record<string, string> }> = {
  smoking: { id: 'anam-smoking', labels: SMOKING },
  alcohol: { id: 'anam-alcohol', labels: ALCOHOL },
  exercise: { id: 'anam-exercise', labels: EXERCISE },
  sleep: { id: 'anam-sleep', labels: SLEEP },
  diet: { id: 'anam-diet', labels: DIET },
  sunExposure: { id: 'anam-sun-exposure', labels: SUN_EXPOSURE },
}

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function listRows(value: unknown, columns: string[], selectLabels: Record<string, Record<string, string>> = {}) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row: Record<string, string> = {}
      if (typeof item !== 'object' || item === null) return row
      for (const column of columns) {
        const cell = (item as Record<string, unknown>)[column]
        if (!filled(cell)) continue
        const labels = selectLabels[column]
        if (!labels) row[column] = cell
        else if (labels[cell]) row[column] = labels[cell]
      }
      return row
    })
    .filter((row) => Object.keys(row).length > 0)
}

export function convertLegacyAnamnesis(row: LegacyAnamnesisRow): FormResponses {
  const out: FormResponses = {}
  if (filled(row.main_complaint)) out['anam-main-complaint'] = row.main_complaint
  if (filled(row.patient_goals)) out['anam-patient-goals'] = row.patient_goals

  const history = row.medical_history ?? {}
  const selected = Object.entries(MEDICAL_HISTORY).filter(([key]) => history[key] === true).map(([, label]) => label)
  const other = filled(history.outros) ? history.outros : ''
  if (selected.length > 0 || other) out['anam-medical-history'] = { selected, other }

  const lists: Array<[string, unknown, string[], Record<string, Record<string, string>>?]> = [
    ['anam-medications', row.medications, ['name', 'dosage', 'frequency', 'reason']],
    ['anam-allergies', row.allergies, ['substance', 'reaction', 'severity'], { severity: SEVERITY }],
    ['anam-previous-surgeries', row.previous_surgeries, ['procedure', 'year', 'notes']],
    ['anam-skincare-routine', row.skincare_routine, ['product', 'frequency', 'notes']],
    [
      'anam-previous-treatments',
      row.previous_aesthetic_treatments,
      ['procedure', 'date', 'professional', 'notes', 'satisfaction'],
      { satisfaction: SATISFACTION },
    ],
  ]
  for (const [id, value, columns, selects] of lists) {
    const rows = listRows(value, columns, selects)
    if (rows.length > 0) out[id] = rows
  }

  const chronic = Array.isArray(row.chronic_conditions)
    ? row.chronic_conditions.filter(filled).map((condicao) => ({ condicao }))
    : []
  if (chronic.length > 0) out['anam-chronic-conditions'] = chronic

  // The legacy columns default to false, so false never proved the patient answered "no".
  if (row.is_pregnant === true) out['anam-pregnant'] = 'Sim'
  if (row.is_breastfeeding === true) out['anam-breastfeeding'] = 'Sim'

  for (const [key, { id, labels }] of Object.entries(LIFESTYLE)) {
    const value = row.lifestyle?.[key]
    if (filled(value) && labels[value]) out[id] = labels[value]
  }
  return out
}

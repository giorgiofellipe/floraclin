import { isQuestionAnswered } from '@/lib/forms/answers'
import type { FormListResponse } from '@/lib/forms/types'
import type { AnamnesisRecord } from './types'

// Question ids from the default template; clinic templates are copies of it, so the ids carry over.
const ALLERGIES_ID = 'anam-allergies'
const MEDICAL_HISTORY_ID = 'anam-medical-history'
const PREGNANT_ID = 'anam-pregnant'
const BREASTFEEDING_ID = 'anam-breastfeeding'
const CHRONIC_CONDITIONS_ID = 'anam-chronic-conditions'

// Only a whole answer that denies ("Nenhuma alergia conhecida", "Não") is dropped;
// anything longer may carry a real condition and stays an alert.
const NEGATIVE_ANSWER = /^(n[aã]o|nada|nenhum|nenhuma|sem)( (alergias?|condi[cç](ão|ões)|conhecid[ao]s?|nada))*\.?$/i

function isAffirmative(text: string | undefined): text is string {
  const value = text?.trim()
  return !!value && !NEGATIVE_ANSWER.test(value)
}

export function hasAnamnesisAnswers(record: AnamnesisRecord | null | undefined): boolean {
  if (!record) return false
  return record.templateSnapshot.some((section) =>
    section.questions.some((q) => isQuestionAnswered(q, record.responses[q.id])),
  )
}

/** False when a clinic template dropped the questions the alerts read, so "nothing to flag" would mislead. */
export function coversAlertQuestions(record: AnamnesisRecord): boolean {
  const ids = new Set(record.templateSnapshot.flatMap((s) => s.questions.map((q) => q.id)))
  return [ALLERGIES_ID, MEDICAL_HISTORY_ID, PREGNANT_ID].every((id) => ids.has(id))
}

/** Answers a practitioner must see before a procedure: allergies, health conditions, pregnancy. */
export function anamnesisAlerts(record: AnamnesisRecord): string[] {
  const alerts: string[] = []
  const { responses } = record

  const allergies = responses[ALLERGIES_ID]
  if (Array.isArray(allergies)) {
    const substances = (allergies as FormListResponse)
      .map((row) => row.substance?.trim())
      .filter(isAffirmative)
    if (substances.length > 0) alerts.push(`Alergia: ${substances.join(', ')}`)
  }

  const history = responses[MEDICAL_HISTORY_ID] as { selected?: string[]; other?: string } | undefined
  if (history && typeof history === 'object' && !Array.isArray(history)) {
    alerts.push(...(history.selected ?? []))
    if (isAffirmative(history.other)) alerts.push(history.other.trim())
  }

  const chronic = responses[CHRONIC_CONDITIONS_ID]
  if (Array.isArray(chronic)) {
    alerts.push(...(chronic as FormListResponse).map((row) => row.condicao?.trim()).filter(isAffirmative))
  }

  if (responses[PREGNANT_ID] === 'Sim') alerts.push('Gestante')
  if (responses[BREASTFEEDING_ID] === 'Sim') alerts.push('Amamentando')

  return alerts
}

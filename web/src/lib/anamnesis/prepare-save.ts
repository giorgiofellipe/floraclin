import { isQuestionAnswered } from '@/lib/forms/answers'
import { carryResponses } from '@/lib/forms/carry-responses'
import { buildFormResponseSchema } from '@/lib/forms/response-schema'
import type { FormResponses } from '@/lib/forms/types'
import type { AnamnesisSaveBody } from './schemas'
import type { AnamnesisRecord, AnamnesisTemplate, AnamnesisWrite } from './types'

export const STALE_ANAMNESIS_MESSAGE = 'Os dados foram alterados por outro usuário. Recarregue a página e tente novamente.'
const TEMPLATE_CHANGED = 'O modelo de anamnese mudou. Os dados foram recarregados.'

export type AnamnesisSaveMode = 'staff' | 'staff_apply_current' | 'public'

export type PrepareSaveResult =
  | { ok: true; write: AnamnesisWrite }
  | { ok: false; status: 409; code: 'stale' | 'template_changed'; error: string }
  | { ok: false; status: 400; error: string }

interface PrepareSaveInput {
  mode: AnamnesisSaveMode
  existing: Pick<AnamnesisRecord, 'templateVersion' | 'templateSnapshot' | 'responses'> | null
  current: AnamnesisTemplate
  body: Pick<AnamnesisSaveBody, 'templateVersion' | 'responses' | 'expectNoRow'>
}

export function prepareAnamnesisSave({ mode, existing, current, body }: PrepareSaveInput): PrepareSaveResult {
  if (mode !== 'public' && body.expectNoRow && existing) {
    return { ok: false, status: 409, code: 'stale', error: STALE_ANAMNESIS_MESSAGE }
  }

  const target: AnamnesisTemplate =
    mode === 'staff' && existing !== null
      ? { version: existing.templateVersion, sections: existing.templateSnapshot }
      : current

  let responses: Record<string, unknown> = body.responses
  let enforceRequired = false
  if (mode === 'public') {
    const sawOlder = body.templateVersion < current.version
    enforceRequired = !sawOlder
    const patient = sawOlder ? carryResponses(body.responses, current.sections) : body.responses
    responses = existing
      ? mergePublicAnswers(carryResponses(existing.responses, current.sections), patient, current)
      : patient
  } else if (body.templateVersion !== target.version) {
    return { ok: false, status: 409, code: 'template_changed', error: TEMPLATE_CHANGED }
  }

  const parsed = buildFormResponseSchema(target.sections, { enforceRequired }).safeParse(responses)
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'Dados inválidos: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  return {
    ok: true,
    write: { templateVersion: target.version, templateSnapshot: target.sections, responses: parsed.data as FormResponses },
  }
}

/** The patient only overwrites questions they answered; staff answers to the rest stay. */
function mergePublicAnswers(
  saved: FormResponses,
  patient: Record<string, unknown>,
  current: AnamnesisTemplate,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...saved }
  for (const section of current.sections) {
    for (const question of section.questions) {
      if (Object.hasOwn(patient, question.id) && isQuestionAnswered(question, patient[question.id])) {
        merged[question.id] = patient[question.id]
      }
    }
  }
  return merged
}

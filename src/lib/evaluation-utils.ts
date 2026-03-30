import type { EvaluationSection } from '@/types/evaluation'

export function validateEvaluationResponses(
  sections: EvaluationSection[],
  responses: Record<string, unknown>
): { valid: boolean; missingQuestions: { sectionTitle: string; questionLabel: string }[] } {
  const missing: { sectionTitle: string; questionLabel: string }[] = []

  for (const section of sections) {
    for (const question of section.questions) {
      if (!question.required) continue
      if (question.type === 'face_diagram') continue

      const answer = responses[question.id]
      const isEmpty =
        answer === undefined ||
        answer === null ||
        answer === '' ||
        (Array.isArray(answer) && answer.length === 0) ||
        (typeof answer === 'object' &&
          !Array.isArray(answer) &&
          answer !== null &&
          (!(answer as Record<string, unknown>).selected ||
            ((answer as Record<string, unknown>).selected as string | string[] | undefined) === '' ||
            (Array.isArray((answer as Record<string, unknown>).selected) &&
              ((answer as Record<string, unknown>).selected as string[]).length === 0)))

      if (isEmpty) {
        missing.push({ sectionTitle: section.title, questionLabel: question.label })
      }
    }
  }

  return { valid: missing.length === 0, missingQuestions: missing }
}

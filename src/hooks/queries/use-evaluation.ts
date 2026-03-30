'use client'

import { useQuery } from '@tanstack/react-query'
import { getTemplatesForProcedureTypesAction } from '@/actions/evaluation-templates'
import { getEvaluationResponsesForProcedureAction } from '@/actions/evaluation-responses'

export function useEvaluationTemplates(typeIds: string[]) {
  return useQuery({
    queryKey: ['evaluation', 'templates', typeIds],
    queryFn: () => getTemplatesForProcedureTypesAction(typeIds),
    enabled: typeIds.length > 0,
  })
}

export function useEvaluationResponses(procedureId: string | undefined) {
  return useQuery({
    queryKey: ['evaluation', 'responses', procedureId],
    queryFn: () => getEvaluationResponsesForProcedureAction(procedureId!),
    enabled: !!procedureId,
  })
}

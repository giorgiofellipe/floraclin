'use client'

import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useInvalidation() {
  const queryClient = useQueryClient()

  return {
    invalidateDashboard: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),

    invalidatePatients: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all }),

    invalidatePatient: (id: string) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.detail(id) }),

    invalidateAppointments: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all }),

    invalidateFinancial: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all }),

    invalidateSettings: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all }),

    invalidateTenant: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.tenant }),

    invalidateProcedureTypes: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.procedureTypes }),

    invalidateProducts: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.products }),

    invalidateMembers: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.members }),

    invalidateConsentTemplates: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.consentTemplates }),

    invalidateAnamnesis: (patientId: string) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.anamnesis(patientId) }),

    invalidateProcedures: (patientId?: string) => {
      if (patientId) {
        return queryClient.invalidateQueries({ queryKey: queryKeys.procedures.list(patientId) })
      }
      return queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
    },

    invalidateConsent: () =>
      queryClient.invalidateQueries({ queryKey: ['consent'] }),

    invalidateEvaluation: () =>
      queryClient.invalidateQueries({ queryKey: ['evaluation'] }),

    invalidateAudit: () =>
      queryClient.invalidateQueries({ queryKey: ['audit'] }),

    invalidateAll: () =>
      queryClient.invalidateQueries(),
  }
}

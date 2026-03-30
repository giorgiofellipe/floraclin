import { useQueryClient } from '@tanstack/react-query'

export function useInvalidation() {
  const queryClient = useQueryClient()

  return {
    invalidatePatients: () =>
      queryClient.invalidateQueries({ queryKey: ['patients'] }),
    invalidatePatient: (id: string) =>
      queryClient.invalidateQueries({ queryKey: ['patients', id] }),
    invalidateDashboard: () =>
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    invalidateAppointments: () =>
      queryClient.invalidateQueries({ queryKey: ['appointments'] }),
    invalidateFinancial: () =>
      queryClient.invalidateQueries({ queryKey: ['financial'] }),
    invalidateProcedures: (patientId: string) =>
      queryClient.invalidateQueries({ queryKey: ['procedures', { patientId }] }),
    invalidateProcedure: (id: string) =>
      queryClient.invalidateQueries({ queryKey: ['procedures', id] }),
    invalidateAnamnesis: (patientId: string) =>
      queryClient.invalidateQueries({ queryKey: ['anamnesis', patientId] }),
    invalidateConsent: () =>
      queryClient.invalidateQueries({ queryKey: ['consent'] }),
    invalidateProducts: () =>
      queryClient.invalidateQueries({ queryKey: ['products'] }),
    invalidateProcedureTypes: () =>
      queryClient.invalidateQueries({ queryKey: ['procedure-types'] }),
    invalidateEvaluation: () =>
      queryClient.invalidateQueries({ queryKey: ['evaluation'] }),
    invalidateTenant: () =>
      queryClient.invalidateQueries({ queryKey: ['tenant'] }),
    invalidateAudit: () =>
      queryClient.invalidateQueries({ queryKey: ['audit'] }),
    invalidateAll: () =>
      queryClient.invalidateQueries(),
  }
}

// Centralized query keys for React Query cache management
export const queryKeys = {
  dashboard: ['dashboard'] as const,
  patients: {
    all: ['patients'] as const,
    list: (search: string, page: number) => ['patients', 'list', search, page] as const,
    detail: (id: string) => ['patients', 'detail', id] as const,
  },
  appointments: {
    all: ['appointments'] as const,
    list: (practitionerId: string | undefined, dateFrom: string, dateTo: string) =>
      ['appointments', 'list', practitionerId, dateFrom, dateTo] as const,
    practitioners: ['appointments', 'practitioners'] as const,
    procedureTypes: ['appointments', 'procedureTypes'] as const,
  },
  financial: {
    all: ['financial'] as const,
    entries: (filters?: Record<string, unknown>) => ['financial', 'entries', filters] as const,
    revenue: (dateFrom: string, dateTo: string, practitionerId?: string) =>
      ['financial', 'revenue', dateFrom, dateTo, practitionerId] as const,
    patients: ['financial', 'patients'] as const,
  },
  settings: {
    all: ['settings'] as const,
    tenant: ['settings', 'tenant'] as const,
    procedureTypes: ['settings', 'procedureTypes'] as const,
    products: ['settings', 'products'] as const,
    members: ['settings', 'members'] as const,
    consentTemplates: ['settings', 'consentTemplates'] as const,
    evaluationTemplates: (procedureTypeIds: string[]) =>
      ['settings', 'evaluationTemplates', procedureTypeIds] as const,
  },
  anamnesis: (patientId: string) => ['anamnesis', patientId] as const,
  procedures: {
    all: ['procedures'] as const,
    list: (patientId: string) => ['procedures', 'list', patientId] as const,
    detail: (id: string) => ['procedures', 'detail', id] as const,
    latestNonExecuted: (patientId: string) =>
      ['procedures', 'latestNonExecuted', patientId] as const,
  },
} as const

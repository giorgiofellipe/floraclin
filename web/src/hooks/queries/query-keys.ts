// Centralized query keys for React Query cache management
export const queryKeys = {
  dashboard: ['dashboard'] as const,
  patients: {
    all: ['patients'] as const,
    list: (search: string, page: number) => ['patients', 'list', search, page] as const,
    detail: (id: string) => ['patients', 'detail', id] as const,
    timeline: (id: string) => ['patients', 'timeline', id] as const,
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
    detail: (id: string) => ['financial', 'detail', id] as const,
    revenue: (dateFrom: string, dateTo: string, practitionerId?: string) =>
      ['financial', 'revenue', dateFrom, dateTo, practitionerId] as const,
    patients: ['financial', 'patients'] as const,
    settings: ['financial', 'settings'] as const,
    categories: ['financial', 'categories'] as const,
    ledger: (filters?: Record<string, unknown>) => ['financial', 'ledger', filters] as const,
    practitionerPL: (dateFrom: string, dateTo: string, practitionerId?: string) =>
      ['financial', 'practitioner-pl', dateFrom, dateTo, practitionerId] as const,
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
  consent: {
    all: ['consent'] as const,
    templates: ['consent', 'templates'] as const,
    history: (patientId: string) => ['consent', 'history', patientId] as const,
  },
  evaluation: {
    all: ['evaluation'] as const,
    templates: (typeIds: string[]) => ['evaluation', 'templates', typeIds] as const,
    responses: (procedureId: string) => ['evaluation', 'responses', procedureId] as const,
  },
  products: {
    all: ['products'] as const,
    list: (filter?: string) => ['products', 'list', filter] as const,
  },
  procedureTypes: ['procedure-types'] as const,
  tenant: {
    all: ['tenant'] as const,
    detail: ['tenant', 'detail'] as const,
    users: ['tenant', 'users'] as const,
  },
  expenses: {
    all: ['expenses'] as const,
    list: (filters?: Record<string, unknown>) => ['expenses', 'list', filters] as const,
    detail: (id: string) => ['expenses', 'detail', id] as const,
    categories: ['expenses', 'categories'] as const,
  },
  audit: {
    all: ['audit'] as const,
    logs: (filters?: Record<string, unknown>) => ['audit', 'logs', filters] as const,
  },
  admin: {
    tenants: {
      all: ['admin', 'tenants'] as const,
      list: (search: string, page: number) => ['admin', 'tenants', 'list', search, page] as const,
      detail: (id: string) => ['admin', 'tenants', 'detail', id] as const,
    },
    users: {
      all: ['admin', 'users'] as const,
      list: (search: string, page: number) => ['admin', 'users', 'list', search, page] as const,
      detail: (id: string) => ['admin', 'users', 'detail', id] as const,
    },
  },
} as const

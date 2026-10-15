import { queryOptions } from '@tanstack/react-query'

export interface EncounterViewDiagramPoint {
  id?: string
  x: string | number
  y: string | number
  productName: string
  activeIngredient?: string | null
  quantity: string | number
  quantityUnit: string
  technique?: string | null
  depth?: string | null
  notes?: string | null
  sortOrder?: number
}

export interface EncounterViewDiagram {
  id?: string
  viewType: string
  points: EncounterViewDiagramPoint[]
}

export interface EncounterViewProductApplication {
  id?: string
  productName: string
  activeIngredient?: string | null
  totalQuantity: string | number
  quantityUnit: string
  batchNumber?: string | null
  expirationDate?: string | null
  applicationAreas?: string | null
  notes?: string | null
}

export interface EncounterViewSession {
  id: string
  sessionOrdinal: number
  performedAt: string
  executedByName: string
  technique?: string | null
  clinicalResponse?: string | null
  adverseEffects?: string | null
  notes?: string | null
  followUpDate?: string | null
  nextSessionObjectives?: string | null
  diagrams?: EncounterViewDiagram[]
  productApplications?: EncounterViewProductApplication[]
}

export interface EncounterViewRecord {
  id: string
  procedureTypeName: string
  sessionsTotal: number
  sessions: EncounterViewSession[]
}

export interface EncounterViewPackage {
  id: string
  name: string
  expiresAt: string | null
  status: string
  closedAt: string | null
  closedReason: string | null
}

export interface EncounterView {
  records: EncounterViewRecord[]
  package: EncounterViewPackage | null
}

// GET /api/encounters/[id] answers 404 when the encounter has no procedure records yet.
export class EncounterViewNotFoundError extends Error {
  constructor() {
    super('Encounter view: no procedure records')
  }
}

const MAX_RETRIES = 3

export function encounterViewQueryOptions(encounterId: string) {
  return queryOptions({
    queryKey: ['encounter-view', encounterId],
    queryFn: async (): Promise<EncounterView> => {
      const res = await fetch(`/api/encounters/${encounterId}`)
      if (res.status === 404) throw new EncounterViewNotFoundError()
      if (!res.ok) throw new Error(`Encounter view: HTTP ${res.status}`)
      const { data: view }: { data?: EncounterView } = await res.json()
      if (!view || !Array.isArray(view.records)) {
        throw new Error('Encounter view: unexpected response shape')
      }
      return view
    },
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) =>
      !(error instanceof EncounterViewNotFoundError) && failureCount < MAX_RETRIES,
  })
}

export function isClosedPackage(pkg: EncounterViewPackage | null): boolean {
  return Boolean(pkg && (pkg.status === 'completed' || pkg.closedAt))
}

export function countPendingSessions(view: EncounterView): number {
  if (isClosedPackage(view.package)) return 0
  return view.records.reduce(
    (sum, r) => sum + Math.max(0, r.sessionsTotal - r.sessions.length),
    0,
  )
}

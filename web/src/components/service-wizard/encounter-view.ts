export type EncounterPickerSlice = {
  records: Array<{ id: string; sessionsTotal: number; sessions: Array<{ id: string }> }>
  package: { status: string; closedAt: string | null } | null
}

type EncounterPickerResponse = {
  data?: unknown
}

export function parseEncounterPickerSlice(json: unknown): EncounterPickerSlice {
  const view =
    json && typeof json === 'object' && 'data' in json && (json as EncounterPickerResponse).data
      ? (json as EncounterPickerResponse).data
      : json

  if (!view || typeof view !== 'object' || !Array.isArray((view as EncounterPickerSlice).records)) {
    throw new Error('Encounter view: unexpected response shape')
  }

  return view as EncounterPickerSlice
}

export function countPendingSessions(encounterView: EncounterPickerSlice | undefined): number {
  if (!encounterView) return 0

  const isPkgTerminal = Boolean(
    encounterView.package &&
      (encounterView.package.status === 'completed' || encounterView.package.closedAt),
  )
  // A closed/cancelled package means the user intentionally stopped — no
  // pending sessions remain from the wizard's perspective.
  if (isPkgTerminal) return 0

  const records = Array.isArray(encounterView.records) ? encounterView.records : []
  return records.reduce(
    (sum, r) => sum + Math.max(0, r.sessionsTotal - r.sessions.length),
    0,
  )
}

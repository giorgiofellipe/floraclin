'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'

import { SessionPicker } from './session-picker'
import { SessionExecutionForm } from './session-execution-form'

// ─── Props ──────────────────────────────────────────────────────────

export interface ProcedureExecutionProps {
  encounterId: string
  procedureRecordIds: string[]
  patientId: string
  patientGender?: string | null
  packageId: string | null
  deepLinkProcedureId?: string | null
  autoStartNext?: boolean
  // Legacy props from the wizard (F2 passes them along during transition).
  // Accepted but not used by the orchestrator — they remain in the type
  // surface so the wizard can keep its existing call shape until F2 drops them.
  procedure?: unknown
  diagrams?: unknown
  existingApplications?: unknown
  wizardOverrides?: unknown
}

// ─── Mode ───────────────────────────────────────────────────────────

type Mode =
  | { kind: 'picker' }
  | { kind: 'execute'; recordId: string; ordinal: number }
  | { kind: 'view'; sessionId: string }

// ─── Read-only view ─────────────────────────────────────────────────

interface EncounterViewDiagramPoint {
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

interface EncounterViewDiagram {
  id?: string
  viewType: string
  points: EncounterViewDiagramPoint[]
}

interface EncounterViewProductApplication {
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

interface EncounterViewSession {
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

interface EncounterViewRecord {
  id: string
  procedureTypeName: string
  sessions: EncounterViewSession[]
}

interface EncounterView {
  records: EncounterViewRecord[]
}

interface EncounterViewResponse {
  success?: boolean
  data?: EncounterView
}

async function fetchEncounterView(encounterId: string): Promise<EncounterView> {
  const res = await fetch(`/api/encounters/${encounterId}`)
  const json: EncounterViewResponse | EncounterView = await res.json()
  const view =
    json && typeof json === 'object' && 'data' in json && json.data
      ? (json as EncounterViewResponse).data
      : (json as EncounterView)
  if (!view || !Array.isArray(view.records)) {
    throw new Error('Encounter view: unexpected response shape')
  }
  return view
}

function SessionReadOnly({
  sessionId,
  encounterId,
  onBack,
}: {
  sessionId: string
  encounterId: string
  onBack: () => void
}) {
  const { data } = useQuery<EncounterView>({
    queryKey: ['encounter-view', encounterId],
    queryFn: () => fetchEncounterView(encounterId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  if (!data) return <div>Carregando…</div>

  let session: EncounterViewSession | null = null
  let recordName: string | null = null
  for (const r of data.records) {
    const found = r.sessions.find((s) => s.id === sessionId)
    if (found) {
      session = found
      recordName = r.procedureTypeName
      break
    }
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={onBack}>
          ← Voltar
        </Button>
        <div className="text-sm text-muted-foreground">Sessão não encontrada.</div>
      </div>
    )
  }

  const diagramPointCount = (session.diagrams ?? []).reduce(
    (sum, d) => sum + (d.points?.length ?? 0),
    0,
  )
  const productCount = session.productApplications?.length ?? 0

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        ← Voltar
      </Button>
      <div className="space-y-1">
        {recordName && <h3 className="font-medium">{recordName}</h3>}
        <p className="text-sm text-muted-foreground">Sessão #{session.sessionOrdinal}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt className="text-muted-foreground">Realizada em</dt>
        <dd>{formatDate(session.performedAt)}</dd>
        <dt className="text-muted-foreground">Por</dt>
        <dd>{session.executedByName}</dd>
        {session.technique && (
          <>
            <dt className="text-muted-foreground">Técnica</dt>
            <dd className="whitespace-pre-wrap">{session.technique}</dd>
          </>
        )}
        {session.clinicalResponse && (
          <>
            <dt className="text-muted-foreground">Resposta clínica</dt>
            <dd className="whitespace-pre-wrap">{session.clinicalResponse}</dd>
          </>
        )}
        {session.adverseEffects && (
          <>
            <dt className="text-muted-foreground">Efeitos adversos</dt>
            <dd className="whitespace-pre-wrap">{session.adverseEffects}</dd>
          </>
        )}
        {session.notes && (
          <>
            <dt className="text-muted-foreground">Observações</dt>
            <dd className="whitespace-pre-wrap">{session.notes}</dd>
          </>
        )}
        {session.followUpDate && (
          <>
            <dt className="text-muted-foreground">Retorno em</dt>
            <dd>{formatDate(session.followUpDate)}</dd>
          </>
        )}
        {session.nextSessionObjectives && (
          <>
            <dt className="text-muted-foreground">Objetivos da próxima sessão</dt>
            <dd className="whitespace-pre-wrap">{session.nextSessionObjectives}</dd>
          </>
        )}
        {diagramPointCount > 0 && (
          <>
            <dt className="text-muted-foreground">Pontos no diagrama</dt>
            <dd>{diagramPointCount}</dd>
          </>
        )}
        {productCount > 0 && (
          <>
            <dt className="text-muted-foreground">Produtos aplicados</dt>
            <dd>
              {(session.productApplications ?? []).map((a, i) => (
                <div key={a.id ?? i}>
                  {a.productName} — {String(a.totalQuantity)} {a.quantityUnit}
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">Visualização somente leitura.</p>
    </div>
  )
}

// ─── Orchestrator ───────────────────────────────────────────────────

export function ProcedureExecution({
  encounterId,
  procedureRecordIds: _procedureRecordIds,
  patientId,
  patientGender,
  packageId,
  deepLinkProcedureId,
  autoStartNext,
}: ProcedureExecutionProps) {
  const qc = useQueryClient()

  const [mode, setMode] = useState<Mode>(() => {
    if (deepLinkProcedureId && autoStartNext) {
      return { kind: 'execute', recordId: deepLinkProcedureId, ordinal: 0 }
    }
    return { kind: 'picker' }
  })

  // Ensure the encounter view is in the React Query cache before we mount
  // the form in execute mode — the deep-link entry path renders the form
  // immediately, before the picker has had a chance to populate the cache.
  // For non-deep-link paths the picker's `useQuery` will populate this same
  // key, so we de-dupe automatically.
  const { data: encounterView } = useQuery<EncounterView>({
    queryKey: ['encounter-view', encounterId],
    queryFn: () => fetchEncounterView(encounterId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['encounter-view', encounterId] })

  if (mode.kind === 'execute') {
    // Derive prefill from the highest-ordinal already-executed session of the
    // active procedure record. If no executed session yet (ordinal 1 of this
    // record) or the cache isn't populated yet, we render the form with no
    // prefill — the spec only requires prefill from a previous session.
    let prefill:
      | {
          diagrams: EncounterViewDiagram[]
          productApplications: EncounterViewProductApplication[]
        }
      | null = null

    if (encounterView) {
      const rec = encounterView.records.find((r) => r.id === mode.recordId)
      if (rec && rec.sessions.length > 0) {
        const lastExecuted = rec.sessions.reduce(
          (acc, s) => (s.sessionOrdinal > (acc?.sessionOrdinal ?? -1) ? s : acc),
          null as EncounterViewSession | null,
        )
        if (lastExecuted) {
          prefill = {
            diagrams: lastExecuted.diagrams ?? [],
            productApplications: lastExecuted.productApplications ?? [],
          }
        }
      }
    }

    // While the view query is still pending on the deep-link path, hold off
    // mounting the form so prefill can land in the initial defaultValues.
    if (!encounterView) {
      return <div>Carregando…</div>
    }

    return (
      <SessionExecutionForm
        procedureRecordId={mode.recordId}
        patientId={patientId}
        patientGender={patientGender}
        prefillFromPreviousSession={prefill}
        onSaved={async () => {
          await invalidate()
          setMode({ kind: 'picker' })
        }}
        onCancel={() => setMode({ kind: 'picker' })}
      />
    )
  }

  if (mode.kind === 'view') {
    return (
      <SessionReadOnly
        sessionId={mode.sessionId}
        encounterId={encounterId}
        onBack={() => setMode({ kind: 'picker' })}
      />
    )
  }

  return (
    <SessionPicker
      encounterId={encounterId}
      procedureRecordIds={_procedureRecordIds}
      packageId={packageId}
      onPickPending={(recordId, ordinal) =>
        setMode({ kind: 'execute', recordId, ordinal })
      }
      onPickExecuted={(sessionId) => setMode({ kind: 'view', sessionId })}
    />
  )
}

'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'

import {
  encounterViewQueryOptions,
  type EncounterViewDiagram,
  type EncounterViewProductApplication,
  type EncounterViewSession,
} from './encounter-view'
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

function SessionReadOnly({
  sessionId,
  encounterId,
  onBack,
}: {
  sessionId: string
  encounterId: string
  onBack: () => void
}) {
  const { data } = useQuery(encounterViewQueryOptions(encounterId))

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
  const { data: encounterView } = useQuery(encounterViewQueryOptions(encounterId))

  // Planned diagrams from the procedure record (step 3 planning) — used as
  // the diagram prefill for the FIRST session, which has no previous
  // session to inherit from.
  const executeRecordId = mode.kind === 'execute' ? mode.recordId : null
  const { data: plannedRecord, isPending: plannedPending } = useQuery<{ diagrams?: EncounterViewDiagram[] }>({
    queryKey: ['procedure-planned', executeRecordId],
    queryFn: async () => {
      const res = await fetch(`/api/procedures/${executeRecordId}`)
      if (!res.ok) throw new Error('Falha ao carregar planejamento')
      return res.json()
    },
    enabled: !!executeRecordId,
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

    // First session: fall back to the planned diagram from step 3 so the
    // clinician sees (and can adjust) what was planned. Product quantities
    // auto-derive from diagram points inside the form.
    if (!prefill && plannedRecord?.diagrams?.length) {
      prefill = { diagrams: plannedRecord.diagrams, productApplications: [] }
    }

    // Hold off mounting the form until both queries settle — defaultValues
    // capture prefill once at mount, so a late-arriving planned diagram
    // would otherwise be silently dropped. (isPending is false on query
    // error, so a failed planned fetch degrades to no prefill, not a hang.)
    if (!encounterView || plannedPending) {
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

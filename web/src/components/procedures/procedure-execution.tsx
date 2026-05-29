'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'

import { SessionPicker } from './session-picker'
import { SessionExecutionForm } from './session-execution-form'

// ─── Props ──────────────────────────────────────────────────────────

export interface ProcedureExecutionProps {
  atendimentoId: string
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

interface AtendimentoViewDiagramPoint {
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

interface AtendimentoViewDiagram {
  id?: string
  viewType: string
  points: AtendimentoViewDiagramPoint[]
}

interface AtendimentoViewProductApplication {
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

interface AtendimentoViewSession {
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
  diagrams?: AtendimentoViewDiagram[]
  productApplications?: AtendimentoViewProductApplication[]
}

interface AtendimentoViewRecord {
  id: string
  procedureTypeName: string
  sessions: AtendimentoViewSession[]
}

interface AtendimentoView {
  records: AtendimentoViewRecord[]
}

interface AtendimentoViewResponse {
  success?: boolean
  data?: AtendimentoView
}

async function fetchAtendimentoView(atendimentoId: string): Promise<AtendimentoView> {
  const res = await fetch(`/api/atendimentos/${atendimentoId}`)
  const json: AtendimentoViewResponse | AtendimentoView = await res.json()
  const view =
    json && typeof json === 'object' && 'data' in json && json.data
      ? (json as AtendimentoViewResponse).data
      : (json as AtendimentoView)
  if (!view || !Array.isArray(view.records)) {
    throw new Error('Atendimento view: unexpected response shape')
  }
  return view
}

function SessionReadOnly({
  sessionId,
  atendimentoId,
  onBack,
}: {
  sessionId: string
  atendimentoId: string
  onBack: () => void
}) {
  const { data } = useQuery<AtendimentoView>({
    queryKey: ['atendimento-view', atendimentoId],
    queryFn: () => fetchAtendimentoView(atendimentoId),
  })

  if (!data) return <div>Carregando…</div>

  let session: AtendimentoViewSession | null = null
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
  atendimentoId,
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

  // Ensure the atendimento view is in the React Query cache before we mount
  // the form in execute mode — the deep-link entry path renders the form
  // immediately, before the picker has had a chance to populate the cache.
  // For non-deep-link paths the picker's `useQuery` will populate this same
  // key, so we de-dupe automatically.
  const { data: atendimentoView } = useQuery<AtendimentoView>({
    queryKey: ['atendimento-view', atendimentoId],
    queryFn: () => fetchAtendimentoView(atendimentoId),
  })

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['atendimento-view', atendimentoId] })

  if (mode.kind === 'execute') {
    // Derive prefill from the highest-ordinal already-executed session of the
    // active procedure record. If no executed session yet (ordinal 1 of this
    // record) or the cache isn't populated yet, we render the form with no
    // prefill — the spec only requires prefill from a previous session.
    let prefill:
      | {
          diagrams: AtendimentoViewDiagram[]
          productApplications: AtendimentoViewProductApplication[]
        }
      | null = null

    if (atendimentoView) {
      const rec = atendimentoView.records.find((r) => r.id === mode.recordId)
      if (rec && rec.sessions.length > 0) {
        const lastExecuted = rec.sessions.reduce(
          (acc, s) => (s.sessionOrdinal > (acc?.sessionOrdinal ?? -1) ? s : acc),
          null as AtendimentoViewSession | null,
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
    if (!atendimentoView) {
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
        atendimentoId={atendimentoId}
        onBack={() => setMode({ kind: 'picker' })}
      />
    )
  }

  return (
    <SessionPicker
      atendimentoId={atendimentoId}
      procedureRecordIds={_procedureRecordIds}
      packageId={packageId}
      onPickPending={(recordId, ordinal) =>
        setMode({ kind: 'execute', recordId, ordinal })
      }
      onPickExecuted={(sessionId) => setMode({ kind: 'view', sessionId })}
    />
  )
}

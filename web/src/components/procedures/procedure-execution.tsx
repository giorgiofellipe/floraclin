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

interface AtendimentoViewSession {
  id: string
  sessionOrdinal: number
  performedAt: string
  executedByName: string
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
    queryFn: async () => {
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
    },
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
  patientGender: _patientGender,
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

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['atendimento-view', atendimentoId] })

  if (mode.kind === 'execute') {
    return (
      <SessionExecutionForm
        procedureRecordId={mode.recordId}
        patientId={patientId}
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

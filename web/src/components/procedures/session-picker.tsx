'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ClosePackageDialog } from '@/components/packages/close-package-dialog'
import { brToday } from '@/lib/dates'
import { cn, formatDate } from '@/lib/utils'

interface SessionPickerProps {
  encounterId: string
  procedureRecordIds: string[]
  packageId: string | null
  onPickPending: (recordId: string, ordinal: number) => void
  onPickExecuted: (sessionId: string) => void
}

interface EncounterViewSession {
  id: string
  sessionOrdinal: number
  performedAt: string
  executedByName: string
  // Optional richer payload from /api/encounters/[id] — the picker doesn't
  // surface these directly, but typing them keeps the cached query payload
  // shape honest for downstream consumers (the orchestrator reads diagrams +
  // productApplications for prefill, and the read-only view renders them).
  technique?: string | null
  clinicalResponse?: string | null
  adverseEffects?: string | null
  notes?: string | null
  followUpDate?: string | null
  nextSessionObjectives?: string | null
  diagrams?: unknown
  productApplications?: unknown
}

interface EncounterViewRecord {
  id: string
  procedureTypeName: string
  sessionsTotal: number
  sessions: EncounterViewSession[]
}

interface EncounterViewPackage {
  id: string
  name: string
  expiresAt: string | null
  status: string
  closedAt: string | null
  closedReason: string | null
}

interface EncounterView {
  records: EncounterViewRecord[]
  package: EncounterViewPackage | null
}

interface EncounterViewResponse {
  success?: boolean
  data?: EncounterView
}

export function SessionPicker({
  encounterId,
  packageId: _packageId,
  onPickPending,
  onPickExecuted,
}: SessionPickerProps) {
  const { data, isLoading } = useQuery<EncounterView>({
    queryKey: ['encounter-view', encounterId],
    queryFn: async () => {
      const res = await fetch(`/api/encounters/${encounterId}`)
      const json: EncounterViewResponse | EncounterView = await res.json()
      // Defensive: accept either { success, data: {...} } or the bare view object.
      const view =
        json && typeof json === 'object' && 'data' in json && json.data
          ? (json as EncounterViewResponse).data
          : (json as EncounterView)
      if (!view || !Array.isArray(view.records)) {
        throw new Error('Encounter view: unexpected response shape')
      }
      return view
    },
  })

  // Package expiry is a YYYY-MM-DD calendar day; compare against BR today as strings.
  const expiredAt = useMemo(() => {
    const ymd = data?.package?.expiresAt
    if (!ymd) return null
    return ymd < brToday() ? ymd : null
  }, [data?.package?.expiresAt])

  const [closeDialogOpen, setCloseDialogOpen] = useState(false)

  if (isLoading || !data) return <div>Carregando…</div>

  const isPackageClosed = Boolean(
    data.package && (data.package.status === 'completed' || data.package.closedAt),
  )
  const canCloseFromPicker = Boolean(data.package?.id) && !isPackageClosed

  return (
    <div className="space-y-6">
      {canCloseFromPicker && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCloseDialogOpen(true)}
          >
            Encerrar pacote
          </Button>
        </div>
      )}
      {expiredAt && !isPackageClosed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Pacote vencido em {formatDate(expiredAt)}. Você pode continuar executando as sessões
          restantes ou encerrar o pacote.
        </div>
      )}
      {data.records.map((rec) => (
        <section key={rec.id} className="space-y-2">
          <h3 className="font-medium">
            {rec.procedureTypeName} — {rec.sessionsTotal}{' '}
            {rec.sessionsTotal === 1 ? 'sessão' : 'sessões'}
          </h3>
          <ol className="space-y-1">
            {Array.from({ length: rec.sessionsTotal }, (_, i) => i + 1).map((ord) => {
              const exec = rec.sessions.find((s) => s.sessionOrdinal === ord) ?? null
              const isExecuted = exec !== null
              const nextPendingOrd = rec.sessions.length + 1
              const isNext = !isExecuted && ord === nextPendingOrd
              return (
                <li
                  key={ord}
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1',
                    isNext && 'bg-primary/5',
                  )}
                >
                  <span className="w-6 text-sm text-muted-foreground">{ord}</span>
                  {isExecuted && exec ? (
                    <>
                      <Check className="size-4 text-emerald-600" />
                      <button
                        type="button"
                        className="text-sm text-left flex-1 underline-offset-2 hover:underline"
                        onClick={() => onPickExecuted(exec.id)}
                      >
                        Realizada em {formatDate(exec.performedAt)} por {exec.executedByName}
                      </button>
                    </>
                  ) : isNext && !isPackageClosed ? (
                    <Button size="sm" onClick={() => onPickPending(rec.id, ord)}>
                      Executar agora
                    </Button>
                  ) : (
                    <span
                      className="text-sm text-muted-foreground"
                      title={
                        isPackageClosed
                          ? 'Pacote encerrado'
                          : 'Conclua a sessão anterior primeiro'
                      }
                    >
                      Pendente
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {data.package?.id && (
        <ClosePackageDialog
          open={closeDialogOpen}
          onOpenChange={setCloseDialogOpen}
          packageId={data.package.id}
        />
      )}
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'

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

// Visual constants — tweaking these adjusts the entire picker rhythm.
const STATUS_NODE_SIZE = 'size-8' // ordinal node diameter
const STATUS_NODE_RING = 'ring-[3px]' // halo around the "next" node

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

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-3 py-12 text-sm text-mid">
        <span className="size-2 animate-pulse rounded-full bg-sage" aria-hidden />
        Carregando sessões…
      </div>
    )
  }

  const isPackageClosed = Boolean(
    data.package && (data.package.status === 'completed' || data.package.closedAt),
  )
  const canCloseFromPicker = Boolean(data.package?.id) && !isPackageClosed

  return (
    <div className="space-y-5">
      {/* ── Banners ───────────────────────────────────────────── */}

      {isPackageClosed && data.package && (
        <div className="rounded-[3px] border border-sage/20 bg-cream/40 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-sage">
            Pacote encerrado
          </p>
          {data.package.closedAt && (
            <p className="mt-1 text-sm text-charcoal">
              Em {formatDate(data.package.closedAt)}
              {data.package.closedReason && <span className="text-mid"> · {data.package.closedReason}</span>}
            </p>
          )}
        </div>
      )}

      {expiredAt && !isPackageClosed && (
        <div className="rounded-[3px] border border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-amber-700">
            Pacote vencido
          </p>
          <p className="mt-1 text-sm text-charcoal">
            Em {formatDate(expiredAt)}.{' '}
            <span className="text-mid">
              Você pode continuar executando as sessões restantes ou encerrar o pacote.
            </span>
          </p>
        </div>
      )}

      {/* ── Top action row ────────────────────────────────────── */}

      {canCloseFromPicker && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCloseDialogOpen(true)}
            className="text-[11px] uppercase tracking-wider text-mid transition-colors hover:text-charcoal"
          >
            Encerrar pacote
          </button>
        </div>
      )}

      {/* ── Records ───────────────────────────────────────────── */}

      <div className="space-y-4">
        {data.records.map((rec) => {
          const executedCount = rec.sessions.length
          const nextPendingOrd = executedCount + 1
          const isLineDone = executedCount >= rec.sessionsTotal

          return (
            <article
              key={rec.id}
              className={cn(
                'overflow-hidden rounded-[3px] border bg-white transition-colors',
                isLineDone
                  ? 'border-sage/15'
                  : isPackageClosed
                    ? 'border-sage/10'
                    : 'border-sage/25',
              )}
            >
              {/* Header */}
              <header className="border-b border-sage/10 px-3 sm:px-5 pt-4 pb-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-heading text-base text-charcoal">
                    {rec.procedureTypeName}
                  </h3>
                  <SessionsBadge done={executedCount} total={rec.sessionsTotal} />
                </div>

                {rec.sessionsTotal > 1 && (
                  <div
                    className="mt-3 flex items-center gap-1"
                    role="img"
                    aria-label={`Progresso: ${executedCount} de ${rec.sessionsTotal} sessões`}
                  >
                    {Array.from({ length: rec.sessionsTotal }, (_, i) => i + 1).map((ord) => {
                      const isExec = rec.sessions.some((s) => s.sessionOrdinal === ord)
                      const isNxt =
                        !isExec && ord === nextPendingOrd && !isPackageClosed
                      return (
                        <span
                          key={ord}
                          className={cn(
                            'h-1.5 flex-1 rounded-full transition-colors duration-300',
                            isExec
                              ? 'bg-forest'
                              : isNxt
                                ? 'bg-sage/55'
                                : 'bg-sage/15',
                          )}
                        />
                      )
                    })}
                  </div>
                )}
              </header>

              {/* Sessions */}
              <ol className="divide-y divide-sage/8">
                {Array.from({ length: rec.sessionsTotal }, (_, i) => i + 1).map((ord) => {
                  const exec = rec.sessions.find((s) => s.sessionOrdinal === ord) ?? null
                  const isExecuted = exec !== null
                  const isNext = !isExecuted && ord === nextPendingOrd

                  return (
                    <li
                      key={ord}
                      className={cn(
                        'group relative flex flex-wrap items-center gap-2 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4 transition-colors',
                        isNext && !isPackageClosed
                          ? 'bg-gradient-to-r from-sage/[0.06] via-transparent to-transparent'
                          : null,
                      )}
                    >
                      {/* ── Status node ── */}
                      <div className="flex shrink-0 items-center justify-center">
                        {isExecuted ? (
                          <div
                            className={cn(
                              STATUS_NODE_SIZE,
                              'flex items-center justify-center rounded-full bg-forest text-cream shadow-[0_1px_2px_rgba(0,0,0,0.08)]',
                            )}
                          >
                            <Check className="size-4" strokeWidth={2.5} />
                          </div>
                        ) : isNext && !isPackageClosed ? (
                          <div
                            className={cn(
                              STATUS_NODE_SIZE,
                              STATUS_NODE_RING,
                              'flex items-center justify-center rounded-full border-2 border-sage bg-cream ring-sage/15',
                            )}
                          >
                            <span className="text-[12px] font-medium tabular-nums text-forest">
                              {ord}
                            </span>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              STATUS_NODE_SIZE,
                              'flex items-center justify-center rounded-full border border-dashed border-sage/35 bg-white',
                            )}
                          >
                            <span className="text-[12px] font-medium tabular-nums text-mid/70">
                              {ord}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* ── Content ── */}
                      <div className="min-w-0 flex-1">
                        {isExecuted && exec ? (
                          <button
                            type="button"
                            onClick={() => onPickExecuted(exec.id)}
                            className="w-full rounded-[3px] text-left transition-colors hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage/40"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sage">
                                Sessão {ord}
                              </span>
                              <span className="h-px flex-1 bg-sage/15" aria-hidden />
                            </div>
                            <div className="mt-1.5 flex items-baseline gap-2 text-sm">
                              <span className="font-medium text-charcoal">
                                {formatDate(exec.performedAt)}
                              </span>
                              <span className="text-mid">por {exec.executedByName}</span>
                            </div>
                          </button>
                        ) : isNext && !isPackageClosed ? (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="size-3 text-forest" />
                              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-forest">
                                Próxima sessão
                              </span>
                            </div>
                            <div className="mt-1 text-sm text-charcoal">
                              Sessão {ord}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-mid/70">
                              Sessão {ord}
                            </div>
                            <div className="mt-1.5 text-sm text-mid">
                              {isPackageClosed
                                ? 'Pacote encerrado'
                                : 'Aguardando sessão anterior'}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Action ── */}
                      {isNext && !isPackageClosed && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onPickPending(rec.id, ord)}
                          className="w-full sm:w-auto shrink-0"
                        >
                          Executar agora
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ol>

              {/* Footer for fully-completed line */}
              {isLineDone && (
                <footer className="border-t border-sage/10 bg-sage/[0.04] px-5 py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-sage">
                    Todas as sessões concluídas
                  </p>
                </footer>
              )}
            </article>
          )
        })}
      </div>

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

// ── Header badge: x of y sessões ─────────────────────────────
function SessionsBadge({ done, total }: { done: number; total: number }) {
  const isComplete = done >= total
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 rounded-full border px-2.5 py-0.5 text-[11px] tabular-nums',
        isComplete
          ? 'border-forest/20 bg-forest/[0.04] text-forest'
          : 'border-sage/20 bg-cream/40 text-charcoal',
      )}
    >
      <span className="font-medium">{done}</span>
      <span className="text-mid">/</span>
      <span>{total}</span>
      <span className="ml-1 text-[10px] uppercase tracking-wider text-mid">
        {total === 1 ? 'sessão' : 'sessões'}
      </span>
    </span>
  )
}

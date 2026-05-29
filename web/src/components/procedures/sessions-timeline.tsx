'use client'

import Link from 'next/link'

import { cn, formatDate } from '@/lib/utils'

// Each session occupies one column. The bar segment sits at the top of
// the column; the date + executor name stack directly underneath the
// segment so the metadata reads against its own slot rather than as a
// detached list. Step 5's <SessionPicker> has its own bespoke rendering
// — this component is intentionally a separate UI for the
// procedimentos + pacotes tabs.
const SEGMENT_HEIGHT = 'h-1.5'

export interface SessionsTimelineSession {
  /** 1-indexed ordinal within the procedure_record. */
  sessionOrdinal: number
  /** ISO-ish timestamp returned by the server (Date|string both fine). */
  performedAt: string | Date
  executedByName: string
}

interface SessionsTimelineProps {
  sessionsTotal: number
  sessionsExecuted: number
  sessions: SessionsTimelineSession[]
  /**
   * Optional href for each executed column. When set, the entire column
   * (segment + date + executor) becomes clickable, taking the user to
   * the procedure detail page where the full session history lives.
   */
  procedureDetailHref?: string | null
}

export function SessionsTimeline({
  sessionsTotal,
  sessionsExecuted,
  sessions,
  procedureDetailHref,
}: SessionsTimelineProps) {
  if (sessionsTotal <= 0) return null

  // Map ordinal → session so each column knows whether it was executed.
  const execByOrdinal = new Map<number, SessionsTimelineSession>()
  for (const s of sessions) execByOrdinal.set(s.sessionOrdinal, s)
  const nextOrdinal = sessionsExecuted + 1

  return (
    <div
      className="flex items-stretch gap-1"
      role="img"
      aria-label={`Progresso: ${sessionsExecuted} de ${sessionsTotal} sessões`}
    >
      {Array.from({ length: sessionsTotal }, (_, i) => i + 1).map((ord) => {
        const exec = execByOrdinal.get(ord)
        const isDone = !!exec
        const isNext = !isDone && ord === nextOrdinal
        const segClass = cn(
          SEGMENT_HEIGHT,
          'w-full rounded-full transition-colors duration-300',
          isDone && 'bg-forest',
          !isDone && isNext && 'bg-sage/55',
          !isDone && !isNext && 'bg-sage/15',
        )
        const tooltip = isDone
          ? `Sessão ${ord} · ${formatDate(exec!.performedAt)} · ${exec!.executedByName}`
          : isNext
            ? `Sessão ${ord} · próxima`
            : `Sessão ${ord} · pendente`

        // Column content: segment on top, metadata below. Executed columns
        // show date + executor; non-executed show a tiny eyebrow ("Próxima"
        // or "Sessão N") so columns stay vertically aligned across rows.
        const column = (
          <div className="flex flex-col items-stretch gap-1.5 min-w-0">
            <span className={segClass} title={tooltip} aria-hidden />
            {isDone ? (
              <div className="text-[10px] tabular-nums leading-tight">
                <div className="text-charcoal truncate" title={formatDate(exec!.performedAt)}>
                  {formatDate(exec!.performedAt)}
                </div>
                <div className="text-mid truncate" title={exec!.executedByName}>
                  {exec!.executedByName}
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'text-[10px] uppercase tracking-wider leading-tight truncate',
                  isNext ? 'text-sage' : 'text-mid/50',
                )}
                title={tooltip}
              >
                {isNext ? 'Próxima' : `Sessão ${ord}`}
              </div>
            )}
          </div>
        )

        // Make executed columns clickable; non-executed stay inert
        // (nothing to detail yet — and a "future" link would be misleading).
        if (isDone && procedureDetailHref) {
          return (
            <Link
              key={ord}
              href={procedureDetailHref}
              aria-label={`Ver detalhes da sessão ${ord} · ${formatDate(exec!.performedAt)} · ${exec!.executedByName}`}
              className={cn(
                'flex-1 min-w-0 rounded-md transition-colors',
                '-m-1 p-1 hover:bg-cream/40',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40',
              )}
            >
              {column}
            </Link>
          )
        }
        return (
          <div key={ord} className="flex-1 min-w-0 -m-1 p-1">
            {column}
          </div>
        )
      })}
    </div>
  )
}

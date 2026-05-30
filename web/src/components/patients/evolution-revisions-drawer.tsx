'use client'

import { formatInTimeZone } from 'date-fns-tz'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { BR_TZ } from '@/lib/dates'
import { useEvolutionRevisions } from '@/hooks/queries/use-evolutions'

interface EvolutionRevisionsDrawerProps {
  patientId: string
  /**
   * The current note whose history should be displayed. When `null` the
   * drawer renders nothing — the parent controls open state by setting or
   * clearing this prop alongside `open`.
   */
  note: { id: string; body: string; occurredAt: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Format an instant (Date or ISO string) as `dd/MM/yyyy HH:mm` in BR time,
 * regardless of host TZ. Uses `formatInTimeZone` instead of bare `format`
 * because the host (Vercel, CI) runs UTC — `format(d, 'dd/MM/yyyy HH:mm')`
 * silently shifts the wall clock by −3h on UTC hosts.
 */
function formatBrDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return formatInTimeZone(date, BR_TZ, 'dd/MM/yyyy HH:mm')
}

/**
 * Right-side Sheet showing the edit history of a single loose note.
 *
 * Layout (top → bottom):
 *  1. Current version — flagged with an "Atual" badge.
 *  2. Pre-edit snapshots in `editedAt DESC` order (most recent edit first).
 *
 * The underlying `useEvolutionRevisions` hook is enabled only when
 * `note` is non-null, so closing the drawer halts background polling.
 */
export function EvolutionRevisionsDrawer({
  patientId,
  note,
  open,
  onOpenChange,
}: EvolutionRevisionsDrawerProps) {
  const noteId = note?.id ?? null
  const { data: revisions, isLoading, isError } = useEvolutionRevisions(
    patientId,
    noteId,
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-md overflow-y-auto"
      >
        <SheetHeader className="pb-2">
          <SheetTitle>Histórico de edições</SheetTitle>
          <SheetDescription>
            Versões anteriores da evolução, da mais recente para a mais
            antiga.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {note ? (
            <>
              {/* Current ("Atual") version */}
              <section className="flex flex-col gap-2 rounded-[3px] border border-sage/20 bg-white p-3">
                <header className="flex items-center justify-between gap-2">
                  <Badge variant="default">Atual</Badge>
                  <span className="font-heading text-[12px] tabular-nums text-mid">
                    {formatBrDateTime(note.occurredAt)}
                  </span>
                </header>
                <p className="whitespace-pre-wrap text-[13px] text-charcoal">
                  {note.body}
                </p>
              </section>

              {/* Revisions */}
              {isLoading ? (
                <div className="flex flex-col gap-3">
                  <RevisionSkeleton />
                  <RevisionSkeleton />
                </div>
              ) : isError ? (
                <p className="rounded-[3px] border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  Não foi possível carregar o histórico. Tente novamente.
                </p>
              ) : !revisions || revisions.length === 0 ? (
                <p className="rounded-[3px] border border-dashed border-sage/30 px-3 py-6 text-center text-[12px] text-mid">
                  Sem edições anteriores.
                </p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {revisions.map((rev) => (
                    <li
                      key={rev.id}
                      className="flex flex-col gap-2 rounded-[3px] border border-sage/15 bg-white p-3"
                    >
                      <header className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-mid">
                          {rev.editedByName ?? 'Editor desconhecido'}
                        </span>
                        <span className="font-heading text-[11px] tabular-nums text-mid">
                          editado em {formatBrDateTime(rev.editedAt)}
                        </span>
                      </header>
                      <p className="whitespace-pre-wrap text-[13px] text-charcoal">
                        {rev.body}
                      </p>
                      <footer className="text-[10px] uppercase tracking-wider text-mid">
                        ocorrido em {formatBrDateTime(rev.occurredAt)}
                      </footer>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function RevisionSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-[3px] border border-sage/15 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

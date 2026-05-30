'use client'

import Link from 'next/link'
import { formatInTimeZone } from 'date-fns-tz'
import { MoreHorizontal, PenLine, Syringe } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, formatDate } from '@/lib/utils'
import { BR_TZ } from '@/lib/dates'
import type { EvolutionFeedEntry } from '@/db/queries/patient-evolutions'

type NoteEntry = Extract<EvolutionFeedEntry, { kind: 'note' }>
type SessionEntry = Extract<EvolutionFeedEntry, { kind: 'session' }>

interface EvolutionEntryCardProps {
  /** The feed entry to render — discriminated union of note | session. */
  entry: EvolutionFeedEntry
  /**
   * When true, render the actions dropdown (edit / view history / delete)
   * for note entries. Sessions are always read-only. Visibility gating —
   * ownership, role, deadlines — is the parent's responsibility; this
   * component just renders the menu when the parent says so.
   */
  canEdit: boolean
  /** Used to scope the "ver detalhes" link from a session row. */
  patientId: string
  /**
   * Optional — present so the parent can pass it through without
   * destructuring elsewhere; not currently used for in-card decisions
   * (ownership gating happens upstream).
   */
  currentUserId?: string
  onEdit?: (entry: NoteEntry) => void
  onDelete?: (entry: NoteEntry) => void
  onViewRevisions?: (entry: NoteEntry) => void
}

const SESSION_FIELD_LABELS: Record<string, string> = {
  technique: 'Técnica',
  clinicalResponse: 'Resposta clínica',
  adverseEffects: 'Efeitos adversos',
  notes: 'Observações',
  nextSessionObjectives: 'Próximos objetivos',
}

// Single-line "28/05/2026 · 14:32" — always rendered in BR time regardless
// of the host timezone. `toLocaleDateString/TimeString('pt-BR')` use the
// host TZ for the wall clock and only the locale for formatting, which
// misformats the displayed clinical timestamp on UTC hosts (Vercel, CI).
// Match the drawer pattern: always pipe through `formatInTimeZone(BR_TZ)`.
function formatDateTime(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  const date = formatInTimeZone(d, BR_TZ, 'dd/MM/yyyy')
  const time = formatInTimeZone(d, BR_TZ, 'HH:mm')
  return `${date} · ${time}`
}

export function EvolutionEntryCard({
  entry,
  canEdit,
  patientId,
  currentUserId: _currentUserId,
  onEdit,
  onDelete,
  onViewRevisions,
}: EvolutionEntryCardProps) {
  const isNote = entry.kind === 'note'
  const Icon = isNote ? PenLine : Syringe

  return (
    <div className="relative flex gap-3">
      {/* Left rail — vertical "spine" with marker dot/icon. */}
      <div className="relative flex w-9 shrink-0 flex-col items-center">
        <div
          className={cn(
            'relative z-10 flex size-7 items-center justify-center rounded-full bg-white ring-4 ring-white',
            isNote
              ? 'border border-sage/30 text-forest'
              : 'border border-forest/30 text-forest',
          )}
        >
          <Icon className="size-3.5" />
        </div>
        {/* The spine itself — extends down from the marker. The parent feed
            container hides it past the last entry by clipping overflow. */}
        <div className="absolute top-7 bottom-0 left-1/2 w-px -translate-x-1/2 bg-sage/20" />
      </div>

      {/* Right side — the actual card. */}
      <div className="flex-1 min-w-0 pb-6">
        {entry.kind === 'note' ? (
          <NoteCard
            entry={entry}
            canEdit={canEdit}
            onEdit={onEdit}
            onDelete={onDelete}
            onViewRevisions={onViewRevisions}
          />
        ) : (
          <SessionCard entry={entry} patientId={patientId} />
        )}
      </div>
    </div>
  )
}

// ── Note card ──────────────────────────────────────────────────────

function NoteCard({
  entry,
  canEdit,
  onEdit,
  onDelete,
  onViewRevisions,
}: {
  entry: NoteEntry
  canEdit: boolean
  onEdit?: (e: NoteEntry) => void
  onDelete?: (e: NoteEntry) => void
  onViewRevisions?: (e: NoteEntry) => void
}) {
  const showMenu = canEdit && (onEdit || onDelete || onViewRevisions)
  const wasEdited = entry.revisionCount > 0

  return (
    <article className="rounded-[3px] border border-sage/15 bg-white px-5 py-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-heading text-[14px] text-charcoal tabular-nums">
            {formatDateTime(entry.occurredAt)}
          </span>
          <span className="text-[11px] text-mid">{entry.authorName}</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-forest">
            Evolução
          </span>
          {wasEdited && (
            <span className="rounded-sm bg-sage/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-mid">
              editado
            </span>
          )}
        </div>

        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Ações da evolução"
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(entry)}>
                  Editar
                </DropdownMenuItem>
              )}
              {onViewRevisions && wasEdited && (
                <DropdownMenuItem onClick={() => onViewRevisions(entry)}>
                  Histórico de edições
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(entry)}
                >
                  Excluir
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <p className="text-[13px] text-charcoal whitespace-pre-wrap">
        {entry.body}
      </p>

      {wasEdited && onViewRevisions && (
        <button
          type="button"
          onClick={() => onViewRevisions(entry)}
          className="mt-3 text-[11px] text-mid underline-offset-2 hover:text-charcoal hover:underline"
        >
          Editado {entry.revisionCount}× · ver histórico
        </button>
      )}
    </article>
  )
}

// ── Session card ───────────────────────────────────────────────────

function SessionCard({
  entry,
  patientId,
}: {
  entry: SessionEntry
  patientId: string
}) {
  const isCancelledLine = entry.recordStatus === 'cancelled'
  const fields = (
    [
      ['technique', entry.technique],
      ['clinicalResponse', entry.clinicalResponse],
      ['adverseEffects', entry.adverseEffects],
      ['notes', entry.notes],
      ['nextSessionObjectives', entry.nextSessionObjectives],
    ] as const
  ).filter(([, v]) => !!v && v.trim().length > 0)

  return (
    <article
      className={cn(
        'rounded-[3px] border border-sage/15 bg-white px-5 py-4',
        isCancelledLine && 'opacity-70',
      )}
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-heading text-[14px] text-charcoal tabular-nums">
            {formatDateTime(entry.occurredAt)}
          </span>
          <span className="text-[11px] text-mid">{entry.executedByName}</span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.16em] text-forest">
          Sessão {entry.sessionOrdinal} de {entry.sessionsTotal}
        </span>
      </header>

      <p className="mb-3 text-[11px] uppercase tracking-wider text-mid">
        {entry.procedureTypeName}
        {isCancelledLine && (
          <span className="ml-1.5 text-mid/60">· linha cancelada</span>
        )}
      </p>

      <dl className="space-y-3">
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-mid">
              {SESSION_FIELD_LABELS[key]}
            </dt>
            <dd className="text-[13px] text-charcoal whitespace-pre-wrap">
              {value}
            </dd>
          </div>
        ))}

        {entry.productApplications.length > 0 && (
          <div>
            <dt className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-mid">
              Produtos aplicados
            </dt>
            <dd className="text-[13px] text-charcoal">
              <ul className="space-y-0.5">
                {entry.productApplications.map((p, i) => (
                  <li key={`${p.productName}-${i}`}>
                    · {p.productName}{' '}
                    <span className="text-mid">
                      {p.totalQuantity} {p.quantityUnit}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        {entry.diagramPointCount > 0 && (
          <div>
            <dd className="text-[12px] text-mid">
              {entry.diagramPointCount} ponto(s) de aplicação ·{' '}
              <Link
                href={`/pacientes/${patientId}/procedimentos/${entry.procedureRecordId}`}
                className="text-forest underline-offset-2 hover:underline"
              >
                ver detalhes →
              </Link>
            </dd>
          </div>
        )}

        {entry.followUpDate && (
          <div>
            <dd className="text-[12px] text-mid">
              <span className="uppercase tracking-wider">Retorno</span> ·{' '}
              <span className="tabular-nums text-charcoal">
                {formatDate(entry.followUpDate)}
              </span>
            </dd>
          </div>
        )}
      </dl>
    </article>
  )
}

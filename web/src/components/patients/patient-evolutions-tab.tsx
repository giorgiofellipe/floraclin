'use client'

import * as React from 'react'
import Link from 'next/link'
import { Loader2, NotebookPen, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { EvolutionEntryCard } from '@/components/patients/evolution-entry-card'
import {
  EvolutionNoteComposer,
  type EvolutionNoteComposerProps,
} from '@/components/patients/evolution-note-composer'
import { EvolutionRevisionsDrawer } from '@/components/patients/evolution-revisions-drawer'
import { useEvolutions } from '@/hooks/queries/use-evolutions'
import { useDeleteEvolution } from '@/hooks/mutations/use-evolution-mutations'
import type { EvolutionFeedEntry } from '@/db/queries/patient-evolutions'

type NoteEntry = Extract<EvolutionFeedEntry, { kind: 'note' }>

type ComposerMode = EvolutionNoteComposerProps['mode']
type ComposerInitial = EvolutionNoteComposerProps['initial']

interface RevisionsTarget {
  id: string
  body: string
  /** ISO 8601 string — the drawer normalizes for display. */
  occurredAt: string
}

interface PatientEvolutionsTabProps {
  patientId: string
  /**
   * Owner/practitioner gating. Drives whether the "Nova evolução" button and
   * per-card actions (edit / delete / view revisions) are surfaced. Server
   * routes ALSO enforce role — this is purely a UI affordance.
   */
  canEdit: boolean
}

/**
 * Container for the "Evoluções" patient tab.
 *
 * Owns three local state machines:
 *  - composer (create vs. edit of a free-text note)
 *  - revisions drawer (read-only history for a single note)
 *  - delete confirmation (reason required; mutation runs on confirm)
 *
 * Data fetching is owned by `useEvolutions`; mutation success invalidates
 * the feed query inside the mutation hooks, so this component only resets
 * its own state on each success path.
 *
 * NOTE on the delete confirmation: the codebase doesn't ship a shadcn
 * `AlertDialog` primitive — established convention (see `patient-list.tsx`,
 * `patient-procedures-tab.tsx`) is to use the regular `Dialog` for
 * destructive confirmations. We follow the existing pattern here so we
 * don't introduce a brand-new UI primitive in a leaf feature.
 */
export function PatientEvolutionsTab({
  patientId,
  canEdit,
}: PatientEvolutionsTabProps) {
  const { data: entries, isPending, isError, refetch } = useEvolutions(patientId)
  const deleteMutation = useDeleteEvolution(patientId)

  // ─── Composer state ────────────────────────────────────────────────
  const [composerOpen, setComposerOpen] = React.useState(false)
  const [composerMode, setComposerMode] = React.useState<ComposerMode>('create')
  const [composerInitial, setComposerInitial] =
    React.useState<ComposerInitial>(undefined)

  const openComposerForCreate = React.useCallback(() => {
    setComposerMode('create')
    setComposerInitial(undefined)
    setComposerOpen(true)
  }, [])

  const openComposerForEdit = React.useCallback((note: NoteEntry) => {
    setComposerMode('edit')
    setComposerInitial({
      id: note.id,
      body: note.body,
      occurredAt:
        note.occurredAt instanceof Date
          ? note.occurredAt.toISOString()
          : String(note.occurredAt),
    })
    setComposerOpen(true)
  }, [])

  // ─── Revisions drawer state ────────────────────────────────────────
  const [revisionsNote, setRevisionsNote] =
    React.useState<RevisionsTarget | null>(null)

  const openRevisions = React.useCallback((note: NoteEntry) => {
    setRevisionsNote({
      id: note.id,
      body: note.body,
      occurredAt:
        note.occurredAt instanceof Date
          ? note.occurredAt.toISOString()
          : String(note.occurredAt),
    })
  }, [])

  // ─── Delete confirmation state ─────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = React.useState<NoteEntry | null>(null)
  const [deleteReason, setDeleteReason] = React.useState('')
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const openDelete = React.useCallback((note: NoteEntry) => {
    setDeleteTarget(note)
    setDeleteReason('')
    setDeleteError(null)
  }, [])

  const closeDelete = React.useCallback(() => {
    setDeleteTarget(null)
    setDeleteReason('')
    setDeleteError(null)
  }, [])

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    const reason = deleteReason.trim()
    // Server enforces `min(1)`; the button is disabled when empty too, but
    // we guard here so a fast keypress + click can't slip through.
    if (reason.length === 0) {
      setDeleteError('Informe o motivo da exclusão.')
      return
    }
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync({ noteId: deleteTarget.id, reason })
      closeDelete()
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Erro ao excluir evolução.',
      )
    }
  }, [deleteTarget, deleteReason, deleteMutation, closeDelete])

  const printHref = `/pacientes/${patientId}/evolucoes/imprimir`
  const deletePending = deleteMutation.isPending

  return (
    <div>
      {/* ── Header strip ─────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="font-heading text-[15px] font-medium text-charcoal">
          Evoluções
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={printHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-md px-3 text-[13px] font-medium text-mid transition-colors hover:bg-cream/40 hover:text-charcoal"
          >
            Imprimir
          </Link>
          {canEdit && (
            <Button
              type="button"
              onClick={openComposerForCreate}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              Nova evolução
            </Button>
          )}
        </div>
      </div>

      {/* ── Body states ──────────────────────────────────────────────── */}
      {isPending ? (
        <FeedSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !entries || entries.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="relative">
          {entries.map((entry) => (
            <EvolutionEntryCard
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              canEdit={canEdit}
              patientId={patientId}
              onEdit={canEdit ? openComposerForEdit : undefined}
              onDelete={canEdit ? openDelete : undefined}
              onViewRevisions={openRevisions}
            />
          ))}
        </div>
      )}

      {/* ── Composer (create / edit) ─────────────────────────────────── */}
      {canEdit && (
        <EvolutionNoteComposer
          patientId={patientId}
          open={composerOpen}
          onOpenChange={setComposerOpen}
          mode={composerMode}
          initial={composerInitial}
          onSaved={() => {
            // Mutations invalidate the feed query on success — we just
            // need to close. The composer also closes itself, but doing
            // it here is idempotent and clear.
            setComposerOpen(false)
          }}
        />
      )}

      {/* ── Revisions drawer ─────────────────────────────────────────── */}
      <EvolutionRevisionsDrawer
        patientId={patientId}
        note={revisionsNote}
        open={revisionsNote !== null}
        onOpenChange={(open) => {
          if (!open) setRevisionsNote(null)
        }}
      />

      {/* ── Delete confirmation ──────────────────────────────────────── */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletePending) closeDelete()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir evolução</DialogTitle>
            <DialogDescription>
              Esta evolução será removida do prontuário. Informe o motivo
              — ele ficará registrado no histórico de auditoria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-1">
            <Label htmlFor="evolution-delete-reason">Motivo da exclusão</Label>
            <Textarea
              id="evolution-delete-reason"
              rows={3}
              value={deleteReason}
              onChange={(e) => {
                setDeleteReason(e.target.value)
                if (deleteError) setDeleteError(null)
              }}
              placeholder="Ex.: registrada no paciente errado, duplicada, etc."
              disabled={deletePending}
              className="resize-none"
              aria-invalid={deleteError ? true : undefined}
              autoFocus
            />
            {deleteError && (
              <p role="alert" className="text-[12px] text-destructive">
                {deleteError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDelete}
              disabled={deletePending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deletePending || deleteReason.trim().length === 0}
            >
              {deletePending && <Loader2 className="size-4 animate-spin" />}
              {deletePending ? 'Excluindo...' : 'Excluir evolução'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sub-views ────────────────────────────────────────────────────────

function FeedSkeleton() {
  // Mirror the visual rhythm of `EvolutionEntryCard` (left-rail dot + card
  // body) so the skeleton occupies the same vertical space as the real
  // content. Three placeholders is enough to communicate "loading list"
  // without dominating the viewport.
  return (
    <div className="space-y-0">
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative flex gap-3">
          <div className="relative flex w-9 shrink-0 flex-col items-center">
            <Skeleton className="z-10 size-7 rounded-full" />
            <div className="absolute top-7 bottom-0 left-1/2 w-px -translate-x-1/2 bg-sage/20" />
          </div>
          <div className="flex-1 min-w-0 pb-6">
            <div className="rounded-[3px] border border-sage/15 bg-white px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="mb-2 h-3 w-full" />
              <Skeleton className="mb-2 h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-[3px] border border-dashed border-sage/25 bg-white py-16 px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#F4F6F8]">
        <NotebookPen className="size-6 text-mid/50" />
      </div>
      <p className="text-[14px] font-medium text-charcoal">
        Nenhuma evolução registrada ainda.
      </p>
      <p className="mt-1 text-[12px] text-mid">
        Notas clínicas e sessões executadas aparecerão aqui em ordem
        cronológica.
      </p>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[3px] border border-destructive/20 bg-destructive/5 py-12 px-6 text-center">
      <p className="text-[13px] font-medium text-destructive">
        Não foi possível carregar as evoluções.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-3"
      >
        Tentar novamente
      </Button>
    </div>
  )
}

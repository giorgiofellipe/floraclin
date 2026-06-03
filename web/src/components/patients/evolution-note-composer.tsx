'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateEvolution,
  useEditEvolution,
} from '@/hooks/mutations/use-evolution-mutations'
import { brToday, parseLocalDate } from '@/lib/dates'
import {
  EVOLUTION_BODY_MAX,
  type CreateEvolutionInput,
  type EditEvolutionInput,
} from '@/validations/patient-evolution'

interface EvolutionInitial {
  id: string
  body: string
  /** ISO 8601 instant from the server. */
  occurredAt: string
}

export interface EvolutionNoteComposerProps {
  patientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  /** Required when `mode === 'edit'`. */
  initial?: EvolutionInitial
  /** Fires after a successful create/edit, before the modal closes. */
  onSaved?: () => void
}

/**
 * Format a `Date` for a `datetime-local` <input>. Uses local getters —
 * the input is a local wall-clock picker, so we want host-local values.
 * Mirrors the helper in `procedures/session-execution-form.tsx`.
 */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

function defaultOccurredAtLocal(): string {
  return toDatetimeLocalValue(new Date())
}

/**
 * Convert the `datetime-local` value (local wall-clock, no TZ) into an
 * ISO 8601 instant suitable for `z.string().datetime()`. We route through
 * `parseLocalDate` per CLAUDE.md — that helper splits the YMD/time pair
 * and returns a host-local `Date`.
 */
function localPickerToIso(value: string): string {
  // value shape: "YYYY-MM-DDTHH:mm" — split off the date so parseLocalDate
  // can validate the YMD half, then anchor with the picked clock time.
  const [datePart, timePart = '00:00'] = value.split('T')
  const time = timePart.length === 5 ? `${timePart}:00` : timePart
  return parseLocalDate(datePart, time).toISOString()
}

export function EvolutionNoteComposer({
  patientId,
  open,
  onOpenChange,
  mode,
  initial,
  onSaved,
}: EvolutionNoteComposerProps) {
  const createMutation = useCreateEvolution(patientId)
  const editMutation = useEditEvolution(patientId)

  const [body, setBody] = React.useState('')
  const [occurredAtLocal, setOccurredAtLocal] = React.useState('')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  const isEdit = mode === 'edit'
  const pending = isEdit ? editMutation.isPending : createMutation.isPending
  // Trim-aware emptiness check matches the server-side `z.string().trim().min(1)`
  // so the submit button reflects what the API will actually accept.
  const trimmedLength = body.trim().length
  const bodyEmpty = trimmedLength === 0
  const overLimit = body.length > EVOLUTION_BODY_MAX
  const canSubmit = !bodyEmpty && !overLimit && !pending

  // Reset form state every time the modal opens. For `edit`, pre-fill from
  // `initial`. For `create`, fall back to "now in BR" anchored at noon.
  React.useEffect(() => {
    if (!open) return
    setErrorMessage(null)
    if (isEdit && initial) {
      setBody(initial.body)
      const d = new Date(initial.occurredAt)
      setOccurredAtLocal(
        Number.isNaN(d.getTime())
          ? defaultOccurredAtLocal()
          : toDatetimeLocalValue(d),
      )
    } else {
      setBody('')
      setOccurredAtLocal(defaultOccurredAtLocal())
    }
  }, [open, isEdit, initial])

  // autoFocus on open. We do this in an effect (not the `autoFocus` prop)
  // because the textarea mounts inside a portal and the prop fires before
  // the dialog finishes its open animation on some browsers.
  React.useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      textareaRef.current?.focus()
      // Put the caret at the end so an edit doesn't select the whole body.
      const el = textareaRef.current
      if (el) el.setSelectionRange(el.value.length, el.value.length)
    }, 50)
    return () => window.clearTimeout(id)
  }, [open])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    setErrorMessage(null)

    let occurredAtIso: string | undefined
    if (occurredAtLocal) {
      try {
        occurredAtIso = localPickerToIso(occurredAtLocal)
      } catch {
        setErrorMessage('Data e hora inválidas.')
        return
      }
    }

    try {
      if (isEdit) {
        if (!initial) {
          setErrorMessage('Evolução inválida para edição.')
          return
        }
        const payload: EditEvolutionInput & { noteId: string } = {
          noteId: initial.id,
          body,
          ...(occurredAtIso ? { occurredAt: occurredAtIso } : {}),
        }
        await editMutation.mutateAsync(payload)
      } else {
        const payload: CreateEvolutionInput = {
          body,
          ...(occurredAtIso ? { occurredAt: occurredAtIso } : {}),
        }
        await createMutation.mutateAsync(payload)
      }
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      // Mutation hooks throw `Error` with the server's `error` field as the
      // message; fall back to a generic string if anything else slipped in.
      const message = err instanceof Error ? err.message : 'Erro ao salvar evolução.'
      setErrorMessage(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar Evolução' : 'Nova Evolução'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="evolution-body">Conteúdo</Label>
            <Textarea
              id="evolution-body"
              ref={textareaRef}
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={pending}
              maxLength={EVOLUTION_BODY_MAX}
              aria-invalid={overLimit || undefined}
              placeholder="Descreva a evolução clínica do paciente..."
              className="min-h-48 resize-y"
            />
            <div className="flex items-center justify-between text-xs text-mid">
              <span>
                {bodyEmpty
                  ? 'Conteúdo obrigatório.'
                  : 'Será salvo no histórico clínico do paciente.'}
              </span>
              <span
                className={
                  overLimit ? 'text-destructive tabular-nums' : 'tabular-nums'
                }
              >
                {body.length.toLocaleString('pt-BR')} /{' '}
                {EVOLUTION_BODY_MAX.toLocaleString('pt-BR')}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evolution-occurred-at">Data e hora</Label>
            <Input
              id="evolution-occurred-at"
              type="datetime-local"
              value={occurredAtLocal}
              onChange={(e) => setOccurredAtLocal(e.target.value)}
              disabled={pending}
              className="max-w-xs"
            />
            <p className="text-xs text-mid">
              Quando a observação foi feita. Por padrão, agora.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {errorMessage}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Salvar alterações' : 'Adicionar evolução'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

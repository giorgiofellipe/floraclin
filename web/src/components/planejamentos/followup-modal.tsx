'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useRecordFollowup } from '@/hooks/queries/use-planejamentos'
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_OUTCOMES,
  type FollowupChannel,
  type FollowupOutcome,
} from '@/validations/followup'

const CHANNEL_LABELS: Record<FollowupChannel, string> = {
  whatsapp: 'WhatsApp',
  call: 'Ligação',
  in_person: 'Pessoalmente',
  other: 'Outro',
}

const OUTCOME_LABELS: Record<FollowupOutcome, string> = {
  agendou: 'Agendou',
  pediu_para_aguardar: 'Pediu para aguardar',
  sem_resposta: 'Sem resposta',
  desistiu: 'Desistiu do procedimento',
  outro: 'Outro',
}

export interface FollowupModalProps {
  open: boolean
  onClose: () => void
  procedureRecordId: string
  patientName?: string
  procedureTypeName?: string
  onRecorded?: (cancelledProcedure: boolean) => void
}

export function FollowupModal({
  open,
  onClose,
  procedureRecordId,
  patientName,
  procedureTypeName,
  onRecorded,
}: FollowupModalProps) {
  const [channel, setChannel] = useState<FollowupChannel>('whatsapp')
  const [outcome, setOutcome] = useState<FollowupOutcome>('sem_resposta')
  const [notes, setNotes] = useState('')

  const recordFollowup = useRecordFollowup()

  // Reset state whenever the modal reopens
  useEffect(() => {
    if (open) {
      setChannel('whatsapp')
      setOutcome('sem_resposta')
      setNotes('')
      recordFollowup.reset()
    }
    // We intentionally don't include `recordFollowup` to avoid resets on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await recordFollowup.mutateAsync({
        procedureRecordId,
        channel,
        outcome,
        notes: notes.trim() || undefined,
      })
      if (res.data.cancelledProcedure) {
        toast.success('Planejamento cancelado conforme registro.')
      } else {
        toast.success('Contato registrado.')
      }
      onRecorded?.(res.data.cancelledProcedure)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao registrar contato'
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar contato</DialogTitle>
          {(patientName || procedureTypeName) && (
            <p className="text-sm text-muted-foreground">
              {[patientName, procedureTypeName].filter(Boolean).join(' · ')}
            </p>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">Canal</legend>
            <div className="grid grid-cols-2 gap-2">
              {FOLLOWUP_CHANNELS.map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    channel === value
                      ? 'border-forest bg-forest/5 text-forest'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="followup-channel"
                    value={value}
                    checked={channel === value}
                    onChange={() => setChannel(value)}
                    className="sr-only"
                  />
                  <span>{CHANNEL_LABELS[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">Resultado</legend>
            <div className="grid grid-cols-1 gap-2">
              {FOLLOWUP_OUTCOMES.map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    outcome === value
                      ? 'border-forest bg-forest/5 text-forest'
                      : 'border-input hover:bg-muted'
                  } ${value === 'desistiu' ? 'data-[outcome=desistiu]' : ''}`}
                  data-outcome={value}
                >
                  <input
                    type="radio"
                    name="followup-outcome"
                    value={value}
                    checked={outcome === value}
                    onChange={() => setOutcome(value)}
                    className="sr-only"
                  />
                  <span>{OUTCOME_LABELS[value]}</span>
                </label>
              ))}
            </div>
            {outcome === 'desistiu' && (
              <p className="text-xs text-amber-mid">
                O planejamento será automaticamente cancelado ao registrar este contato.
              </p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="followup-notes">Observações</Label>
            <Textarea
              id="followup-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalhes do contato (opcional)"
              maxLength={2000}
              rows={4}
            />
          </div>

          {recordFollowup.isError && (
            <p className="text-xs text-destructive">
              {recordFollowup.error?.message ?? 'Erro ao registrar contato'}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={recordFollowup.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={recordFollowup.isPending}>
              {recordFollowup.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { addDays } from 'date-fns'
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
import { DatePicker } from '@/components/ui/date-picker'
import { useSnoozeProcedure } from '@/hooks/queries/use-planejamentos'
import { brToday, parseBrDate, toLocalYmd } from '@/lib/dates'

export interface SnoozeModalProps {
  open: boolean
  onClose: () => void
  procedureRecordId: string
  currentSnoozedUntil?: string | null
  patientName?: string
  procedureTypeName?: string
  onSnoozed?: (until: string | null) => void
}

function tomorrowBr(): string {
  // BR-anchored "tomorrow": parse today as BR noon, add a day, format YMD.
  return toLocalYmd(addDays(parseBrDate(brToday(), '12:00:00'), 1))
}

export function SnoozeModal({
  open,
  onClose,
  procedureRecordId,
  currentSnoozedUntil,
  patientName,
  procedureTypeName,
  onSnoozed,
}: SnoozeModalProps) {
  const [until, setUntil] = useState<string>('')
  const minDate = tomorrowBr()
  const snoozeMutation = useSnoozeProcedure()

  // Reset to the current snoozed value or empty when reopening
  useEffect(() => {
    if (open) {
      setUntil(currentSnoozedUntil ?? '')
      snoozeMutation.reset()
    }
    // Intentionally not depending on `snoozeMutation`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentSnoozedUntil])

  const isPastOrToday = (() => {
    if (!until) return false
    try {
      const picked = parseBrDate(until, '12:00:00')
      const today = parseBrDate(brToday(), '12:00:00')
      return picked.getTime() <= today.getTime()
    } catch {
      return true
    }
  })()

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!until) {
      toast.error('Escolha uma data para adiar.')
      return
    }
    if (isPastOrToday) {
      toast.error('A data do adiamento deve ser posterior a hoje.')
      return
    }
    try {
      await snoozeMutation.mutateAsync({ procedureRecordId, until })
      toast.success('Planejamento adiado.')
      onSnoozed?.(until)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao adiar planejamento'
      toast.error(message)
    }
  }

  const handleRemove = async () => {
    try {
      await snoozeMutation.mutateAsync({ procedureRecordId, until: null })
      toast.success('Adiamento removido.')
      onSnoozed?.(null)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao remover adiamento'
      toast.error(message)
    }
  }

  const hasExisting = Boolean(currentSnoozedUntil)
  const pending = snoozeMutation.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adiar planejamento</DialogTitle>
          {(patientName || procedureTypeName) && (
            <p className="text-sm text-muted-foreground">
              {[patientName, procedureTypeName].filter(Boolean).join(' · ')}
            </p>
          )}
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="snooze-until">Adiar até</Label>
            <DatePicker
              value={until}
              onChange={(v) => setUntil(v)}
              minDate={minDate}
              placeholder="Escolha uma data"
            />
            {isPastOrToday && (
              <p className="text-xs text-destructive">
                A data deve ser posterior a hoje.
              </p>
            )}
          </div>

          {snoozeMutation.isError && (
            <p className="text-xs text-destructive">
              {snoozeMutation.error?.message ?? 'Erro ao salvar'}
            </p>
          )}

          <DialogFooter>
            {hasExisting && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleRemove}
                disabled={pending}
                className="sm:mr-auto"
              >
                Remover adiamento
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !until || isPastOrToday}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Adiar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

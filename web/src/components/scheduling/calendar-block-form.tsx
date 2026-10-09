'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCreateCalendarBlock } from '@/hooks/queries/use-calendar'
import { createCalendarBlockSchema } from '@/validations/calendar-block'
import { START_TIMES, END_TIMES, timeItems } from '@/lib/time-options'

const CLINIC = 'clinic'
const START_ITEMS = timeItems(START_TIMES)
const LABEL_CLASS = 'uppercase tracking-wider text-xs font-medium text-mid'

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-red-600">{message}</p> : null
}

interface CalendarBlockFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  practitioners: { id: string; fullName: string }[]
  canBlockClinic: boolean
  lockedPractitionerId?: string
  defaultPractitionerId?: string
  defaultDate: string
}

export function CalendarBlockForm({
  open,
  onOpenChange,
  practitioners,
  canBlockClinic,
  lockedPractitionerId,
  defaultPractitionerId,
  defaultDate,
}: CalendarBlockFormProps) {
  const createBlock = useCreateCalendarBlock()

  // Clinic-wide is never the default: it closes every agenda on one click.
  const preferred = practitioners.find((p) => p.id === defaultPractitionerId)?.id ?? practitioners[0]?.id
  const initialTarget = lockedPractitionerId ?? preferred ?? CLINIC
  const [target, setTarget] = React.useState(initialTarget)
  const [date, setDate] = React.useState(defaultDate)
  const [allDay, setAllDay] = React.useState(false)
  const [startTime, setStartTime] = React.useState('08:00')
  const [endTime, setEndTime] = React.useState('09:00')
  const [title, setTitle] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!open) return
    setTarget(initialTarget)
    setDate(defaultDate)
    setAllDay(false)
    setStartTime('08:00')
    setEndTime('09:00')
    setTitle('')
    setErrors({})
  }, [open, defaultDate, initialTarget])

  const endItems = React.useMemo(() => timeItems(END_TIMES.filter((t) => t > startTime)), [startTime])
  const handleStartChange = (v: string) => {
    setStartTime(v)
    if (endTime <= v) setEndTime(END_TIMES.find((t) => t > v) ?? v)
  }

  const targetItems = React.useMemo(
    () => ({
      ...(canBlockClinic ? { [CLINIC]: 'Toda a clínica' } : {}),
      ...Object.fromEntries(practitioners.map((p) => [p.id, p.fullName])),
    }),
    [canBlockClinic, practitioners]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = createCalendarBlockSchema.safeParse({
      practitionerId: target === CLINIC ? null : target,
      date,
      allDay,
      ...(allDay ? {} : { startTime, endTime }),
      title,
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0])
        next[field] ??= issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    try {
      await createBlock.mutateAsync(parsed.data)
      toast.success('Horário bloqueado')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao bloquear horário')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-charcoal">Bloquear horário</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-5">
          {!lockedPractitionerId && (
            <div className="grid gap-2">
              <Label className={LABEL_CLASS}>Profissional</Label>
              <Select
                name="practitionerId"
                items={targetItems}
                value={target}
                onValueChange={(v) => v && setTarget(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o profissional" />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <FieldError message={errors.practitionerId} />
            </div>
          )}

          <div className="grid gap-2">
            <Label className={LABEL_CLASS}>Data</Label>
            <DatePicker value={date} onChange={setDate} />
            <FieldError message={errors.date} />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="block-all-day" className={LABEL_CLASS}>Dia inteiro</Label>
            <Switch id="block-all-day" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className={LABEL_CLASS}>Início</Label>
                <Select name="startTime" items={START_ITEMS} value={startTime} onValueChange={(v) => v && handleStartChange(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
                <FieldError message={errors.startTime} />
              </div>
              <div className="grid gap-2">
                <Label className={LABEL_CLASS}>Término</Label>
                <Select name="endTime" items={endItems} value={endTime} onValueChange={(v) => v && setEndTime(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
                <FieldError message={errors.endTime} />
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="block-title" className={LABEL_CLASS}>Descrição (opcional)</Label>
            <Input
              id="block-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Consulta médica, feriado"
            />
            <FieldError message={errors.title} />
          </div>

          <DialogFooter className="pt-2 border-t border-sage/10">
            <Button
              type="button"
              variant="outline"
              className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createBlock.isPending}
              className="bg-forest text-cream hover:bg-sage transition-colors"
            >
              {createBlock.isPending ? 'Bloqueando...' : 'Bloquear horário'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AnchoredPanel } from '@/components/scheduling/anchored-panel'
import { PatientPicker, resolvePatientChoice, type PatientChoice } from '@/components/scheduling/patient-picker'
import { useCreateAppointment } from '@/hooks/mutations/use-appointment-mutations'
import { useCreatePatient } from '@/hooks/mutations/use-patient-mutations'
import { minutesToTime, timeToMinutes } from '@/lib/free-slots'
import { parseLocalDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

interface Practitioner {
  id: string
  fullName: string
}

interface ProcedureType {
  id: string
  name: string
  estimatedDurationMin: number | null
}

export interface BookingDraft {
  date: string
  startTime: string
  endTime: string
  practitionerId: string
  procedureTypeId: string
  patient: PatientChoice | null
}

const DEFAULT_DURATION_MIN = 30
const CHIP_LIMIT = 6

interface QuickBookCardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: Element | null
  date: string
  startTime: string
  defaultPractitionerId: string
  practitioners: Practitioner[]
  procedureTypes: ProcedureType[]
  onMoreOptions: (draft: BookingDraft) => void
}

/** Book in a few taps from the slot that was tapped; "Mais opções" opens the full form with what was filled. */
export function QuickBookCard({
  open,
  onOpenChange,
  anchor,
  date,
  startTime,
  defaultPractitionerId,
  practitioners,
  procedureTypes,
  onMoreOptions,
}: QuickBookCardProps) {
  const createAppointment = useCreateAppointment()
  const createPatient = useCreatePatient()
  const [patient, setPatient] = React.useState<PatientChoice | null>(null)
  const [procedureTypeId, setProcedureTypeId] = React.useState('')
  const [practitionerId, setPractitionerId] = React.useState(defaultPractitionerId)
  const [error, setError] = React.useState<string | null>(null)

  const procedure = procedureTypes.find((p) => p.id === procedureTypeId)
  const endTime = minutesToTime(timeToMinutes(startTime) + (procedure?.estimatedDurationMin ?? DEFAULT_DURATION_MIN))
  const dayLabel = format(parseLocalDate(date, '12:00:00'), "EEE, d 'de' MMM", { locale: ptBR })
  const practitionerItems = React.useMemo(
    () => Object.fromEntries(practitioners.map((p) => [p.id, p.fullName])),
    [practitioners],
  )
  const saving = createAppointment.isPending || createPatient.isPending
  const draft: BookingDraft = { date, startTime, endTime, practitionerId, procedureTypeId, patient }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const { patientId, bookingName } = await resolvePatientChoice(patient, (input) => createPatient.mutateAsync(input))
      // A retry after a refused slot must reuse the patient just registered, not register it again.
      if (patient?.kind === 'new' && patientId) setPatient({ kind: 'existing', id: patientId, fullName: bookingName ?? '' })
      await createAppointment.mutateAsync({
        patientId,
        bookingName,
        practitionerId,
        procedureTypeId: procedureTypeId || undefined,
        date,
        startTime,
        endTime,
      })
      toast.success(`Agendado: ${bookingName ?? 'horário reservado'}, ${dayLabel} às ${startTime}`)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao agendar')
    }
  }

  return (
    <AnchoredPanel open={open} onOpenChange={onOpenChange} anchor={anchor} title="Novo agendamento" testId="quick-book-card">
      <form onSubmit={submit} className="grid gap-3" data-testid="quick-book-form">
        <div>
          <p className="text-[15px] font-semibold text-charcoal">Novo agendamento</p>
          <p className="text-[13px] text-mid first-letter:uppercase tabular-nums" data-testid="quick-book-when">
            {dayLabel} · {startTime}-{endTime}
          </p>
        </div>

        {practitioners.length > 1 && (
          <div className="grid gap-1.5">
            <Label className="text-xs text-mid">Profissional</Label>
            <Select items={practitionerItems} value={practitionerId} onValueChange={(v) => v && setPractitionerId(v)}>
              <SelectTrigger className="w-full max-sm:h-11" aria-label="Profissional">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
        )}

        <PatientPicker id="quick-book-patient" value={patient} onChange={setPatient} autoFocus labelClassName="text-xs text-mid" />

        {procedureTypes.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-mid" id="quick-book-procedure">Procedimento</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="quick-book-procedure">
              {procedureTypes.slice(0, CHIP_LIMIT).map((pt) => {
                const selected = pt.id === procedureTypeId
                return (
                  <button
                    key={pt.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setProcedureTypeId(selected ? '' : pt.id)}
                    className={cn(
                      'inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] transition-colors max-sm:min-h-11',
                      selected ? 'border-sage bg-sage text-cream' : 'border-sage/25 bg-white text-charcoal hover:border-sage/50 hover:bg-confirmed-bg',
                    )}
                    data-testid="quick-book-procedure-chip"
                  >
                    {pt.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="text-sage max-sm:h-11"
            onClick={() => onMoreOptions(draft)}
            data-testid="quick-book-more"
          >
            Mais opções
          </Button>
          <Button type="submit" disabled={saving} className="bg-forest text-cream hover:bg-sage max-sm:h-11 max-sm:px-5" data-testid="quick-book-submit">
            {saving ? 'Agendando...' : 'Agendar'}
          </Button>
        </div>
      </form>
    </AnchoredPanel>
  )
}

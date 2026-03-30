'use client'

import * as React from 'react'
import { useActionState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createAppointmentAction,
  updateAppointmentAction,
  updateAppointmentStatusAction,
  deleteAppointmentAction,
  listPatientsForSelectAction,
  type AppointmentActionState,
} from '@/actions/appointments'
import { useInvalidation } from '@/hooks/queries/use-invalidation'
import { STATUS_LABELS } from '@/components/scheduling/appointment-card'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { AppointmentStatus } from '@/types'

interface Practitioner {
  id: string
  fullName: string
}

interface ProcedureType {
  id: string
  name: string
  estimatedDurationMin: number | null
}

interface PatientOption {
  id: string
  fullName: string
  phone: string
}

interface AppointmentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
  appointment?: AppointmentWithDetails | null
  practitioners: Practitioner[]
  procedureTypes: ProcedureType[]
  defaultDate?: string
  defaultStartTime?: string
  defaultPractitionerId?: string
}

function generateTimeOptions(): string[] {
  const times: string[] = []
  for (let h = 7; h <= 20; h++) {
    for (const m of [0, 30]) {
      if (h === 20 && m === 30) break
      times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return times
}

const TIME_OPTIONS = generateTimeOptions()

function getDefaultEndTime(startTime: string, durationMin: number = 30): string {
  const [h, m] = startTime.split(':').map(Number)
  const totalMin = h * 60 + m + durationMin
  const endH = Math.floor(totalMin / 60)
  const endM = totalMin % 60
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
}

export function AppointmentForm({
  open,
  onOpenChange,
  onSaved,
  appointment,
  practitioners,
  procedureTypes,
  defaultDate,
  defaultStartTime,
  defaultPractitionerId,
}: AppointmentFormProps) {
  const isEditing = !!appointment
  const { invalidateAppointments } = useInvalidation()

  const [patientSearch, setPatientSearch] = React.useState('')
  const [patientOptions, setPatientOptions] = React.useState<PatientOption[]>([])
  const [selectedPatientId, setSelectedPatientId] = React.useState<string>(
    appointment?.patientId ?? ''
  )
  const [selectedPatientName, setSelectedPatientName] = React.useState<string>(
    appointment?.patientName ?? ''
  )
  const [showPatientDropdown, setShowPatientDropdown] = React.useState(false)
  const [practitionerId, setPractitionerId] = React.useState(
    appointment?.practitionerId ?? defaultPractitionerId ?? practitioners[0]?.id ?? ''
  )
  const [procedureTypeId, setProcedureTypeId] = React.useState(
    appointment?.procedureTypeId ?? ''
  )
  const [date, setDate] = React.useState(appointment?.date ?? defaultDate ?? '')
  const [startTime, setStartTime] = React.useState(
    appointment?.startTime?.slice(0, 5) ?? defaultStartTime ?? '08:00'
  )
  const [endTime, setEndTime] = React.useState(
    appointment?.endTime?.slice(0, 5) ?? getDefaultEndTime(defaultStartTime ?? '08:00')
  )

  const action = isEditing ? updateAppointmentAction : createAppointmentAction
  const [state, formAction, isPending] = useActionState(action, null)

  // Reset form on open
  React.useEffect(() => {
    if (open) {
      if (appointment) {
        setSelectedPatientId(appointment.patientId ?? '')
        setSelectedPatientName(appointment.patientName ?? '')
        setPractitionerId(appointment.practitionerId)
        setProcedureTypeId(appointment.procedureTypeId ?? '')
        setDate(appointment.date)
        setStartTime(appointment.startTime.slice(0, 5))
        setEndTime(appointment.endTime.slice(0, 5))
      } else {
        setSelectedPatientId('')
        setSelectedPatientName('')
        setPractitionerId(defaultPractitionerId ?? practitioners[0]?.id ?? '')
        setProcedureTypeId('')
        setDate(defaultDate ?? '')
        setStartTime(defaultStartTime ?? '08:00')
        setEndTime(getDefaultEndTime(defaultStartTime ?? '08:00'))
      }
      setPatientSearch('')
      setPatientOptions([])
    }
  }, [open, appointment, defaultDate, defaultStartTime, defaultPractitionerId, practitioners])

  // Close on success and notify parent
  React.useEffect(() => {
    if (state?.success) {
      invalidateAppointments()
      onSaved?.()
      onOpenChange(false)
    }
  }, [state?.success, onOpenChange, onSaved, invalidateAppointments])

  // Search patients
  React.useEffect(() => {
    if (patientSearch.length < 2) {
      setPatientOptions([])
      return
    }
    const timer = setTimeout(async () => {
      const results = await listPatientsForSelectAction(patientSearch)
      setPatientOptions(results)
    }, 300)
    return () => clearTimeout(timer)
  }, [patientSearch])

  // Auto-set end time when procedure type changes
  const handleProcedureTypeChange = (value: string) => {
    setProcedureTypeId(value)
    const pt = procedureTypes.find((p) => p.id === value)
    if (pt?.estimatedDurationMin) {
      setEndTime(getDefaultEndTime(startTime, pt.estimatedDurationMin))
    }
  }

  const handleStartTimeChange = (value: string) => {
    setStartTime(value)
    const pt = procedureTypes.find((p) => p.id === procedureTypeId)
    setEndTime(getDefaultEndTime(value, pt?.estimatedDurationMin ?? 30))
  }

  const handleStatusChange = async (status: AppointmentStatus) => {
    if (!appointment) return
    await updateAppointmentStatusAction(appointment.id, status)
    invalidateAppointments()
    onSaved?.()
    onOpenChange(false)
  }

  const handleDelete = async () => {
    if (!appointment) return
    if (!confirm('Tem certeza que deseja excluir este agendamento?')) return
    await deleteAppointmentAction(appointment.id)
    invalidateAppointments()
    onSaved?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-charcoal">{isEditing ? 'Editar Agendamento' : 'Novo Agendamento'}</DialogTitle>
        </DialogHeader>

        {state?.error && (
          <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 border border-red-100">
            {state.error}
          </div>
        )}

        <form action={formAction} className="grid gap-5" data-testid="appointment-form">
          {isEditing && <input type="hidden" name="id" value={appointment.id} />}

          {/* Patient search */}
          <div className="grid gap-2">
            <Label htmlFor="patient-search" className="uppercase tracking-wider text-xs font-medium text-mid">Paciente</Label>
            <div className="relative">
              <Input
                id="patient-search"
                placeholder="Buscar paciente por nome..."
                value={selectedPatientName || patientSearch}
                onChange={(e) => {
                  const val = (e.target as HTMLInputElement).value
                  setPatientSearch(val)
                  setSelectedPatientId('')
                  setSelectedPatientName('')
                  setShowPatientDropdown(true)
                }}
                onFocus={() => setShowPatientDropdown(true)}
                onBlur={() => setTimeout(() => setShowPatientDropdown(false), 200)}
              />
              <input type="hidden" name="patientId" value={selectedPatientId} />
              {showPatientDropdown && patientOptions.length > 0 && (
                <div className="absolute top-full z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                  {patientOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setSelectedPatientId(p.id)
                        setSelectedPatientName(p.fullName)
                        setPatientSearch('')
                        setShowPatientDropdown(false)
                      }}
                    >
                      <span>{p.fullName}</span>
                      <span className="text-xs text-muted-foreground">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Practitioner */}
          <div className="grid gap-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Profissional</Label>
            <Select
              value={practitionerId}
              onValueChange={(v) => v && setPractitionerId(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o profissional">
                  {(value: string) => practitioners.find((p) => p.id === value)?.fullName ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {practitioners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="practitionerId" value={practitionerId} />
          </div>

          {/* Procedure type */}
          <div className="grid gap-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Tipo de Procedimento</Label>
            <Select
              value={procedureTypeId}
              onValueChange={(v) => v && handleProcedureTypeChange(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione (opcional)">
                  {(value: string) => {
                    const pt = procedureTypes.find((p) => p.id === value)
                    if (!pt) return value
                    return pt.estimatedDurationMin ? `${pt.name} (${pt.estimatedDurationMin}min)` : pt.name
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {procedureTypes.map((pt) => (
                  <SelectItem key={pt.id} value={pt.id}>
                    {pt.name}
                    {pt.estimatedDurationMin && (
                      <span className="text-muted-foreground"> ({pt.estimatedDurationMin}min)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="procedureTypeId" value={procedureTypeId} />
          </div>

          {/* Date */}
          <div className="grid gap-2">
            <Label htmlFor="date" className="uppercase tracking-wider text-xs font-medium text-mid">Data</Label>
            <Input
              id="date"
              name="date"
              type="date"
              value={date}
              onChange={(e) => setDate((e.target as HTMLInputElement).value)}
              required
            />
            {state?.fieldErrors?.date && (
              <p className="text-xs text-destructive">{state.fieldErrors.date[0]}</p>
            )}
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Inicio</Label>
              <Select value={startTime} onValueChange={(v) => v && handleStartTimeChange(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="startTime" value={startTime} />
            </div>
            <div className="grid gap-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Termino</Label>
              <Select value={endTime} onValueChange={(v) => v && setEndTime(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.filter((t) => t > startTime).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="endTime" value={endTime} />
              {state?.fieldErrors?.endTime && (
                <p className="text-xs text-destructive">{state.fieldErrors.endTime[0]}</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="grid gap-2">
            <Label htmlFor="notes" className="uppercase tracking-wider text-xs font-medium text-mid">Observações</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Observações sobre o agendamento..."
              defaultValue={appointment?.notes ?? ''}
              rows={3}
            />
          </div>

          <DialogFooter className="pt-2 border-t border-sage/10">
            <div className="flex w-full items-center justify-between">
              <div className="flex gap-2">
                {isEditing && (
                  <>
                    <Select onValueChange={(v) => v && handleStatusChange(v as AppointmentStatus)}>
                      <SelectTrigger className="w-auto text-sm">
                        <SelectValue placeholder="Alterar status">
                          {(value: string) => STATUS_LABELS[value as AppointmentStatus] ?? value}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="destructive" size="sm" onClick={handleDelete}>
                      Excluir
                    </Button>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                  onClick={() => onOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending} className="bg-forest text-cream hover:bg-sage transition-colors" data-testid="appointment-form-submit">
                  {isPending ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

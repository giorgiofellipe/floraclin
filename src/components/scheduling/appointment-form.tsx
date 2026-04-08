'use client'

import * as React from 'react'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateAppointment,
  useUpdateAppointment,
  useUpdateAppointmentStatus,
  useDeleteAppointment,
} from '@/hooks/mutations/use-appointment-mutations'
import { useCreatePatient } from '@/hooks/mutations/use-patient-mutations'
import { PlusIcon } from 'lucide-react'
import { maskPhone } from '@/lib/masks'
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
  cpf?: string | null
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
const TIME_ITEMS: Record<string, string> = Object.fromEntries(TIME_OPTIONS.map((t) => [t, t]))

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
  const createAppointment = useCreateAppointment()
  const updateAppointment = useUpdateAppointment()
  const updateAppointmentStatus = useUpdateAppointmentStatus()
  const deleteAppointmentMutation = useDeleteAppointment()
  const createPatient = useCreatePatient()
  const [error, setError] = React.useState<string | null>(null)
  const [showNewPatient, setShowNewPatient] = React.useState(false)
  const [newPatientName, setNewPatientName] = React.useState('')
  const [newPatientPhone, setNewPatientPhone] = React.useState('')

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

  const isPending = createPatient.isPending || createAppointment.isPending || updateAppointment.isPending

  const practitionerItems = React.useMemo(
    () => Object.fromEntries(practitioners.map((p) => [p.id, p.fullName])),
    [practitioners]
  )
  const procedureTypeItems = React.useMemo(
    () => Object.fromEntries(procedureTypes.map((pt) => [pt.id, pt.name])),
    [procedureTypes]
  )
  const endTimeItems = React.useMemo(
    () => Object.fromEntries(TIME_OPTIONS.filter((t) => t > startTime).map((t) => [t, t])),
    [startTime]
  )

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
      setShowNewPatient(false)
      setNewPatientName('')
      setNewPatientPhone('')
    }
  }, [open, appointment, defaultDate, defaultStartTime, defaultPractitionerId, practitioners])

  // Search patients via API
  React.useEffect(() => {
    if (patientSearch.length < 2) {
      setPatientOptions([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: patientSearch, limit: '20' })
        const res = await fetch(`/api/patients?${params}`)
        if (res.ok) {
          const json = await res.json()
          const data = json.data ?? json
          setPatientOptions(
            (data as { id: string; fullName: string; phone: string; cpf?: string | null }[]).map((p) => ({
              id: p.id,
              fullName: p.fullName,
              phone: p.phone,
              cpf: p.cpf,
            }))
          )
        }
      } catch {
        // ignore search errors
      }
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
    try {
      await updateAppointmentStatus.mutateAsync({ id: appointment.id, status })
      onSaved?.()
      onOpenChange(false)
    } catch {
      // error handled by mutation
    }
  }

  const handleDelete = async () => {
    if (!appointment) return
    if (!confirm('Tem certeza que deseja excluir este agendamento?')) return
    try {
      await deleteAppointmentMutation.mutateAsync(appointment.id)
      onSaved?.()
      onOpenChange(false)
    } catch {
      // error handled by mutation
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-charcoal">{isEditing ? 'Editar Agendamento' : 'Novo Agendamento'}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          const formData = new FormData(e.currentTarget)
          let patientId = selectedPatientId || null

          try {
            // Create patient inline if in new-patient mode
            if (showNewPatient && newPatientName.trim() && newPatientPhone.trim()) {
              const result = await createPatient.mutateAsync({
                fullName: newPatientName.trim(),
                phone: newPatientPhone.trim(),
              }) as { data: { id: string } }
              patientId = result.data.id
            }

            // Use bookingName for display: inline patient name, or typed search text when no patient selected
            const bookingName = showNewPatient && newPatientName.trim()
              ? newPatientName.trim()
              : !patientId && patientSearch.trim()
                ? patientSearch.trim()
                : selectedPatientName || undefined

            const data: Record<string, unknown> = {
              patientId,
              practitionerId,
              procedureTypeId: procedureTypeId || undefined,
              date,
              startTime,
              endTime,
              bookingName,
              notes: formData.get('notes') as string || undefined,
            }

            if (isEditing && appointment) {
              await updateAppointment.mutateAsync({ id: appointment.id, ...data })
            } else {
              await createAppointment.mutateAsync(data)
            }
            onSaved?.()
            onOpenChange(false)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao salvar agendamento')
          }
        }} className="grid gap-5" data-testid="appointment-form">
          {isEditing && <input type="hidden" name="id" value={appointment.id} />}

          {/* Patient search / quick create */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="patient-search" className="uppercase tracking-wider text-xs font-medium text-mid">Paciente</Label>
              {!showNewPatient && !selectedPatientId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-[#4A6B52]"
                  data-testid="appointment-new-patient"
                  onClick={() => setShowNewPatient(true)}
                >
                  <PlusIcon className="h-3 w-3" />
                  Novo paciente
                </Button>
              )}
            </div>
            {showNewPatient ? (
              <div className="rounded-lg border border-[#4A6B52]/30 bg-[#4A6B52]/5 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#4A6B52] uppercase tracking-wider">Novo Paciente</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-mid"
                    onClick={() => {
                      setShowNewPatient(false)
                      setNewPatientName('')
                      setNewPatientPhone('')
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Nome completo"
                    value={newPatientName}
                    onChange={(e) => setNewPatientName(e.target.value)}
                    autoFocus
                    required
                    data-testid="new-patient-name"
                  />
                  <Input
                    placeholder="(11) 99999-9999"
                    value={maskPhone(newPatientPhone)}
                    onChange={(e) => setNewPatientPhone(maskPhone(e.target.value))}
                    required
                    data-testid="new-patient-phone"
                  />
                </div>
              </div>
            ) : (
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
                {showPatientDropdown && patientSearch.length >= 2 && (
                  <div className="absolute top-full z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    {patientOptions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-muted"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setSelectedPatientId(p.id)
                          setSelectedPatientName(p.fullName)
                          setPatientSearch('')
                          setShowPatientDropdown(false)
                        }}
                      >
                        <span className="flex-1 text-left">{p.fullName}</span>
                        <span className="text-xs text-muted-foreground">{p.phone}</span>
                        {p.cpf && <span className="text-xs text-muted-foreground">{p.cpf}</span>}
                      </button>
                    ))}
                    {/* Quick create button */}
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 border-t px-3 py-2 text-sm font-medium text-[#4A6B52] hover:bg-muted"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setNewPatientName(patientSearch)
                        setShowNewPatient(true)
                        setShowPatientDropdown(false)
                        setPatientSearch('')
                      }}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Criar paciente &ldquo;{patientSearch}&rdquo;
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Practitioner */}
          <div className="grid gap-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Profissional</Label>
            <Select
              items={practitionerItems}
              value={practitionerId}
              onValueChange={(v) => v && setPractitionerId(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o profissional" />
              </SelectTrigger>
              <SelectContent />
            </Select>
            <input type="hidden" name="practitionerId" value={practitionerId} />
          </div>

          {/* Procedure type */}
          <div className="grid gap-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Tipo de Procedimento</Label>
            <Select
              items={procedureTypeItems}
              value={procedureTypeId}
              onValueChange={(v) => v && handleProcedureTypeChange(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione (opcional)" />
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
            <DatePicker
              value={date}
              onChange={(v) => setDate(v)}
            />
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Inicio</Label>
              <Select items={TIME_ITEMS} value={startTime} onValueChange={(v) => v && handleStartTimeChange(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <input type="hidden" name="startTime" value={startTime} />
            </div>
            <div className="grid gap-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Termino</Label>
              <Select items={endTimeItems} value={endTime} onValueChange={(v) => v && setEndTime(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <input type="hidden" name="endTime" value={endTime} />
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
                    <Select items={STATUS_LABELS} onValueChange={(v) => v && handleStatusChange(v as AppointmentStatus)}>
                      <SelectTrigger className="w-auto text-sm">
                        <SelectValue placeholder="Alterar status" />
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                    <Button type="button" variant="destructive" size="sm" onClick={handleDelete}>
                      Cancelar
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

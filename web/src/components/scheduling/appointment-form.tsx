'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import {
  useCreateAppointment,
  useUpdateAppointment,
  useUpdateAppointmentStatus,
  useDeleteAppointment,
} from '@/hooks/mutations/use-appointment-mutations'
import { useCreatePatient } from '@/hooks/mutations/use-patient-mutations'
import { useAppointmentStatusChange } from '@/hooks/mutations/use-appointment-status-change'
import { MoreHorizontalIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PatientPicker, resolvePatientChoice, type PatientChoice } from '@/components/scheduling/patient-picker'
import type { BookingDraft } from '@/components/scheduling/quick-book-card'
import { APPOINTMENT_STATUS_DOT, APPOINTMENT_STATUS_LABELS } from '@/lib/appointment-status'
import { SETTLED_STATUSES } from '@/lib/appointment-actions'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { AppointmentStatus } from '@/types'
import { START_TIMES, END_TIMES, timeItems } from '@/lib/time-options'
import { useTenant } from '@/hooks/queries/use-tenant'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'
import { canSendRescheduleNotice } from '@/validations/appointment'
import { brToday } from '@/lib/dates'
import type { RescheduleNotification } from '@/lib/whatsapp-reschedule'
import { RESCHEDULE_NOTICE_SENT, RESCHEDULE_NOTICE_TOASTS } from '@/lib/reschedule-notice-copy'

interface Practitioner {
  id: string
  fullName: string
}

interface ProcedureType {
  id: string
  name: string
  estimatedDurationMin: number | null
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
  defaultPatient?: { id: string; fullName: string }
  /** What the quick booking card already had filled in ("Mais opções"). */
  draft?: BookingDraft | null
  /** The role can read appointments but not change them (financial). */
  viewOnly?: boolean
}

const TIME_ITEMS = timeItems(START_TIMES)

const STATUS_SELECT_ITEMS: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries(APPOINTMENT_STATUS_LABELS).map(([key, label]) => [
    key,
    <span key={key} className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${APPOINTMENT_STATUS_DOT[key] ?? 'bg-slate-300'}`} />
      {label}
    </span>,
  ])
)

export const DEFAULT_START_TIME = '08:00'

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
  defaultPatient,
  draft,
  viewOnly = false,
}: AppointmentFormProps) {
  const isEditing = !!appointment
  // Read-only mode (subscription ended): an existing appointment opens for
  // reading only, every field and action disabled, so nothing can be saved
  // only to fail with a 402.
  const { readOnly: subscriptionReadOnly, openPaywall } = useSubscriptionAccess()
  const readOnly = subscriptionReadOnly || viewOnly
  const createAppointment = useCreateAppointment()
  const updateAppointment = useUpdateAppointment()
  const updateAppointmentStatus = useUpdateAppointmentStatus()
  const deleteAppointmentMutation = useDeleteAppointment()
  const createPatient = useCreatePatient()
  const { changeStatus, pendingIds } = useAppointmentStatusChange()
  const [error, setError] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  const initialPatient = (): PatientChoice | null => {
    if (appointment?.patientId) return { kind: 'existing', id: appointment.patientId, fullName: appointment.patientName ?? '' }
    // A phone here would register the online booker as a patient on every save; adding one is the user's call.
    if (appointment?.bookingName) return { kind: 'new', fullName: appointment.bookingName, phone: '' }
    if (appointment) return null
    if (defaultPatient?.id) return { kind: 'existing', id: defaultPatient.id, fullName: defaultPatient.fullName }
    return draft?.patient ?? null
  }
  const initialStart = () => appointment?.startTime.slice(0, 5) ?? draft?.startTime ?? (defaultStartTime || DEFAULT_START_TIME)
  const initialEnd = () => appointment?.endTime.slice(0, 5) ?? draft?.endTime ?? getDefaultEndTime(defaultStartTime || DEFAULT_START_TIME)

  const [patient, setPatient] = React.useState<PatientChoice | null>(initialPatient)
  const [practitionerId, setPractitionerId] = React.useState(
    appointment?.practitionerId ?? draft?.practitionerId ?? defaultPractitionerId ?? practitioners[0]?.id ?? ''
  )
  const [procedureTypeId, setProcedureTypeId] = React.useState(appointment?.procedureTypeId ?? draft?.procedureTypeId ?? '')
  const [date, setDate] = React.useState(appointment?.date ?? draft?.date ?? defaultDate ?? '')
  const [startTime, setStartTime] = React.useState(initialStart)
  const [endTime, setEndTime] = React.useState(initialEnd)

  const { data: tenant } = useTenant()
  const [notifyPatient, setNotifyPatient] = React.useState(true)
  const slotMoved =
    !!appointment &&
    (date !== appointment.date || startTime !== appointment.startTime.slice(0, 5))
  const canNotifyPatient =
    slotMoved && canSendRescheduleNotice(appointment.status, date, brToday()) && isWhatsAppEnabled(tenant?.settings)

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
    () => timeItems(END_TIMES.filter((t) => t > startTime)),
    [startTime]
  )

  // Reset form on open
  React.useEffect(() => {
    if (open) {
      setPatient(initialPatient())
      setPractitionerId(appointment?.practitionerId ?? draft?.practitionerId ?? defaultPractitionerId ?? practitioners[0]?.id ?? '')
      setProcedureTypeId(appointment?.procedureTypeId ?? draft?.procedureTypeId ?? '')
      setDate(appointment?.date ?? draft?.date ?? defaultDate ?? '')
      setStartTime(initialStart())
      setEndTime(initialEnd())
      setNotifyPatient(true)
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resets only when the dialog opens on new inputs
  }, [open, appointment, draft, defaultDate, defaultStartTime, defaultPractitionerId, practitioners])

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar o status')
    }
  }

  const handleCancelAppointment = () => {
    if (!appointment) return
    changeStatus(appointment, 'cancelled', () => {
      onSaved?.()
      onOpenChange(false)
    })
  }

  const handleDelete = async () => {
    if (!appointment) return
    try {
      await deleteAppointmentMutation.mutateAsync(appointment.id)
      setConfirmDelete(false)
      toast.success('Agendamento excluído')
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setConfirmDelete(false)
      setError(err instanceof Error ? err.message : 'Erro ao excluir')
    }
  }

  const fieldLabel = 'uppercase tracking-wider text-xs font-medium text-mid'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-charcoal">{readOnly ? 'Agendamento' : isEditing ? 'Editar agendamento' : 'Novo agendamento'}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 border border-red-100" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={async (e) => {
          e.preventDefault()
          if (readOnly) return
          setError(null)
          const formData = new FormData(e.currentTarget)

          try {
            const { patientId, bookingName } = await resolvePatientChoice(patient, (input) => createPatient.mutateAsync(input))
            // A retry after a refused slot must reuse the patient just registered, not register it again.
            if (patient?.kind === 'new' && patientId) setPatient({ kind: 'existing', id: patientId, fullName: bookingName ?? '' })

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
              const result = await updateAppointment.mutateAsync({
                id: appointment.id,
                ...data,
                notifyPatient: canNotifyPatient && notifyPatient,
              }) as { notification?: RescheduleNotification }
              if (result.notification === 'sent') {
                toast.success(RESCHEDULE_NOTICE_SENT)
              } else if (result.notification) {
                toast.warning(RESCHEDULE_NOTICE_TOASTS[result.notification])
              }
            } else {
              await createAppointment.mutateAsync(data)
            }
            onSaved?.()
            onOpenChange(false)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao salvar agendamento')
          }
        }} className="grid gap-5" data-testid="appointment-form">
          <fieldset disabled={readOnly} className="contents" data-testid="appointment-form-fields">
          {isEditing && <input type="hidden" name="id" value={appointment.id} />}

          <PatientPicker
            id="patient-search"
            value={patient}
            onChange={setPatient}
            locked={!!defaultPatient?.id && !isEditing}
            labelClassName={fieldLabel}
          />

          {/* Practitioner */}
          <div className="grid gap-2">
            <Label className={fieldLabel}>Profissional</Label>
            <Select
              items={practitionerItems}
              value={practitionerId}
              onValueChange={(v) => v && setPractitionerId(v)}
            >
              <SelectTrigger className="w-full" aria-label="Profissional">
                <SelectValue placeholder="Selecione o profissional" />
              </SelectTrigger>
              <SelectContent />
            </Select>
            <input type="hidden" name="practitionerId" value={practitionerId} />
          </div>

          {/* Procedure type */}
          <div className="grid gap-2">
            <Label className={fieldLabel}>Tipo de procedimento</Label>
            <Select
              items={procedureTypeItems}
              value={procedureTypeId}
              onValueChange={(v) => v && handleProcedureTypeChange(v)}
            >
              <SelectTrigger className="w-full" aria-label="Tipo de procedimento">
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
            <Label htmlFor="date" className={fieldLabel}>Data</Label>
            <DatePicker
              value={date}
              onChange={(v) => setDate(v)}
            />
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className={fieldLabel}>Início</Label>
              <Select items={TIME_ITEMS} value={startTime} onValueChange={(v) => v && handleStartTimeChange(v)}>
                <SelectTrigger className="w-full" aria-label="Início">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <input type="hidden" name="startTime" value={startTime} />
            </div>
            <div className="grid gap-2">
              <Label className={fieldLabel}>Término</Label>
              <Select items={endTimeItems} value={endTime} onValueChange={(v) => v && setEndTime(v)}>
                <SelectTrigger className="w-full" aria-label="Término">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <input type="hidden" name="endTime" value={endTime} />
            </div>
          </div>

          {canNotifyPatient && (
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={notifyPatient}
                onCheckedChange={(val) => setNotifyPatient(val === true)}
                className="mt-0.5"
                data-testid="appointment-notify-patient"
              />
              <span className="text-sm text-charcoal">
                Avisar o paciente da nova data por WhatsApp
              </span>
            </label>
          )}

          {/* Notes */}
          <div className="grid gap-2">
            <Label htmlFor="notes" className={fieldLabel}>Observações</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Observações sobre o agendamento..."
              defaultValue={appointment?.notes ?? ''}
              rows={3}
            />
          </div>

          </fieldset>

          {readOnly ? (
            <DialogFooter className="pt-2 border-t border-sage/10" data-testid="appointment-form-read-only">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-mid">
                  {subscriptionReadOnly ? 'Modo leitura: assine um plano para editar ou remarcar.' : 'Seu perfil pode ver este agendamento, mas não alterá-lo.'}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Fechar
                  </Button>
                  {subscriptionReadOnly && (
                    <Button
                      type="button"
                      className="bg-forest text-cream hover:bg-sage"
                      onClick={() => {
                        onOpenChange(false)
                        openPaywall()
                      }}
                    >
                      Ver planos
                    </Button>
                  )}
                </div>
              </div>
            </DialogFooter>
          ) : (
          <DialogFooter className="pt-2 border-t border-sage/10">
            <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {isEditing && (
                  <>
                    <Select items={STATUS_SELECT_ITEMS} value={appointment?.status} onValueChange={(v) => v && handleStatusChange(v as AppointmentStatus)}>
                      <SelectTrigger className="min-w-44 text-sm" aria-label="Status">
                        <SelectValue placeholder="Alterar status" />
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                    {!SETTLED_STATUSES.has(appointment.status) && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={pendingIds.has(appointment.id)}
                        onClick={handleCancelAppointment}
                        data-testid="appointment-cancel-status"
                      >
                        Cancelar agendamento
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" variant="ghost" size="icon" className="size-9 text-mid" aria-label="Mais opções do agendamento" />
                        }
                      >
                        <MoreHorizontalIcon className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuItem variant="destructive" className="min-h-10" onClick={() => setConfirmDelete(true)} data-testid="appointment-delete">
                          Excluir agendamento
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                  onClick={() => onOpenChange(false)}
                >
                  Fechar
                </Button>
                <Button type="submit" disabled={isPending} className="bg-forest text-cream hover:bg-sage transition-colors" data-testid="appointment-form-submit">
                  {isPending ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            </div>
          </DialogFooter>
          )}
        </form>
      </DialogContent>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir agendamento</DialogTitle>
            <DialogDescription>
              O agendamento some da agenda e dos relatórios. Para manter o histórico, use Cancelar agendamento.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>Voltar</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteAppointmentMutation.isPending}
              data-testid="confirm-delete-appointment"
            >
              {deleteAppointmentMutation.isPending ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

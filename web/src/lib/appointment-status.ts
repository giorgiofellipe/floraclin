import {
  CheckCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePlayIcon,
  CircleSlashIcon,
  RefreshCwIcon,
  UserXIcon,
  type LucideIcon,
} from 'lucide-react'

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em atendimento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
  pending_reschedule: 'Aguardando reagendamento',
}

export const APPOINTMENT_STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-blue-400',
  confirmed: 'bg-emerald-500',
  in_progress: 'bg-indigo-500',
  completed: 'bg-slate-300',
  cancelled: 'bg-red-300',
  no_show: 'bg-rose-600',
  pending_reschedule: 'bg-amber-400',
}

export const APPOINTMENT_STATUS_BORDER: Record<string, string> = {
  scheduled: 'border-l-blue-400',
  confirmed: 'border-l-emerald-500',
  in_progress: 'border-l-indigo-500',
  completed: 'border-l-slate-300',
  cancelled: 'border-l-red-300',
  no_show: 'border-l-rose-600',
  pending_reschedule: 'border-l-amber-400',
}

export const APPOINTMENT_STATUS_ICON: Record<string, { icon: LucideIcon; className: string }> = {
  scheduled: { icon: CircleDashedIcon, className: 'text-blue-500' },
  confirmed: { icon: CircleCheckIcon, className: 'text-emerald-600' },
  in_progress: { icon: CirclePlayIcon, className: 'text-indigo-600' },
  completed: { icon: CheckCheckIcon, className: 'text-slate-500' },
  cancelled: { icon: CircleSlashIcon, className: 'text-red-500' },
  no_show: { icon: UserXIcon, className: 'text-rose-600' },
  pending_reschedule: { icon: RefreshCwIcon, className: 'text-amber-600' },
}

/** Statuses the agenda shows; cancelled appointments are filtered out of it. */
export const AGENDA_LEGEND_STATUSES = ['scheduled', 'confirmed', 'in_progress', 'completed', 'no_show', 'pending_reschedule'] as const

/** The patient still has to attend, so the slot can move. */
export const MOVABLE_STATUSES = new Set(['scheduled', 'confirmed', 'pending_reschedule'])

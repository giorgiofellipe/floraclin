'use client'

import * as React from 'react'
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, BanIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { DayView } from '@/components/scheduling/day-view'
import { WeekView } from '@/components/scheduling/week-view'
import { MonthView } from '@/components/scheduling/month-view'
import { AppointmentForm, DEFAULT_START_TIME } from '@/components/scheduling/appointment-form'
import { AppointmentActionsMenu } from '@/components/scheduling/appointment-actions-menu'
import { AgendaEmptyState } from '@/components/scheduling/agenda-empty-state'
import { QuickBookCard, type BookingDraft } from '@/components/scheduling/quick-book-card'
import { ReschedulePicker } from '@/components/scheduling/reschedule-picker'
import { StatusIcon } from '@/components/scheduling/appointment-card'
import { CalendarBlockForm } from '@/components/scheduling/calendar-block-form'
import { CalendarBlockMenu } from '@/components/scheduling/calendar-block-menu'
import { DAY_SLOT_HEIGHT, GRID_END_MIN, GRID_START_MIN, WEEK_SLOT_HEIGHT, minutesToTop } from '@/components/scheduling/grid'
import { canDeleteBlock } from '@/lib/calendar-blocks'
import { toHhMm } from '@/lib/time-options'
import { useDeleteCalendarBlock } from '@/hooks/queries/use-calendar'
import { useAppointments } from '@/hooks/queries/use-appointments'
import { useTenant } from '@/hooks/queries/use-tenant'
import { useAppointmentStatusChange } from '@/hooks/mutations/use-appointment-status-change'
import { useMoveAppointment } from '@/hooks/mutations/use-move-appointment'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { toast } from 'sonner'
import { atendimentoHref, canWriteAppointments } from '@/lib/appointment-actions'
import { AGENDA_LEGEND_STATUSES, APPOINTMENT_STATUS_LABELS, MOVABLE_STATUSES } from '@/lib/appointment-status'
import { minutesOfDay, timeToMinutes, type WorkingHours } from '@/lib/free-slots'
import { nextFreeSlot } from '@/lib/agenda-slots'
import { useBookingUrl } from '@/hooks/use-booking-url'
import { toLocalYmd } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { CalendarBlockRow } from '@/db/queries/calendar'
import type { Role } from '@/types'
import { ReadOnlyGuard, useSubscriptionAccess } from '@/components/layout/subscription-access'

type ViewType = 'day' | 'week' | 'month'

interface Practitioner {
  id: string
  fullName: string
}

interface ProcedureType {
  id: string
  name: string
  estimatedDurationMin: number | null
}

interface CalendarViewProps {
  initialDate: string
  initialView: ViewType
  initialPractitionerId?: string
  practitioners: Practitioner[]
  procedureTypes: ProcedureType[]
  initialAppointments: AppointmentWithDetails[]
  calendarBlocks?: CalendarBlockRow[]
  autoOpenNew?: boolean
  autoOpenAppointmentId?: string
  defaultPatient?: { id: string; fullName: string }
  /** False until the clinic books its first appointment: the empty agenda leads there. */
  hasAnyAppointment?: boolean
  role: Role
  userId: string
}

function getDateRange(date: Date, view: ViewType) {
  switch (view) {
    case 'day':
      return {
        dateFrom: format(date, 'yyyy-MM-dd'),
        dateTo: format(date, 'yyyy-MM-dd'),
      }
    case 'week': {
      const ws = startOfWeek(date, { weekStartsOn: 1 })
      const we = endOfWeek(date, { weekStartsOn: 1 })
      return {
        dateFrom: format(ws, 'yyyy-MM-dd'),
        dateTo: format(we, 'yyyy-MM-dd'),
      }
    }
    case 'month': {
      const ms = startOfMonth(date)
      const me = endOfMonth(date)
      // Extend to full weeks for the calendar grid
      const calStart = startOfWeek(ms, { weekStartsOn: 1 })
      const calEnd = endOfWeek(me, { weekStartsOn: 1 })
      return {
        dateFrom: format(calStart, 'yyyy-MM-dd'),
        dateTo: format(calEnd, 'yyyy-MM-dd'),
      }
    }
  }
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function toolbarTitle(date: Date, view: ViewType, compact = false): string {
  if (view === 'day') return capitalizeFirst(format(date, compact ? "EEE, d 'de' MMMM" : "EEEE, d 'de' MMMM", { locale: ptBR }))
  if (view === 'week') {
    const ws = startOfWeek(date, { weekStartsOn: 1 })
    const we = endOfWeek(date, { weekStartsOn: 1 })
    return `${format(ws, "d 'de' MMM", { locale: ptBR })} - ${format(we, "d 'de' MMM", { locale: ptBR })}`
  }
  return capitalizeFirst(format(date, "MMMM 'de' yyyy", { locale: ptBR }))
}

const NAV_LABELS: Record<ViewType, [string, string]> = {
  day: ['Dia anterior', 'Próximo dia'],
  week: ['Semana anterior', 'Próxima semana'],
  month: ['Mês anterior', 'Próximo mês'],
}

// Scroll so the hour before now (or the first appointment, if earlier) sits at the top of the grid.
const SCROLL_LEAD_MIN = 60

interface QuickBookState {
  date: string
  startTime: string
  anchor: HTMLElement | null
  key: number
}

export function CalendarView({
  initialDate,
  initialView,
  initialPractitionerId,
  practitioners,
  procedureTypes,
  initialAppointments,
  calendarBlocks = [],
  autoOpenNew,
  autoOpenAppointmentId,
  defaultPatient,
  hasAnyAppointment = true,
  role,
  userId,
}: CalendarViewProps) {
  const router = useRouter()
  // Read-only mode: creating opens the paywall instead of a form whose save
  // would only fail with a 402. Opening an existing appointment stays allowed.
  const { readOnly, openPaywall } = useSubscriptionAccess()
  const deleteBlock = useDeleteCalendarBlock()
  const { changeStatus } = useAppointmentStatusChange()
  const { move, isMoving } = useMoveAppointment()
  const { data: tenant } = useTenant()
  const isMobile = useIsMobile()
  const canBook = canWriteAppointments(role)

  const [currentDate, setCurrentDate] = React.useState(new Date(initialDate + 'T12:00:00'))
  const [view, setView] = React.useState<ViewType>(initialView)
  const [practitionerId, setPractitionerId] = React.useState(initialPractitionerId ?? 'all')

  // Full form dialog state
  const [editingAppointment, setEditingAppointment] = React.useState<AppointmentWithDetails | null>(
    () => initialAppointments.find((a) => a.id === autoOpenAppointmentId) ?? null
  )
  // `?open=new` deep links (checklist, lifecycle email) open nothing in
  // read-only mode; an existing appointment still opens for reading.
  const [formOpen, setFormOpen] = React.useState((!!autoOpenNew && !readOnly) || !!editingAppointment)
  const [defaultFormDate, setDefaultFormDate] = React.useState<string>(autoOpenNew ? initialDate : '')
  const [defaultFormTime, setDefaultFormTime] = React.useState<string>('')
  const [draft, setDraft] = React.useState<BookingDraft | null>(null)

  const [quickBook, setQuickBook] = React.useState<QuickBookState | null>(null)
  const [quickBookOpen, setQuickBookOpen] = React.useState(false)
  const [menu, setMenu] = React.useState<{ appointment: AppointmentWithDetails; anchor: HTMLElement } | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [rescheduling, setRescheduling] = React.useState<AppointmentWithDetails | null>(null)

  // Block context menu state
  const [blockMenu, setBlockMenu] = React.useState<{
    block: CalendarBlockRow
    x: number
    y: number
  } | null>(null)
  const blockMenuRef = React.useRef<HTMLDivElement>(null)
  const [blockFormOpen, setBlockFormOpen] = React.useState(false)
  const canManageBlocks = role === 'owner' || role === 'practitioner'

  const practitionerFilterItems = React.useMemo(
    () => ({ all: 'Todos', ...Object.fromEntries(practitioners.map((p) => [p.id, p.fullName])) }),
    [practitioners]
  )
  const bookingPractitionerId =
    practitionerId !== 'all' ? practitionerId : (practitioners.find((p) => p.id === userId)?.id ?? practitioners[0]?.id ?? '')

  const { dateFrom, dateTo } = getDateRange(currentDate, view)
  const queryPractitionerId = practitionerId !== 'all' ? practitionerId : undefined

  const { data: allAppointments = initialAppointments, isLoading } = useAppointments(
    queryPractitionerId,
    dateFrom,
    dateTo
  )

  // Hide cancelled appointments from the calendar
  const appointments = React.useMemo<AppointmentWithDetails[]>(
    () => allAppointments.filter((a: AppointmentWithDetails) => a.status !== 'cancelled'),
    [allAppointments]
  )

  const workingHours = tenant?.workingHours as WorkingHours | null | undefined
  const bookingUrl = useBookingUrl()

  const updateUrl = React.useCallback(
    (d: Date, v: ViewType, p: string) => {
      const params = new URLSearchParams()
      params.set('date', format(d, 'yyyy-MM-dd'))
      params.set('view', v)
      if (p && p !== 'all') params.set('practitioner', p)
      router.replace(`/agenda?${params.toString()}`, { scroll: false })
    },
    [router]
  )

  const navigate = (direction: 'prev' | 'next') => {
    let newDate: Date
    switch (view) {
      case 'day':
        newDate = direction === 'next' ? addDays(currentDate, 1) : subDays(currentDate, 1)
        break
      case 'week':
        newDate = direction === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1)
        break
      case 'month':
        newDate = direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1)
        break
    }
    setCurrentDate(newDate)
    updateUrl(newDate, view, practitionerId)
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(today)
    updateUrl(today, view, practitionerId)
  }

  const changeView = (newView: ViewType) => {
    setView(newView)
    updateUrl(currentDate, newView, practitionerId)
  }

  const changePractitioner = (newPractitionerId: string) => {
    setPractitionerId(newPractitionerId)
    updateUrl(currentDate, view, newPractitionerId)
  }

  const openQuickBook = (date: string, startTime: string, anchor: HTMLElement | null) => {
    setMenuOpen(false)
    if (readOnly) {
      openPaywall()
      return
    }
    setQuickBook((prev) => ({ date, startTime, anchor, key: (prev?.key ?? 0) + 1 }))
    setQuickBookOpen(true)
  }

  // "+ Agendar" starts at the first free half hour of the booking practitioner, not a fixed 08:00.
  const handleNewAppointment = async (anchor: HTMLElement | null) => {
    if (readOnly) {
      openPaywall()
      return
    }
    const now = new Date()
    const local = nextFreeSlot({
      practitionerId: bookingPractitionerId,
      fromDate: view === 'month' ? format(currentDate, 'yyyy-MM-dd') : dateFrom,
      toDate: dateTo,
      now: { ymd: toLocalYmd(now), minutes: minutesOfDay(now) },
      appointments,
      blocks: calendarBlocks,
      workingHours,
    })
    const today = toLocalYmd(now)
    const viewed = format(currentDate, 'yyyy-MM-dd')
    // The loaded days are full or closed: ask the server, which sees the days after them too.
    const slot =
      local ??
      (await fetch(`/api/appointments/next-free-slot?practitionerId=${bookingPractitionerId}&from=${dateTo}`)
        .then((res) => (res.ok ? res.json() : { data: null }))
        .then((body: { data: { date: string; startTime: string } | null }) => body.data)
        .catch(() => null))
    openQuickBook(slot?.date ?? (viewed < today ? today : viewed), slot?.startTime ?? DEFAULT_START_TIME, anchor)
  }

  const openFullForm = (nextDraft: BookingDraft | null) => {
    setQuickBookOpen(false)
    setEditingAppointment(null)
    setDraft(nextDraft)
    setDefaultFormDate(nextDraft?.date ?? '')
    setDefaultFormTime(nextDraft?.startTime ?? '')
    setFormOpen(true)
  }

  const openEdit = (appointment: AppointmentWithDetails) => {
    setEditingAppointment(appointment)
    setDraft(null)
    setDefaultFormDate('')
    setDefaultFormTime('')
    setFormOpen(true)
  }

  const handleAppointmentClick = React.useCallback((appointment: AppointmentWithDetails, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    setBlockMenu(null)
    setMenu({ appointment, anchor: event.currentTarget })
    setMenuOpen(true)
  }, [])

  const handleStart = (appointment: AppointmentWithDetails) =>
    changeStatus(appointment, 'in_progress', () => router.push(atendimentoHref(appointment)))

  const canDrag = React.useCallback(
    (appointment: AppointmentWithDetails) => canBook && !readOnly && MOVABLE_STATUSES.has(appointment.status) && !isMoving(appointment.id),
    [canBook, readOnly, isMoving],
  )

  const handleBlockClick = React.useCallback((block: CalendarBlockRow, event: React.MouseEvent) => {
    setMenuOpen(false)
    setBlockMenu({
      block,
      x: event.clientX,
      y: event.clientY,
    })
  }, [])

  const [blockToDelete, setBlockToDelete] = React.useState<CalendarBlockRow | null>(null)

  const handleBlockDelete = React.useCallback(() => {
    if (!blockMenu) return
    setBlockMenu(null)
    if (readOnly) {
      openPaywall()
      return
    }
    setBlockToDelete(blockMenu.block)
  }, [blockMenu, readOnly, openPaywall])

  const handleConfirmBlockDelete = React.useCallback(async () => {
    if (!blockToDelete) return
    try {
      await deleteBlock.mutateAsync(blockToDelete.id)
      toast.success('Bloqueio removido')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover')
    }
    setBlockToDelete(null)
  }, [blockToDelete, deleteBlock])

  // Dismiss the block menu on outside click
  React.useEffect(() => {
    if (!blockMenu) return
    const dismiss = (e: MouseEvent) => {
      if (blockMenuRef.current && !blockMenuRef.current.contains(e.target as Node)) setBlockMenu(null)
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [blockMenu])

  const handleDayClick = (dateStr: string) => {
    const newDate = new Date(dateStr + 'T12:00:00')
    setCurrentDate(newDate)
    setView('day')
    updateUrl(newDate, 'day', practitionerId)
  }

  const handleFormOpenChange = React.useCallback((open: boolean) => {
    setFormOpen(open)
    if (!open) {
      setEditingAppointment(null)
      setDraft(null)
    }
  }, [])

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const scrolledFor = React.useRef<string | null>(null)

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    const key = `${view}:${dateFrom}:${practitionerId}`
    if (!el || isLoading || view === 'month' || scrolledFor.current === key) return
    scrolledFor.current = key
    const now = new Date()
    const today = toLocalYmd(now)
    const candidates = appointments.map((a) => timeToMinutes(a.startTime))
    const nowMinutes = minutesOfDay(now)
    if (today >= dateFrom && today <= dateTo && nowMinutes >= GRID_START_MIN && nowMinutes <= GRID_END_MIN) candidates.push(nowMinutes)
    const target = candidates.length > 0 ? Math.min(...candidates) - SCROLL_LEAD_MIN : timeToMinutes(DEFAULT_START_TIME)
    // A few pixels of the row above keep the hour label clear of the sticky day header.
    el.scrollTop = Math.max(0, minutesToTop(target, view === 'day' ? DAY_SLOT_HEIGHT : WEEK_SLOT_HEIGHT) - 12)
  }, [view, dateFrom, dateTo, practitionerId, isLoading, appointments])

  const emptyState =
    canBook && !isLoading && appointments.length === 0 ? (
      <AgendaEmptyState
        firstAppointment={!hasAnyAppointment}
        scope={view}
        bookingUrl={bookingUrl}
        onSchedule={(anchor) => void handleNewAppointment(anchor)}
      />
    ) : null

  const navButton = 'rounded-full text-mid hover:bg-petal hover:text-forest transition-colors max-md:size-11'

  return (
    <div className="flex h-full flex-col gap-3 md:gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-1 md:gap-3">
          <Button variant="outline" size="sm" className="border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors max-md:h-11 max-md:px-3" onClick={goToToday}>
            Hoje
          </Button>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" className={navButton} onClick={() => navigate('prev')} aria-label={NAV_LABELS[view][0]} data-testid="calendar-date-prev">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" className={navButton} onClick={() => navigate('next')} aria-label={NAV_LABELS[view][1]} data-testid="calendar-date-next">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <h2 className="truncate text-base font-semibold tracking-tight text-charcoal md:text-lg" data-testid="calendar-title">
            {toolbarTitle(currentDate, view, isMobile)}
          </h2>
        </div>

        <div className="flex w-full items-center gap-2 md:w-auto md:gap-3">
          <Select items={practitionerFilterItems} value={practitionerId} onValueChange={(v) => v && changePractitioner(v)}>
            <SelectTrigger className="min-w-0 flex-1 border-sage/20 max-md:h-11 md:w-auto md:min-w-[140px] md:flex-none" aria-label="Profissional">
              <SelectValue placeholder="Profissional" />
            </SelectTrigger>
            <SelectContent />
          </Select>

          <div className="flex shrink-0 rounded-full bg-topbar-border p-0.5" role="group" aria-label="Visualização" data-testid="calendar-view-toggle">
            {([
              ['day', 'Dia'],
              ['week', 'Semana'],
              ['month', 'Mês'],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 max-md:h-11 md:px-4 md:text-sm',
                  view === v ? 'bg-white text-forest shadow-sm' : 'text-mid hover:text-forest',
                )}
                onClick={() => changeView(v)}
              >
                {label}
              </button>
            ))}
          </div>

          {canManageBlocks && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors max-md:size-11"
              onClick={() => (readOnly ? openPaywall() : setBlockFormOpen(true))}
              data-testid="calendar-new-block"
              aria-label="Bloquear horário"
            >
              <BanIcon className="size-4" />
              <span className="hidden md:inline">Bloquear</span>
            </Button>
          )}
          {canBook && (
            <ReadOnlyGuard label="Agendar" className="shrink-0 max-md:hidden">
              <Button
                size="sm"
                className="shrink-0 max-md:hidden bg-forest text-cream hover:bg-sage transition-colors"
                onClick={(e) => void handleNewAppointment(e.currentTarget)}
                data-testid="calendar-new-appointment"
              >
                <Plus className="size-4" />
                Agendar
              </Button>
            </ReadOnlyGuard>
          )}
        </div>
      </div>

      {/* Calendar content */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-auto rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]" data-testid="calendar-scroll">
          {isLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
              <div className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 shadow-sm">
                <div className="size-2 animate-pulse rounded-full bg-sage" />
                <p className="text-sm font-medium text-forest">Carregando...</p>
              </div>
            </div>
          )}

          {view === 'day' && (
            <DayView
              date={currentDate}
              appointments={appointments}
              calendarBlocks={calendarBlocks}
              workingHours={workingHours}
              canDrag={canDrag}
              onMove={move}
              onSlotClick={canBook ? openQuickBook : undefined}
              onAppointmentClick={handleAppointmentClick}
              onBlockClick={handleBlockClick}
            />
          )}

          {view === 'week' && (
            <WeekView
              date={currentDate}
              appointments={appointments}
              calendarBlocks={calendarBlocks}
              workingHours={workingHours}
              canDrag={canDrag}
              onMove={move}
              onSlotClick={canBook ? openQuickBook : undefined}
              onAppointmentClick={handleAppointmentClick}
              onBlockClick={handleBlockClick}
            />
          )}

          {view === 'month' && (
            <MonthView
              date={currentDate}
              appointments={appointments}
              calendarBlocks={calendarBlocks}
              onDayClick={handleDayClick}
              onAppointmentClick={openEdit}
              onBlockClick={handleBlockClick}
            />
          )}
        </div>

        {/* Centered over the grid; the grid stays tappable around the card. */}
        {emptyState && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-4">
            <div className="pointer-events-auto">{emptyState}</div>
          </div>
        )}
      </div>

      {canBook && (
        <ReadOnlyGuard label="Agendar" className="md:hidden">
          <button
            type="button"
            className="fixed right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-forest text-cream shadow-lg transition-transform duration-150 active:scale-95 md:hidden"
            onClick={(e) => void handleNewAppointment(e.currentTarget)}
            aria-label="Agendar"
            data-testid="calendar-fab"
          >
            <Plus className="size-6" />
          </button>
        </ReadOnlyGuard>
      )}

      <AppointmentActionsMenu
        open={menuOpen}
        appointment={menu?.appointment ?? null}
        anchor={menu?.anchor ?? null}
        role={role}
        onClose={() => setMenuOpen(false)}
        onStatus={changeStatus}
        onStart={handleStart}
        onReschedule={setRescheduling}
        onEdit={openEdit}
        onCancel={(a) => changeStatus(a, 'cancelled')}
        onNewHere={(a, anchor) => openQuickBook(a.date, a.startTime.slice(0, 5), anchor)}
      />

      <ReschedulePicker key={rescheduling?.id} appointment={rescheduling} onClose={() => setRescheduling(null)} onOtherTime={openEdit} />

      {quickBook && (
        <QuickBookCard
          key={quickBook.key}
          open={quickBookOpen}
          onOpenChange={setQuickBookOpen}
          anchor={quickBook.anchor}
          date={quickBook.date}
          startTime={quickBook.startTime}
          defaultPractitionerId={bookingPractitionerId}
          practitioners={practitioners}
          procedureTypes={procedureTypes}
          onMoreOptions={openFullForm}
        />
      )}

      {blockMenu && (
        <CalendarBlockMenu
          block={blockMenu.block}
          position={{ x: blockMenu.x, y: blockMenu.y }}
          canDelete={canDeleteBlock(blockMenu.block, role, userId)}
          onDelete={handleBlockDelete}
          menuRef={blockMenuRef}
        />
      )}

      <Dialog open={blockToDelete !== null} onOpenChange={(open) => !open && setBlockToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover bloqueio</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover o bloqueio de{' '}
              <strong>{blockToDelete?.practitionerName ?? 'Toda a clínica'}</strong>
              {' '}em {blockToDelete?.date ? format(new Date(blockToDelete.date + 'T12:00:00'), "d 'de' MMMM", { locale: ptBR }) : ''}
              {blockToDelete?.allDay ? ' (dia inteiro)' : ` às ${toHhMm(blockToDelete?.startTime ?? '')}`}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Voltar</DialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirmBlockDelete}
              disabled={deleteBlock.isPending}
              data-testid="confirm-delete-block"
            >
              {deleteBlock.isPending ? 'Removendo...' : 'Remover bloqueio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppointmentForm
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        appointment={editingAppointment}
        practitioners={practitioners}
        procedureTypes={procedureTypes}
        defaultDate={defaultFormDate}
        defaultStartTime={defaultFormTime}
        defaultPractitionerId={bookingPractitionerId || undefined}
        defaultPatient={defaultPatient}
        draft={draft}
        viewOnly={!canBook}
      />

      {canManageBlocks && (
        <CalendarBlockForm
          open={blockFormOpen}
          onOpenChange={setBlockFormOpen}
          practitioners={practitioners}
          canBlockClinic={role === 'owner'}
          lockedPractitionerId={role === 'practitioner' ? userId : undefined}
          defaultPractitionerId={practitionerId === 'all' ? userId : practitionerId}
          defaultDate={format(currentDate, 'yyyy-MM-dd')}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-1 max-md:pb-16">
        {AGENDA_LEGEND_STATUSES.map((status) => (
          <span key={status} className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-mid">
            <StatusIcon status={status} className="size-3" />
            {APPOINTMENT_STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  )
}

'use client'

import * as React from 'react'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { droppedSlot, type Snapped } from '@/components/scheduling/grid'
import { cn } from '@/lib/utils'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { Slot } from '@/hooks/mutations/use-move-appointment'

interface Geometry {
  slotHeight: number
  /** The day columns, left to right; the day view has one. */
  days: string[]
  /** Width of one day column, read at drag time; null when the view has a single day. */
  columnWidth: (() => number) | null
}

function snap({ x, y }: { x: number; y: number }, geometry: Geometry): Snapped {
  const width = geometry.columnWidth?.() ?? 0
  return {
    dayOffset: width > 0 ? Math.round(x / width) : 0,
    slotOffset: Math.round(y / geometry.slotHeight),
  }
}

const DndGeometry = React.createContext<(Geometry & { recentlyDragged: () => boolean }) | null>(null)

const CLICK_AFTER_DRAG_MS = 250
// A mouse drag starts after a short move so clicks still open the menu; a touch drag needs a long
// press so a swipe still scrolls the grid.
const MOUSE_DRAG_DISTANCE_PX = 6
const TOUCH_DRAG_DELAY_MS = 300
const TOUCH_DRAG_TOLERANCE_PX = 8

/** Drag to move appointments on the grid, snapping to day columns and half hours. */
export function AgendaDnd({
  geometry,
  onMove,
  children,
}: {
  geometry: Geometry
  onMove: (appointment: AppointmentWithDetails, slot: Slot) => void
  children: React.ReactNode
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_DRAG_DISTANCE_PX } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TOUCH_DRAG_DELAY_MS, tolerance: TOUCH_DRAG_TOLERANCE_PX } }),
  )
  const lastDragEnd = React.useRef(0)
  const [dragging, setDragging] = React.useState(false)

  // A touch drag must not also scroll the grid under the finger.
  React.useEffect(() => {
    if (!dragging) return
    const block = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [dragging])

  const snapModifier = React.useCallback<Modifier>(
    ({ transform }) => {
      const { dayOffset, slotOffset } = snap(transform, geometry)
      return { ...transform, x: dayOffset * (geometry.columnWidth?.() ?? 0), y: slotOffset * geometry.slotHeight }
    },
    [geometry],
  )

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(false)
    lastDragEnd.current = Date.now()
    const appointment = event.active.data.current?.appointment as AppointmentWithDetails | undefined
    if (!appointment) return
    const slot = droppedSlot(appointment, snap(event.delta, geometry), geometry.days)
    if (slot) onMove(appointment, slot)
  }

  const value = React.useMemo(
    () => ({ ...geometry, recentlyDragged: () => Date.now() - lastDragEnd.current < CLICK_AFTER_DRAG_MS }),
    [geometry],
  )

  return (
    <DndGeometry.Provider value={value}>
      <DndContext
        sensors={sensors}
        modifiers={[snapModifier]}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={handleDragEnd}
      >
        {children}
      </DndContext>
    </DndGeometry.Provider>
  )
}

/** Wraps a positioned grid card so it can be dragged; shows the snapped start time while moving. */
export function DraggableAppointment({
  appointment,
  disabled,
  className,
  style,
  children,
}: {
  appointment: AppointmentWithDetails
  disabled: boolean
  className?: string
  style: React.CSSProperties
  children: React.ReactNode
}) {
  const geometry = React.useContext(DndGeometry)
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({
    id: appointment.id,
    data: { appointment },
    disabled,
  })

  const preview = isDragging && transform && geometry ? droppedSlot(appointment, snap(transform, geometry), geometry.days) : null

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onClickCapture={(e) => {
        if (geometry?.recentlyDragged()) e.stopPropagation()
      }}
      className={cn(className, !disabled && 'touch-manipulation', isDragging && 'z-40 cursor-grabbing opacity-90 shadow-lg')}
      style={{ ...style, transform: CSS.Translate.toString(transform) }}
      data-dragging={isDragging || undefined}
    >
      {children}
      {preview && (
        <span className="pointer-events-none absolute -top-6 left-0 rounded-md bg-forest px-1.5 py-0.5 text-[11px] font-medium text-cream tabular-nums shadow">
          {preview.startTime}
        </span>
      )}
    </div>
  )
}

import type { AppointmentWithDetails } from '@/db/queries/appointments'
import { minutesToTime, timeToMinutes } from '@/lib/free-slots'

export const GRID_START_HOUR = 7
export const GRID_END_HOUR = 20
export const GRID_SLOT_MIN = 30
export const DAY_SLOT_HEIGHT = 48
export const WEEK_SLOT_HEIGHT = 40
export const GRID_HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR + 1 }, (_, i) => GRID_START_HOUR + i)
export const GRID_START_MIN = GRID_START_HOUR * 60
export const GRID_END_MIN = (GRID_END_HOUR + 1) * 60

export function minutesToTop(minutes: number, slotHeight: number): number {
  return ((minutes - GRID_START_MIN) / GRID_SLOT_MIN) * slotHeight
}

/** Keeps a moved slot of `duration` minutes inside the visible grid. */
export function clampToGrid(startMin: number, duration: number): number {
  return Math.min(Math.max(startMin, GRID_START_MIN), GRID_END_MIN - duration)
}

export interface LayoutSlot {
  appointment: AppointmentWithDetails
  top: number
  height: number
  column: number
  /** How many columns the card spans: it widens over neighbour columns that are free at its time. */
  span: number
  totalColumns: number
}

/**
 * Overlapping appointments split the width into columns. A card then widens to
 * the right across every column that has nothing at its time, so only cards
 * that really overlap stay narrow.
 */
export function computeOverlapLayout(appointments: AppointmentWithDetails[], slotHeight: number): LayoutSlot[] {
  const sorted = [...appointments].sort((a, b) => {
    const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
    return diff !== 0 ? diff : timeToMinutes(b.endTime) - timeToMinutes(a.endTime)
  })

  const result: LayoutSlot[] = []
  let cluster: { appt: AppointmentWithDetails; start: number; end: number; column: number }[] = []
  let columnEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    const total = columnEnds.length
    for (const item of cluster) {
      let span = 1
      for (let col = item.column + 1; col < total; col++) {
        const blocked = cluster.some((o) => o.column === col && o.start < item.end && o.end > item.start)
        if (blocked) break
        span++
      }
      result.push({
        appointment: item.appt,
        top: minutesToTop(item.start, slotHeight),
        height: Math.max(((item.end - item.start) / GRID_SLOT_MIN) * slotHeight, slotHeight / 2),
        column: item.column,
        span,
        totalColumns: total,
      })
    }
    cluster = []
    columnEnds = []
  }

  for (const appt of sorted) {
    const start = timeToMinutes(appt.startTime)
    const end = timeToMinutes(appt.endTime)
    if (cluster.length > 0 && start >= clusterEnd) flush()
    let column = columnEnds.findIndex((colEnd) => start >= colEnd)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(end)
    } else {
      columnEnds[column] = end
    }
    cluster.push({ appt, start, end, column })
    clusterEnd = cluster.length === 1 ? end : Math.max(clusterEnd, end)
  }
  if (cluster.length > 0) flush()

  return result
}

export interface Snapped {
  dayOffset: number
  slotOffset: number
}

/** Where a drag by `snapped` puts `appointment`, kept inside the visible days and hours. */
export function droppedSlot(appointment: AppointmentWithDetails, snapped: Snapped, days: string[]): { date: string; startTime: string; endTime: string } | null {
  const fromDay = days.indexOf(appointment.date)
  if (fromDay === -1) return null
  const dayIndex = Math.min(Math.max(fromDay + snapped.dayOffset, 0), days.length - 1)
  const start = timeToMinutes(appointment.startTime)
  const duration = timeToMinutes(appointment.endTime) - start
  const newStart = clampToGrid(start + snapped.slotOffset * GRID_SLOT_MIN, duration)
  const slot = { date: days[dayIndex], startTime: minutesToTime(newStart), endTime: minutesToTime(newStart + duration) }
  const unchanged = slot.date === appointment.date && slot.startTime === appointment.startTime.slice(0, 5)
  return unchanged ? null : slot
}


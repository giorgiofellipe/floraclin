import { DEFAULT_WORKING_HOURS } from '@/lib/constants'
import { parseBrDate } from '@/lib/dates'

export interface WorkingHoursDay {
  start: string
  end: string
  enabled: boolean
}

export type WorkingHours = Record<string, WorkingHoursDay>

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The clinic's opening window on a BR calendar day, in minutes, or null when closed. */
export function openingWindow(
  ymd: string,
  workingHours: WorkingHours | null | undefined,
): { start: number; end: number } | null {
  const hours = (workingHours ?? DEFAULT_WORKING_HOURS) as WorkingHours
  // BR noon is the same weekday on any host timezone.
  const day = hours[DAY_KEYS[parseBrDate(ymd, '12:00:00').getUTCDay()]]
  if (!day?.enabled) return null
  return { start: timeToMinutes(day.start), end: timeToMinutes(day.end) }
}

export interface Interval {
  start: number
  end: number
}

const WHOLE_DAY: Interval = { start: 0, end: 24 * 60 }

/** The minutes a calendar block takes; an all-day block (or one without times) takes the whole day. */
export function blockInterval(block: { allDay: boolean; startTime: string | null; endTime: string | null }): Interval {
  if (block.allDay || !block.startTime || !block.endTime) return WHOLE_DAY
  return { start: timeToMinutes(block.startTime), end: timeToMinutes(block.endTime) }
}

/** The parts of `opening` that no busy interval covers, in order. */
export function freeGaps(opening: Interval, busy: Interval[]): Interval[] {
  const sorted = busy.filter((b) => b.end > opening.start && b.start < opening.end).sort((a, b) => a.start - b.start)
  const gaps: Interval[] = []
  let cursor = opening.start
  for (const b of sorted) {
    if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, opening.end) })
    cursor = Math.max(cursor, b.end)
    if (cursor >= opening.end) break
  }
  if (cursor < opening.end) gaps.push({ start: cursor, end: opening.end })
  return gaps
}

/** First `duration`-minute slot on the half-hour grid inside a gap that starts no earlier than `from`. */
export function firstFreeSlot(gaps: Interval[], from: number, duration: number, step = 30): number | null {
  for (const gap of gaps) {
    const earliest = Math.max(gap.start, from)
    const start = Math.ceil(earliest / step) * step
    if (start + duration <= gap.end) return start
  }
  return null
}

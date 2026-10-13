export function halfHourTimes(fromHour: number, toHour: number): string[] {
  const out: string[] = []
  for (let h = fromHour; h <= toHour; h++) {
    for (const m of [0, 30]) {
      if (h === toHour && m === 30) break
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return out
}

/** Postgres `time` columns come back as HH:MM:SS; the app compares HH:MM. */
export const toHhMm = (t: string) => t.slice(0, 5)

export function timeItems(times: string[]): Record<string, string> {
  return Object.fromEntries(times.map((t) => [t, t]))
}

const SCHEDULE_GRID = halfHourTimes(7, 21)
export const START_TIMES = SCHEDULE_GRID.slice(0, -1)
export const END_TIMES = SCHEDULE_GRID.slice(1)

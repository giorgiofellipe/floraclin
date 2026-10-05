import { vi } from 'vitest'
import { after } from 'next/server'

/** Runs every task the route registered with the mocked after(), in order. */
export async function flushAfter() {
  for (const [task] of vi.mocked(after).mock.calls) {
    await (typeof task === 'function' ? task() : task)
  }
}

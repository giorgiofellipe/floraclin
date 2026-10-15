import { describe, expect, it } from 'vitest'

import { countPendingSessions, parseEncounterPickerSlice } from '../encounter-view'

describe('service wizard encounter view helpers', () => {
  it('parses the wrapped encounter view response', () => {
    const view = parseEncounterPickerSlice({
      success: true,
      data: {
        records: [
          {
            id: 'rec-1',
            sessionsTotal: 3,
            sessions: [{ id: 'sess-1' }],
          },
        ],
        package: null,
      },
    })

    expect(view.records).toHaveLength(1)
    expect(countPendingSessions(view)).toBe(2)
  })

  it('rejects an API error response without records', () => {
    expect(() => parseEncounterPickerSlice({ success: false, error: 'Not found' })).toThrow(
      'Encounter view: unexpected response shape',
    )
  })

  it('does not throw while counting if records is missing', () => {
    expect(
      countPendingSessions({
        package: null,
      } as unknown as Parameters<typeof countPendingSessions>[0]),
    ).toBe(0)
  })

  it('does not block finalization for closed packages', () => {
    expect(
      countPendingSessions({
        records: [
          {
            id: 'rec-1',
            sessionsTotal: 3,
            sessions: [],
          },
        ],
        package: {
          status: 'completed',
          closedAt: null,
        },
      }),
    ).toBe(0)
  })
})

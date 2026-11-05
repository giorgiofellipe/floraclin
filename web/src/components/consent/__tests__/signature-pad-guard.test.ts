import { describe, it, expect, vi } from 'vitest'
import { installStrokeDataGuard, type StrokeGuardPad } from '../signature-pad-guard'

function createPad(data: unknown[][] = []): StrokeGuardPad & { _data: unknown[][] } {
  const pad: StrokeGuardPad & { _data: unknown[][] } = {
    _data: data,
    _strokeBegin: vi.fn((event: unknown) => {
      pad._data.push([])
      // signature_pad 2.3.2 then records the first point on this group
      pad._data[pad._data.length - 1]?.push(event)
    }),
    _strokeMoveUpdate: vi.fn((event: unknown) => {
      pad._data[pad._data.length - 1]?.push(event)
    }),
  }
  return pad
}

describe('installStrokeDataGuard', () => {
  it('restarts the stroke instead of pushing onto a missing group', () => {
    const pad = createPad([])
    const originalMove = pad._strokeMoveUpdate
    installStrokeDataGuard(pad)

    pad._strokeMoveUpdate({ clientX: 10, clientY: 20 })

    expect(pad._strokeBegin).toHaveBeenCalledTimes(1)
    expect(originalMove).not.toHaveBeenCalled()
    expect(pad._data).toHaveLength(1)
  })

  it('leaves an in-progress stroke on the original move handler', () => {
    const pad = createPad([[{ x: 1, y: 1 }]])
    const originalMove = pad._strokeMoveUpdate
    installStrokeDataGuard(pad)

    pad._strokeMoveUpdate({ clientX: 12, clientY: 8 })

    expect(pad._strokeBegin).not.toHaveBeenCalled()
    expect(originalMove).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the original move handler would push on undefined', () => {
    const pad = createPad([])
    pad._strokeMoveUpdate = vi.fn(() => {
      const group = pad._data[pad._data.length - 1] as
        | { push: (p: unknown) => void }
        | undefined
      group!.push({ x: 1, y: 1 })
    })
    installStrokeDataGuard(pad)

    expect(() => pad._strokeMoveUpdate({ clientX: 4, clientY: 5 })).not.toThrow()
  })
})

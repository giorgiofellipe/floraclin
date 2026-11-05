/**
 * signature_pad 2.3.2's `_strokeUpdate` does
 * `this._data[this._data.length - 1].push(...)` with no empty check.
 * `clear()` / `fromData()` mid-stroke, or a `touchmove` without `touchstart`
 * (palm + finger on tablets), leaves `_data` empty and every subsequent
 * move throws (FLORACLIN-1X).
 */
export type StrokeGuardPad = {
  _data?: unknown[][]
  _strokeBegin: (event: unknown) => void
  _strokeMoveUpdate: (event: unknown) => void
}

export function installStrokeDataGuard(pad: object): () => void {
  const guarded = pad as StrokeGuardPad
  const originalMoveUpdate = guarded._strokeMoveUpdate

  guarded._strokeMoveUpdate = (event: unknown) => {
    if (!guarded._data || guarded._data.length === 0) {
      guarded._strokeBegin(event)
      return
    }
    originalMoveUpdate.call(guarded, event)
  }

  return () => {
    guarded._strokeMoveUpdate = originalMoveUpdate
  }
}

import { describe, it, expect, expectTypeOf } from 'vitest'
import type { DeliveredVia } from '../clinical-documents'

// `delivered_via` is now a two-state column: `'pending'` until the document
// is sent via WhatsApp, then `'whatsapp'`. The original multi-channel state
// machine (print/download/multiple) was removed — preview/download aren't
// real "delivered to patient" events.
describe('DeliveredVia', () => {
  it('is exactly the two-state union', () => {
    expectTypeOf<DeliveredVia>().toEqualTypeOf<'pending' | 'whatsapp'>()
  })

  it('does not include the legacy print/download/multiple variants', () => {
    // @ts-expect-error — 'print' is no longer a valid DeliveredVia
    const _print: DeliveredVia = 'print'
    // @ts-expect-error — 'download' is no longer a valid DeliveredVia
    const _download: DeliveredVia = 'download'
    // @ts-expect-error — 'multiple' is no longer a valid DeliveredVia
    const _multiple: DeliveredVia = 'multiple'
    void _print
    void _download
    void _multiple
    expect(true).toBe(true)
  })
})

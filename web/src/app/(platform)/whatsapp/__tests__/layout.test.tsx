/**
 * interactive-widget=resizes-content applies to the inbox only. App-wide it
 * lifts fixed bottom bars over the field being typed in on Android, so the root
 * viewport must not carry it; Next merges the segment's on top of the root's.
 */
import { describe, it, expect, vi } from 'vitest'
import { viewport as whatsappViewport } from '../layout'
import { viewport as rootViewport } from '../../../layout'

vi.mock('next/font/google', () => ({
  Jost: () => ({ variable: '' }),
  Cormorant_Garamond: () => ({ variable: '' }),
}))

describe('WhatsApp segment viewport', () => {
  it('resizes the content for the on-screen keyboard on /whatsapp', () => {
    expect(whatsappViewport).toEqual({ interactiveWidget: 'resizes-content' })
  })

  it('is not set app-wide, while the root keeps viewport-fit=cover', () => {
    expect(rootViewport).not.toHaveProperty('interactiveWidget')
    expect(rootViewport).toMatchObject({ viewportFit: 'cover' })
  })
})

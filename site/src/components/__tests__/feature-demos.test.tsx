/**
 * Guards the demo motion contract.
 *
 * These demos are remounted when their tab activates and live ~6s, so they
 * must play once and hold. The structural assertions below exist to stop a
 * future edit from silently reintroducing the looping/reset-flash behaviour
 * the demos used to have: a 4s infinite loop that faded the whole scene back
 * to zero and restarted, so the showcase usually showed a half-erased frame.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { ComponentType } from 'react'

import { CrmDemo } from '../feature-demos-crm'
import { FinancialDemo, CalendarDemo } from '../feature-demos-business'
import {
  FaceDiagramDemo,
  BeforeAfterDemo,
  GuidedCaptureDemo,
} from '../feature-demos-clinical'
import {
  GuidedFlowDemo,
  DigitalSignatureDemo,
  ConfirmationDemo,
  SelfServiceDemo,
} from '../feature-demos-flow'

const DEMOS: [string, ComponentType][] = [
  ['FaceDiagramDemo', FaceDiagramDemo],
  ['BeforeAfterDemo', BeforeAfterDemo],
  ['GuidedCaptureDemo', GuidedCaptureDemo],
  ['GuidedFlowDemo', GuidedFlowDemo],
  ['DigitalSignatureDemo', DigitalSignatureDemo],
  ['ConfirmationDemo', ConfirmationDemo],
  ['SelfServiceDemo', SelfServiceDemo],
  ['FinancialDemo', FinancialDemo],
  ['CrmDemo', CrmDemo],
  ['CalendarDemo', CalendarDemo],
]

function styleOf(Demo: ComponentType): string {
  const { container } = render(<Demo />)
  return container.querySelector('svg style')?.textContent ?? ''
}

describe.each(DEMOS)('%s', (name, Demo) => {
  it('renders a decorative, full-bleed SVG', () => {
    const { container } = render(<Demo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 400 280')
  })

  it('plays once instead of looping forever', () => {
    // `infinite` is what produced the v1 reset flash. The one sanctioned
    // exception is a bounded repeat count (e.g. a 2-cycle sync indicator),
    // which never uses the `infinite` keyword.
    expect(styleOf(Demo)).not.toMatch(/\binfinite\b/)
  })

  it('holds its final frame', () => {
    expect(styleOf(Demo)).toMatch(/\bforwards\b/)
  })

  it('honours prefers-reduced-motion', () => {
    expect(styleOf(Demo)).toMatch(/prefers-reduced-motion/)
  })

  it('drives motion from the shared easing vocabulary', () => {
    expect(styleOf(Demo)).toMatch(/var\(--e-(out|pop|io)\)/)
  })

  it('never animates SVG geometry attributes', () => {
    // Geometry attrs (r, cx, width) are not compositor-friendly; scale
    // transforms are the supported way to resize a shape in place.
    const style = styleOf(Demo)
    const keyframeBodies = style.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) ?? []
    for (const block of keyframeBodies) {
      expect(block).not.toMatch(/[{;]\s*(r|cx|cy|width|height)\s*:/)
    }
  })
})

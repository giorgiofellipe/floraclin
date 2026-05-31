import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  FaceDiagramDemo,
  BeforeAfterDemo,
  GuidedCaptureDemo,
  GuidedFlowDemo,
  DigitalSignatureDemo,
  SelfServiceDemo,
  FinancialDemo,
  PackagesDemo,
  CalendarDemo,
} from '../feature-demos'

describe('Feature Demos — Group 1: Precisão Clínica Visual', () => {
  it('FaceDiagramDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<FaceDiagramDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('BeforeAfterDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<BeforeAfterDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('GuidedCaptureDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<GuidedCaptureDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('FaceDiagramDemo contains injection dot elements', () => {
    const { container } = render(<FaceDiagramDemo />)
    const circles = container.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThanOrEqual(4)
  })

  it('BeforeAfterDemo contains two frame rectangles', () => {
    const { container } = render(<BeforeAfterDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(2)
  })

  it('GuidedCaptureDemo contains a viewfinder and face guide', () => {
    const { container } = render(<GuidedCaptureDemo />)
    const rects = container.querySelectorAll('svg rect')
    const ellipses = container.querySelectorAll('svg ellipse')
    expect(rects.length).toBeGreaterThanOrEqual(1)
    expect(ellipses.length).toBeGreaterThanOrEqual(1)
  })

  it('each demo contains a <style> tag with scoped keyframes', () => {
    for (const Demo of [FaceDiagramDemo, BeforeAfterDemo, GuidedCaptureDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style).toBeInTheDocument()
      expect(style?.textContent).toContain('@keyframes')
    }
  })

  it('demos respect prefers-reduced-motion in style block', () => {
    for (const Demo of [FaceDiagramDemo, BeforeAfterDemo, GuidedCaptureDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style?.textContent).toContain('prefers-reduced-motion')
    }
  })
})

describe('Feature Demos — Group 2: Fluxo sem Atrito', () => {
  it('GuidedFlowDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<GuidedFlowDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('GuidedFlowDemo has 5 step circles', () => {
    const { container } = render(<GuidedFlowDemo />)
    const circles = container.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThanOrEqual(5)
  })

  it('DigitalSignatureDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<DigitalSignatureDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('DigitalSignatureDemo has a signature path', () => {
    const { container } = render(<DigitalSignatureDemo />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBeGreaterThanOrEqual(1)
  })

  it('SelfServiceDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<SelfServiceDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('SelfServiceDemo has form-like rects for input fields', () => {
    const { container } = render(<SelfServiceDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(3)
  })

  it('Group 2 demos each contain scoped keyframes and reduced-motion query', () => {
    for (const Demo of [GuidedFlowDemo, DigitalSignatureDemo, SelfServiceDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style).toBeInTheDocument()
      expect(style?.textContent).toContain('@keyframes')
      expect(style?.textContent).toContain('prefers-reduced-motion')
    }
  })
})

describe('Feature Demos — Group 3: Gestão do Negócio', () => {
  it('FinancialDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<FinancialDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('FinancialDemo has bar chart rects', () => {
    const { container } = render(<FinancialDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(4)
  })

  it('PackagesDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<PackagesDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('PackagesDemo has 5 session dot circles', () => {
    const { container } = render(<PackagesDemo />)
    const circles = container.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThanOrEqual(5)
  })

  it('CalendarDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<CalendarDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('CalendarDemo has calendar grid rects for appointment blocks', () => {
    const { container } = render(<CalendarDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(7)
  })

  it('Group 3 demos each contain scoped keyframes and reduced-motion query', () => {
    for (const Demo of [FinancialDemo, PackagesDemo, CalendarDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style).toBeInTheDocument()
      expect(style?.textContent).toContain('@keyframes')
      expect(style?.textContent).toContain('prefers-reduced-motion')
    }
  })
})

import { describe, it, expect } from 'vitest'
import {
  pointSideOfLine,
  clampPointToRulerEdge,
  getRulerEndpoints,
  projectPointOntoLine,
} from '../ruler-geometry'
import type { RulerState } from '../ruler-geometry'

describe('pointSideOfLine', () => {
  it('returns negative for a point above a left-to-right horizontal line (screen coords)', () => {
    const result = pointSideOfLine({ x: 5, y: -5 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result).toBeLessThan(0)
  })

  it('returns positive for a point below a left-to-right horizontal line (screen coords)', () => {
    const result = pointSideOfLine({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result).toBeGreaterThan(0)
  })

  it('returns 0 for a point on the line', () => {
    const result = pointSideOfLine({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result).toBe(0)
  })
})

describe('projectPointOntoLine', () => {
  it('projects a point onto a horizontal line', () => {
    const result = projectPointOntoLine({ x: 5, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result.x).toBeCloseTo(5, 5)
    expect(result.y).toBeCloseTo(0, 5)
  })

  it('clamps to line start when projection is before the segment', () => {
    const result = projectPointOntoLine({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result.x).toBeCloseTo(0, 5)
    expect(result.y).toBeCloseTo(0, 5)
  })

  it('clamps to line end when projection is past the segment', () => {
    const result = projectPointOntoLine({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result.x).toBeCloseTo(10, 5)
    expect(result.y).toBeCloseTo(0, 5)
  })

  it('handles a degenerate line (zero length)', () => {
    const result = projectPointOntoLine({ x: 5, y: 5 }, { x: 3, y: 3 }, { x: 3, y: 3 })
    expect(result.x).toBe(3)
    expect(result.y).toBe(3)
  })
})

describe('clampPointToRulerEdge', () => {
  const ruler: RulerState = { id: 'r1', x1: 0, y1: 50, x2: 200, y2: 50 }

  it('returns the original point when no rulers exist', () => {
    const result = clampPointToRulerEdge({ x: 100, y: 30 }, [], { x: 100, y: 60 })
    expect(result).toEqual({ x: 100, y: 30 })
  })

  it('returns the original point when it stays on the same side as startSide', () => {
    const result = clampPointToRulerEdge({ x: 100, y: 70 }, [ruler], { x: 100, y: 60 })
    expect(result).toEqual({ x: 100, y: 70 })
  })

  it('clamps the point to the ruler edge when crossing to the other side', () => {
    const result = clampPointToRulerEdge({ x: 100, y: 30 }, [ruler], { x: 100, y: 60 })
    expect(result.y).toBeCloseTo(50, 0)
  })

  it('handles start point exactly on the ruler line (no clamping)', () => {
    const result = clampPointToRulerEdge({ x: 100, y: 30 }, [ruler], { x: 100, y: 50 })
    expect(result).toEqual({ x: 100, y: 30 })
  })

  it('handles multiple rulers', () => {
    const ruler2: RulerState = { id: 'r2', x1: 100, y1: 0, x2: 100, y2: 200 }
    // Start at (50, 60) — below ruler1, left of ruler2
    // Try to reach (150, 30) — above ruler1, right of ruler2
    // Should be clamped by both
    const result = clampPointToRulerEdge({ x: 150, y: 30 }, [ruler, ruler2], { x: 50, y: 60 })
    expect(result.y).toBeGreaterThanOrEqual(49)
  })

  it('handles angled rulers', () => {
    const angledRuler: RulerState = { id: 'r2', x1: 0, y1: 0, x2: 100, y2: 100 }
    const startPoint = { x: 50, y: 100 }
    const crossPoint = { x: 100, y: 50 }
    const result = clampPointToRulerEdge(crossPoint, [angledRuler], startPoint)
    const sideOfStart = pointSideOfLine(startPoint, { x: 0, y: 0 }, { x: 100, y: 100 })
    const sideOfResult = pointSideOfLine(result, { x: 0, y: 0 }, { x: 100, y: 100 })
    if (sideOfStart > 0) {
      expect(sideOfResult).toBeGreaterThanOrEqual(-1)
    } else {
      expect(sideOfResult).toBeLessThanOrEqual(1)
    }
  })
})

describe('getRulerEndpoints', () => {
  it('computes endpoints for a horizontal ruler', () => {
    const { x1, y1, x2, y2 } = getRulerEndpoints(100, 100, 0, 200)
    expect(x1).toBeCloseTo(0, 0)
    expect(y1).toBeCloseTo(100, 0)
    expect(x2).toBeCloseTo(200, 0)
    expect(y2).toBeCloseTo(100, 0)
  })

  it('computes endpoints for a 90-degree ruler', () => {
    const { x1, y1, x2, y2 } = getRulerEndpoints(100, 100, 90, 200)
    expect(x1).toBeCloseTo(100, 0)
    expect(y1).toBeCloseTo(0, 0)
    expect(x2).toBeCloseTo(100, 0)
    expect(y2).toBeCloseTo(200, 0)
  })

  it('computes endpoints for a 45-degree ruler', () => {
    const { x1, y1, x2, y2 } = getRulerEndpoints(0, 0, 45, 100)
    const half = 50 * Math.SQRT2 / 2
    expect(x1).toBeCloseTo(-half, 1)
    expect(y1).toBeCloseTo(-half, 1)
    expect(x2).toBeCloseTo(half, 1)
    expect(y2).toBeCloseTo(half, 1)
  })
})

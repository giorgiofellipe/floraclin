export interface Point {
  x: number
  y: number
}

export interface RulerState {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export function pointSideOfLine(p: Point, lineA: Point, lineB: Point): number {
  return (lineB.x - lineA.x) * (p.y - lineA.y) - (lineB.y - lineA.y) * (p.x - lineA.x)
}

export function projectPointOntoLine(p: Point, lineA: Point, lineB: Point): Point {
  const dx = lineB.x - lineA.x
  const dy = lineB.y - lineA.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { ...lineA }
  const t = Math.max(0, Math.min(1, ((p.x - lineA.x) * dx + (p.y - lineA.y) * dy) / lenSq))
  return { x: lineA.x + t * dx, y: lineA.y + t * dy }
}

export function clampPointToRulerEdge(
  point: Point,
  rulers: RulerState[],
  drawStartPoint: Point,
): Point {
  let result = point
  for (const ruler of rulers) {
    const lineA = { x: ruler.x1, y: ruler.y1 }
    const lineB = { x: ruler.x2, y: ruler.y2 }
    const startSide = pointSideOfLine(drawStartPoint, lineA, lineB)
    const pointSide = pointSideOfLine(result, lineA, lineB)

    if (startSide === 0) continue
    if (startSide > 0 && pointSide >= 0) continue
    if (startSide < 0 && pointSide <= 0) continue

    result = projectPointOntoLine(result, lineA, lineB)
  }
  return result
}

export function getRulerEndpoints(
  cx: number,
  cy: number,
  angleDeg: number,
  length: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (angleDeg * Math.PI) / 180
  const halfLen = length / 2
  return {
    x1: cx - halfLen * Math.cos(rad),
    y1: cy - halfLen * Math.sin(rad),
    x2: cx + halfLen * Math.cos(rad),
    y2: cy + halfLen * Math.sin(rad),
  }
}

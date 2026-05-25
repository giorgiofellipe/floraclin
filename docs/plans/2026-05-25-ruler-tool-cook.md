# Ruler Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Régua" (ruler) tool to the photo annotation editor — a freely rotatable translucent bar that acts as a physical drawing barrier, preventing strokes from crossing it.

**Architecture:** Extract ruler geometry utilities into a standalone pure module (`ruler-geometry.ts`). The annotation editor gains a new `ruler` tool mode, a `rulers` state array, a dedicated Konva `Layer` rendered ABOVE the drawing layer (so ruler handles stay interactive without blocking shape events), and clamping logic wired into the existing drawing handlers. Ruler elements use `e.cancelBubble = true` on drag to prevent stage mousedown from firing simultaneously.

**Tech Stack:** react-konva (Group, Rect, Circle on a Layer), pure geometry math, lucide-react `Ruler` icon

---

## Group A (parallel)

### Task 1: Ruler geometry utilities

**Files:**
- Create: `web/src/components/photos/ruler-geometry.ts`
- Create: `web/src/components/photos/__tests__/ruler-geometry.test.ts`

This module exports pure math functions used by the editor. No React, no Konva — pure geometry.

- [ ] **Step 1: Write failing tests for `pointSideOfLine`**

```ts
// web/src/components/photos/__tests__/ruler-geometry.test.ts
import { describe, it, expect } from 'vitest'
import { pointSideOfLine } from '../ruler-geometry'

describe('pointSideOfLine', () => {
  it('returns positive for a point on the left side of a horizontal line', () => {
    // Line from (0,0) to (10,0), point above (5, -5)
    const result = pointSideOfLine({ x: 5, y: -5 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result).toBeGreaterThan(0)
  })

  it('returns negative for a point on the right side of a horizontal line', () => {
    const result = pointSideOfLine({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result).toBeLessThan(0)
  })

  it('returns 0 for a point on the line', () => {
    const result = pointSideOfLine({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/components/photos/__tests__/ruler-geometry.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement `pointSideOfLine`**

```ts
// web/src/components/photos/ruler-geometry.ts

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

// Cross product sign: positive = left of line, negative = right, 0 = on line
export function pointSideOfLine(p: Point, lineA: Point, lineB: Point): number {
  return (lineB.x - lineA.x) * (p.y - lineA.y) - (lineB.y - lineA.y) * (p.x - lineA.x)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/components/photos/__tests__/ruler-geometry.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for `clampPointToRulerEdge`**

```ts
// Append to web/src/components/photos/__tests__/ruler-geometry.test.ts
import { clampPointToRulerEdge } from '../ruler-geometry'

describe('clampPointToRulerEdge', () => {
  const ruler: import('../ruler-geometry').RulerState = { id: 'r1', x1: 0, y1: 50, x2: 200, y2: 50 }

  it('returns the original point when no rulers exist', () => {
    const result = clampPointToRulerEdge({ x: 100, y: 30 }, [], { x: 100, y: 60 })
    expect(result).toEqual({ x: 100, y: 30 })
  })

  it('returns the original point when it stays on the same side as startSide', () => {
    // Start side is below the ruler (y=60, side < 0), point is also below (y=70)
    const result = clampPointToRulerEdge({ x: 100, y: 70 }, [ruler], { x: 100, y: 60 })
    expect(result).toEqual({ x: 100, y: 70 })
  })

  it('clamps the point to the ruler edge when crossing to the other side', () => {
    // Start at y=60 (below), try to move to y=30 (above) — should be clamped to y≈50
    const result = clampPointToRulerEdge({ x: 100, y: 30 }, [ruler], { x: 100, y: 60 })
    expect(result.y).toBeCloseTo(50, 0)
  })

  it('handles angled rulers', () => {
    const angledRuler: import('../ruler-geometry').RulerState = { id: 'r2', x1: 0, y1: 0, x2: 100, y2: 100 }
    // Start at right side (50, 100), cross to left side (100, 50)
    const startPoint = { x: 50, y: 100 }
    const crossPoint = { x: 100, y: 50 }
    const result = clampPointToRulerEdge(crossPoint, [angledRuler], startPoint)
    // Should be clamped back to somewhere on or near the line
    const sideOfStart = (100 - 0) * (startPoint.y - 0) - (100 - 0) * (startPoint.x - 0)
    const sideOfResult = (100 - 0) * (result.y - 0) - (100 - 0) * (result.x - 0)
    // Result should be on the same side as start, or on the line
    if (sideOfStart > 0) {
      expect(sideOfResult).toBeGreaterThanOrEqual(-1)
    } else {
      expect(sideOfResult).toBeLessThanOrEqual(1)
    }
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/components/photos/__tests__/ruler-geometry.test.ts`
Expected: FAIL — `clampPointToRulerEdge` not exported

- [ ] **Step 7: Implement `clampPointToRulerEdge`**

```ts
// Append to web/src/components/photos/ruler-geometry.ts

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

    // If start is exactly on the line, no barrier applies for this ruler
    if (startSide === 0) continue
    // If point is on the same side (or on line), no clamping needed
    if (startSide > 0 && pointSide >= 0) continue
    if (startSide < 0 && pointSide <= 0) continue

    // Point crossed — project it onto the ruler line
    result = projectPointOntoLine(result, lineA, lineB)
  }
  return result
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/components/photos/__tests__/ruler-geometry.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing tests for `getRulerEndpoints`**

```ts
// Append to test file
import { getRulerEndpoints } from '../ruler-geometry'

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
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/components/photos/__tests__/ruler-geometry.test.ts`
Expected: FAIL

- [ ] **Step 11: Implement `getRulerEndpoints`**

```ts
// Append to ruler-geometry.ts

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
```

- [ ] **Step 12: Run all tests to verify they pass**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/components/photos/__tests__/ruler-geometry.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add web/src/components/photos/ruler-geometry.ts web/src/components/photos/__tests__/ruler-geometry.test.ts
git commit -m "feat(annotation): add ruler geometry utilities with tests"
```

---

## Group B (depends on A)

### Task 2: Integrate ruler tool into the annotation editor

**Files:**
- Modify: `web/src/components/photos/photo-annotation-editor.tsx`

This is the main integration task. It adds:
- `ruler` to the `DrawingTool` union
- A `rulers` state array
- A `RulerOverlay` Konva Group rendered on its own Layer
- Ruler placement on canvas click when `ruler` tool is active
- Ruler drag-to-move and handle-drag-to-rotate
- Ruler deletion via eraser tool or × button
- Clamping logic wired into `handleStageMouseMove` for freehand drawing
- Clamping logic wired into `handleStageMouseUp` for arrow/line/circle endpoint

**Important:** Rulers are transient — they are NOT included in the shapes array, NOT saved with annotations, and cleared when the dialog closes.

- [ ] **Step 1: Add ruler tool to the TOOLS array and DrawingTool type**

At the top of `photo-annotation-editor.tsx`, update:

```ts
import {
  Pencil,
  ArrowUp,
  Minus,
  Circle,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Save,
  X,
  Loader2,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  Ruler,
} from 'lucide-react'
```

Update the type:
```ts
type DrawingTool = 'select' | 'pencil' | 'arrow' | 'line' | 'circle' | 'text' | 'eraser' | 'ruler'
```

Add to TOOLS array (after 'text', before 'eraser'):
```ts
  { key: 'ruler', icon: Ruler, label: 'Régua' },
```

- [ ] **Step 2: Add ruler state and imports**

Import the geometry module:
```ts
import type { RulerState } from './ruler-geometry'
import { getRulerEndpoints, clampPointToRulerEdge } from './ruler-geometry'
```

Add state inside the component, after `stagePos`:
```ts
const [rulers, setRulers] = useState<(RulerState & { cx: number; cy: number; angle: number; length: number })[]>([])
const rulerIdCounter = useRef(0)
```

Define the ruler visual constants at the top of the file (module level):
```ts
const RULER_WIDTH = 24
const RULER_COLOR = 'rgba(59, 130, 246, 0.3)' // blue at 30%
const RULER_HANDLE_RADIUS = 10
const RULER_DEFAULT_LENGTH = 300
```

Reset rulers when dialog opens — in the existing `useEffect` that handles `open`, add after `setStagePos({ x: 0, y: 0 })`:
```ts
setRulers([])
```

- [ ] **Step 3: Handle ruler placement on canvas click**

In `handleStageMouseDown`, add a branch at the top (after the `if (tool === 'select')` block). Also add `imageScale` and `rulers` to the `useCallback` dependency array:

```ts
if (tool === 'ruler') {
  const newId = `ruler-${Date.now()}-${rulerIdCounter.current++}`
  const length = RULER_DEFAULT_LENGTH / imageScale
  const newRuler = {
    id: newId,
    cx: pos.x,
    cy: pos.y,
    angle: 0,
    length,
    ...getRulerEndpoints(pos.x, pos.y, 0, length),
  }
  setRulers((prev) => [...prev, newRuler])
  return
}
```

- [ ] **Step 4: Wire clamping into freehand drawing**

In `handleStageMouseMove`, inside the `if (tool === 'pencil' || tool === 'eraser')` block, clamp the point before pushing:

Replace:
```ts
currentFreeDrawPoints.current = [...currentFreeDrawPoints.current, pos.x, pos.y]
```

With:
```ts
const rulerStates = rulers.map((r) => ({ id: r.id, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }))
// Use the previous point in the stroke (not drawStart) so the barrier checks per-segment
const pts = currentFreeDrawPoints.current
const prevPoint = pts.length >= 2 ? { x: pts[pts.length - 2], y: pts[pts.length - 1] } : drawStart.current
const clampedPos = tool === 'pencil' && prevPoint
  ? clampPointToRulerEdge(pos, rulerStates, prevPoint)
  : pos
currentFreeDrawPoints.current = [...currentFreeDrawPoints.current, clampedPos.x, clampedPos.y]
```

- [ ] **Step 5: Wire clamping into shape endpoints (arrow, line, circle)**

In `handleStageMouseUp`, after `const start = drawStart.current`, clamp `pos` for shape tools:

```ts
const rulerStates = rulers.map((r) => ({ id: r.id, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }))
const clampedEnd = (tool === 'arrow' || tool === 'line' || tool === 'circle')
  ? clampPointToRulerEdge(pos, rulerStates, start)
  : pos
```

Then use `clampedEnd` instead of `pos` in the arrow/line/circle shape creation and in the `dist` calculation.

- [ ] **Step 6: Add the ruler Konva layer with rendering**

Inside the `<Stage>`, add a new `<Layer>` AFTER the drawing layer (above it in z-order so handles are clickable without blocking drawing events):

```tsx
{/* Ruler layer */}
<Layer name="ruler-layer">
  {rulers.map((ruler) => {
    const halfWidth = RULER_WIDTH / 2
    const angleDeg = ruler.angle

    return (
      <React.Fragment key={ruler.id}>
        {/* Ruler body — rotated rectangle */}
        <Rect
          x={ruler.cx}
          y={ruler.cy}
          width={ruler.length}
          height={RULER_WIDTH}
          offsetX={ruler.length / 2}
          offsetY={halfWidth}
          rotation={angleDeg}
          fill={RULER_COLOR}
          stroke="rgba(59, 130, 246, 0.5)"
          strokeWidth={1}
          cornerRadius={4}
          draggable={tool === 'select' || tool === 'ruler'}
          onDragStart={(e) => { e.cancelBubble = true }}
          onDragMove={(e) => {
            const node = e.target
            const newCx = node.x()
            const newCy = node.y()
            setRulers((prev) =>
              prev.map((r) =>
                r.id === ruler.id
                  ? { ...r, cx: newCx, cy: newCy, ...getRulerEndpoints(newCx, newCy, r.angle, r.length) }
                  : r,
              ),
            )
          }}
          onMouseDown={(e) => { e.cancelBubble = true }}
          onTouchStart={(e) => { e.cancelBubble = true }}
          shadowBlur={4}
          shadowColor="rgba(0,0,0,0.15)"
          shadowOffsetY={2}
        />
        {/* End handle 1 */}
        <KonvaCircle
          x={ruler.x1}
          y={ruler.y1}
          radius={RULER_HANDLE_RADIUS}
          fill="rgba(59, 130, 246, 0.5)"
          stroke="rgba(59, 130, 246, 0.8)"
          strokeWidth={1.5}
          draggable={tool === 'select' || tool === 'ruler'}
          onDragStart={(e) => { e.cancelBubble = true }}
          onMouseDown={(e) => { e.cancelBubble = true }}
          onTouchStart={(e) => { e.cancelBubble = true }}
          onDragMove={(e) => {
            const handlePos = { x: e.target.x(), y: e.target.y() }
            const pivot = { x: ruler.x2, y: ruler.y2 }
            const dx = handlePos.x - pivot.x
            const dy = handlePos.y - pivot.y
            const newLength = Math.max(60, Math.hypot(dx, dy))
            const newAngle = (Math.atan2(dy, dx) * 180) / Math.PI + 180
            const newCx = (handlePos.x + pivot.x) / 2
            const newCy = (handlePos.y + pivot.y) / 2
            setRulers((prev) =>
              prev.map((r) =>
                r.id === ruler.id
                  ? { ...r, cx: newCx, cy: newCy, angle: newAngle, length: newLength, ...getRulerEndpoints(newCx, newCy, newAngle, newLength) }
                  : r,
              ),
            )
          }}
        />
        {/* End handle 2 */}
        <KonvaCircle
          x={ruler.x2}
          y={ruler.y2}
          radius={RULER_HANDLE_RADIUS}
          fill="rgba(59, 130, 246, 0.5)"
          stroke="rgba(59, 130, 246, 0.8)"
          strokeWidth={1.5}
          draggable={tool === 'select' || tool === 'ruler'}
          onDragStart={(e) => { e.cancelBubble = true }}
          onMouseDown={(e) => { e.cancelBubble = true }}
          onTouchStart={(e) => { e.cancelBubble = true }}
          onDragMove={(e) => {
            const handlePos = { x: e.target.x(), y: e.target.y() }
            const pivot = { x: ruler.x1, y: ruler.y1 }
            const dx = handlePos.x - pivot.x
            const dy = handlePos.y - pivot.y
            const newLength = Math.max(60, Math.hypot(dx, dy))
            const newAngle = (Math.atan2(dy, dx) * 180) / Math.PI
            const newCx = (handlePos.x + pivot.x) / 2
            const newCy = (handlePos.y + pivot.y) / 2
            setRulers((prev) =>
              prev.map((r) =>
                r.id === ruler.id
                  ? { ...r, cx: newCx, cy: newCy, angle: newAngle, length: newLength, ...getRulerEndpoints(newCx, newCy, newAngle, newLength) }
                  : r,
              ),
            )
          }}
        />
        {/* Delete button — 12px radius for iPad tap target */}
        <KonvaCircle
          x={ruler.cx + (RULER_WIDTH / 2 + 12) * Math.cos(((ruler.angle - 90) * Math.PI) / 180)}
          y={ruler.cy + (RULER_WIDTH / 2 + 12) * Math.sin(((ruler.angle - 90) * Math.PI) / 180)}
          radius={12}
          fill="#ef4444"
          stroke="#fff"
          strokeWidth={1.5}
          onClick={() => setRulers((prev) => prev.filter((r) => r.id !== ruler.id))}
          onTap={() => setRulers((prev) => prev.filter((r) => r.id !== ruler.id))}
          onMouseDown={(e) => { e.cancelBubble = true }}
          onTouchStart={(e) => { e.cancelBubble = true }}
        />
        <Text
          x={ruler.cx + (RULER_WIDTH / 2 + 12) * Math.cos(((ruler.angle - 90) * Math.PI) / 180) - 5}
          y={ruler.cy + (RULER_WIDTH / 2 + 12) * Math.sin(((ruler.angle - 90) * Math.PI) / 180) - 6}
          text="×"
          fontSize={14}
          fill="#fff"
          listening={false}
        />
      </React.Fragment>
    )
  })}
</Layer>
```

**Important:** Import `Rect` from react-konva at the top:
```ts
import { Stage, Layer, Line, Arrow, Ellipse, Text, Image as KonvaImage, Circle as KonvaCircle, Rect } from 'react-konva'
```

- [ ] **Step 7: Handle eraser + ruler interaction**

In `handleStageMouseDown`, inside the `if (tool === 'eraser')` block, before starting the erase stroke, check if the click hits a ruler:

```ts
if (tool === 'eraser') {
  // Check if clicking on a ruler — delete it
  const hitRuler = rulers.find((r) => {
    const dx = r.x2 - r.x1
    const dy = r.y2 - r.y1
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return false
    const t = Math.max(0, Math.min(1, ((pos.x - r.x1) * dx + (pos.y - r.y1) * dy) / lenSq))
    const projX = r.x1 + t * dx
    const projY = r.y1 + t * dy
    const dist = Math.hypot(pos.x - projX, pos.y - projY)
    return dist <= RULER_WIDTH / 2 + 4
  })
  if (hitRuler) {
    setRulers((prev) => prev.filter((r) => r.id !== hitRuler.id))
    return
  }

  isDrawing.current = true
  drawStart.current = pos
  currentFreeDrawPoints.current = [pos.x, pos.y]
  return
}
```

- [ ] **Step 8: Add ruler cursor indicator**

In the tool cursor section, update to show the ruler cursor. In `handleStageMouseMove`, the tool cursor is already tracked for non-select tools. Add `ruler` to the exclude for cursor (rulers have their own cursors via Konva drag). Update the stage style:

```ts
style={{ cursor: tool === 'select' || tool === 'ruler' ? 'default' : 'none' }}
```

Also hide the tool cursor circle when in ruler mode — update the condition in the `{tool !== 'select' && toolCursor && (` section to:
```ts
{tool !== 'select' && tool !== 'ruler' && toolCursor && (
```

- [ ] **Step 9: Prevent ruler tool from creating drawings when clicking canvas**

The ruler tool should ONLY place rulers, not trigger any drawing. Verify that the early `return` in `handleStageMouseDown` for `tool === 'ruler'` prevents the drawing path. The existing code already falls through to drawing — the `return` in step 3 prevents this.

- [ ] **Step 10: Also clamp shape preview during drag**

In `handleStageMouseMove`, inside the shape preview block `if ((tool === 'arrow' || tool === 'line' || tool === 'circle') && drawStart.current)`, clamp the preview end point:

Replace:
```ts
setShapePreview({ start: drawStart.current, end: pos })
```

With:
```ts
const rulerStatesForPreview = rulers.map((r) => ({ id: r.id, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }))
const clampedPreviewEnd = clampPointToRulerEdge(pos, rulerStatesForPreview, drawStart.current)
setShapePreview({ start: drawStart.current, end: clampedPreviewEnd })
```

- [ ] **Step 11: Commit**

```bash
git add web/src/components/photos/photo-annotation-editor.tsx
git commit -m "feat(annotation): add ruler tool with barrier drawing and rotation"
```

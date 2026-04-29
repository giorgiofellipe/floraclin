'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Stage, Layer, Line, Arrow, Ellipse, Text, Image as KonvaImage, Circle as KonvaCircle } from 'react-konva'
import type Konva from 'konva'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'
import { timelineStageLabels } from '@/validations/photo'
import type { TimelineStage } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoAnnotationEditorProps {
  photo: PhotoAssetWithUrl | null
  patientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DrawingTool = 'select' | 'pencil' | 'arrow' | 'line' | 'circle' | 'text' | 'eraser'

interface ShapeBase {
  id: string
  type: string
  color: string
  strokeWidth: number
}

interface FreeDrawShape extends ShapeBase {
  type: 'freedraw'
  points: number[]
}

interface ArrowShape extends ShapeBase {
  type: 'arrow'
  points: [number, number, number, number]
}

interface LineShape extends ShapeBase {
  type: 'line'
  points: [number, number, number, number]
}

interface EllipseShape extends ShapeBase {
  type: 'ellipse'
  x: number
  y: number
  radiusX: number
  radiusY: number
}

interface TextShape extends ShapeBase {
  type: 'text'
  x: number
  y: number
  text: string
  fontSize: number
}

interface EraserShape extends ShapeBase {
  type: 'eraser'
  points: number[]
}

type AnnotationShape = FreeDrawShape | ArrowShape | LineShape | EllipseShape | TextShape | EraserShape

const PRESET_COLORS = [
  { name: 'Vermelho', value: '#ef4444' },
  { name: 'Azul', value: '#3b82f6' },
  { name: 'Verde', value: '#22c55e' },
  { name: 'Amarelo', value: '#eab308' },
  { name: 'Branco', value: '#ffffff' },
  { name: 'Preto', value: '#000000' },
]

const BRUSH_WIDTHS = [2, 4, 6, 8]

const TOOLS: { key: DrawingTool; icon: typeof Pencil; label: string }[] = [
  { key: 'select', icon: MousePointer2, label: 'Mover' },
  { key: 'pencil', icon: Pencil, label: 'Livre' },
  { key: 'arrow', icon: ArrowUp, label: 'Seta' },
  { key: 'line', icon: Minus, label: 'Linha' },
  { key: 'circle', icon: Circle, label: 'Círculo' },
  { key: 'text', icon: Type, label: 'Texto' },
  { key: 'eraser', icon: Eraser, label: 'Borracha' },
]

let nextId = 0
function genId() {
  return `shape-${Date.now()}-${nextId++}`
}

// ─── Component ──────────────────────────────────────────────────────

export function PhotoAnnotationEditor({
  photo,
  patientId,
  open,
  onOpenChange,
}: PhotoAnnotationEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [tool, setTool] = useState<DrawingTool>('pencil')
  const [color, setColor] = useState('#ef4444')
  const [brushWidth, setBrushWidth] = useState(4)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Canvas dimensions
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [imageScale, setImageScale] = useState(1)
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)

  // Shapes state
  const [shapes, setShapes] = useState<AnnotationShape[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Tool cursor position
  const [toolCursor, setToolCursor] = useState<{ x: number; y: number } | null>(null)

  // Shape preview while dragging (arrow, line, circle)
  const [shapePreview, setShapePreview] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)

  // Zoom state
  const [stageScale, setStageScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })

  // Pinch-to-zoom refs
  const lastPinchDist = useRef<number | null>(null)
  const lastPinchCenter = useRef<{ x: number; y: number } | null>(null)

  // Drawing in progress
  const isDrawing = useRef(false)
  const drawStart = useRef<{ x: number; y: number } | null>(null)
  const currentFreeDrawPoints = useRef<number[]>([])

  // History for undo/redo
  const [history, setHistory] = useState<AnnotationShape[][]>([[]])
  const [historyIdx, setHistoryIdx] = useState(0)

  const canUndo = historyIdx > 0
  const canRedo = historyIdx < history.length - 1

  const pushHistory = useCallback((newShapes: AnnotationShape[]) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIdx + 1)
      return [...trimmed, newShapes]
    })
    setHistoryIdx((prev) => prev + 1)
  }, [historyIdx])

  const handleUndo = useCallback(() => {
    if (historyIdx <= 0) return
    const newIdx = historyIdx - 1
    setHistoryIdx(newIdx)
    setShapes(history[newIdx])
    setSelectedId(null)
  }, [historyIdx, history])

  const handleRedo = useCallback(() => {
    if (historyIdx >= history.length - 1) return
    const newIdx = historyIdx + 1
    setHistoryIdx(newIdx)
    setShapes(history[newIdx])
    setSelectedId(null)
  }, [historyIdx, history])

  // Load background image when dialog opens
  useEffect(() => {
    if (!open || !photo) return

    let cancelled = false
    setLoading(true)
    setBgImage(null)
    setShapes([])
    setHistory([[]])
    setHistoryIdx(0)
    setSelectedId(null)
    setStageScale(1)
    setStagePos({ x: 0, y: 0 })

    const load = async () => {
      // Wait for dialog layout
      await new Promise((r) => setTimeout(r, 150))
      if (cancelled) return

      // Fetch fresh signed URL
      let imageUrl = photo.signedUrl ?? ''
      try {
        const res = await fetch(`/api/photos?photoIdA=${photo.id}&photoIdB=${photo.id}`)
        const result = await res.json()
        if (result.success && result.data?.urlA) imageUrl = result.data.urlA
      } catch { /* fall back */ }

      if (!imageUrl || cancelled) {
        setLoading(false)
        return
      }

      // Load image
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = async () => {
        if (cancelled) return

        const container = containerRef.current
        if (!container) return

        const cw = container.clientWidth
        const ch = container.clientHeight
        if (cw === 0 || ch === 0) return

        const scale = Math.min(cw / img.width, ch / img.height, 1)
        setImageScale(scale)
        setStageSize({
          width: Math.round(img.width * scale),
          height: Math.round(img.height * scale),
        })
        setBgImage(img)

        // Load existing annotation
        try {
          const annotRes = await fetch(`/api/photos/annotations/${photo.id}`)
          const result = await annotRes.json()
          if (result.success && result.data?.annotationData?.shapes) {
            const loaded = result.data.annotationData.shapes as AnnotationShape[]
            setShapes(loaded)
            setHistory([[], loaded])
            setHistoryIdx(1)
          }
        } catch { /* no existing annotation */ }

        setLoading(false)
      }

      img.onerror = () => {
        // Retry without crossOrigin
        const retry = new window.Image()
        retry.onload = img.onload
        retry.onerror = () => setLoading(false)
        retry.src = imageUrl
      }
      img.src = imageUrl
    }

    load()
    return () => { cancelled = true }
  }, [open, photo])

  // ─── Event handlers ───────────────────────────────────────────────

  const getPointerPos = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    // Transform screen coordinates to canvas coordinates (account for zoom/pan)
    return {
      x: (pos.x - stagePos.x) / stageScale,
      y: (pos.y - stagePos.y) / stageScale,
    }
  }, [stageScale, stagePos])

  const handleStageMouseDown = useCallback(() => {
    const pos = getPointerPos()
    if (!pos) return

    if (tool === 'select') return

    if (tool === 'eraser') {
      isDrawing.current = true
      drawStart.current = pos
      currentFreeDrawPoints.current = [pos.x, pos.y]
      return
    }

    if (tool === 'text') {
      const newShape: TextShape = {
        id: genId(),
        type: 'text',
        x: pos.x,
        y: pos.y,
        text: 'Texto',
        fontSize: brushWidth * 5,
        color,
        strokeWidth: brushWidth,
      }
      const newShapes = [...shapes, newShape]
      setShapes(newShapes)
      pushHistory(newShapes)
      return
    }

    isDrawing.current = true
    drawStart.current = pos

    if (tool === 'pencil') {
      currentFreeDrawPoints.current = [pos.x, pos.y]
    }
  }, [tool, shapes, color, brushWidth, getPointerPos, pushHistory])

  const handleStageMouseMove = useCallback(() => {
    const pos = getPointerPos()
    if (!pos) return

    // Track tool cursor
    if (tool !== 'select') {
      setToolCursor(pos)
    }

    if (!isDrawing.current) return

    // Shape preview for arrow/line/circle
    if ((tool === 'arrow' || tool === 'line' || tool === 'circle') && drawStart.current) {
      setShapePreview({ start: drawStart.current, end: pos })
    }

    if (tool === 'pencil' || tool === 'eraser') {
      currentFreeDrawPoints.current = [...currentFreeDrawPoints.current, pos.x, pos.y]
      const previewType = tool === 'eraser' ? 'eraser' as const : 'freedraw' as const
      const previewColor = tool === 'eraser' ? '#000000' : color
      const previewWidth = tool === 'eraser' ? brushWidth * 4 : brushWidth
      setShapes((prev) => {
        const existing = prev.filter((s) => s.id !== '__drawing__')
        return [...existing, {
          id: '__drawing__',
          type: previewType,
          points: [...currentFreeDrawPoints.current],
          color: previewColor,
          strokeWidth: previewWidth,
        }]
      })
    }
  }, [tool, color, brushWidth, getPointerPos])

  const handleStageMouseUp = useCallback(() => {
    if (!isDrawing.current || !drawStart.current) return
    isDrawing.current = false
    setShapePreview(null)

    const pos = getPointerPos()
    if (!pos) return

    const start = drawStart.current
    drawStart.current = null

    if (tool === 'pencil' || tool === 'eraser') {
      const points = currentFreeDrawPoints.current
      currentFreeDrawPoints.current = []
      if (points.length < 4) {
        // Short tap — create a dot at the tap point
        if (tool === 'eraser' && points.length >= 2) {
          const dotPoints = [points[0], points[1], points[0] + 0.5, points[1] + 0.5]
          const newShape: EraserShape = {
            id: genId(), type: 'eraser', points: dotPoints, color: '#000000', strokeWidth: brushWidth * 4,
          }
          const newShapes = [...shapes.filter((s) => s.id !== '__drawing__'), newShape]
          setShapes(newShapes)
          pushHistory(newShapes)
        }
        return
      }
      const newShape: FreeDrawShape | EraserShape = tool === 'eraser'
        ? { id: genId(), type: 'eraser', points, color: '#000000', strokeWidth: brushWidth * 4 }
        : { id: genId(), type: 'freedraw', points, color, strokeWidth: brushWidth }
      const newShapes = [...shapes.filter((s) => s.id !== '__drawing__'), newShape]
      setShapes(newShapes)
      pushHistory(newShapes)
      return
    }

    const dist = Math.hypot(pos.x - start.x, pos.y - start.y)
    if (dist < 5) return

    let newShape: AnnotationShape | null = null

    if (tool === 'arrow') {
      newShape = {
        id: genId(),
        type: 'arrow',
        points: [start.x, start.y, pos.x, pos.y],
        color,
        strokeWidth: brushWidth,
      }
    } else if (tool === 'line') {
      newShape = {
        id: genId(),
        type: 'line',
        points: [start.x, start.y, pos.x, pos.y],
        color,
        strokeWidth: brushWidth,
      }
    } else if (tool === 'circle') {
      newShape = {
        id: genId(),
        type: 'ellipse',
        x: (start.x + pos.x) / 2,
        y: (start.y + pos.y) / 2,
        radiusX: Math.abs(pos.x - start.x) / 2,
        radiusY: Math.abs(pos.y - start.y) / 2,
        color,
        strokeWidth: brushWidth,
      }
    }

    if (newShape) {
      const newShapes = [...shapes, newShape]
      setShapes(newShapes)
      pushHistory(newShapes)
    }
  }, [tool, shapes, color, brushWidth, getPointerPos, pushHistory])

  // ─── Save ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!photo) return
    setSaving(true)
    try {
      const annotationData = { shapes, version: 2 }
      const res = await fetch('/api/photos/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoAssetId: photo.id, annotationData }),
      })
      if (res.ok) {
        toast.success('Anotação salva')
      } else {
        toast.error('Erro ao salvar anotação')
      }
    } catch {
      toast.error('Erro ao salvar anotação')
    } finally {
      setSaving(false)
    }
  }, [photo, shapes])

  const [savingAsPhoto, setSavingAsPhoto] = useState(false)
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false)
  const [saveAsStage, setSaveAsStage] = useState<string>('other')

  const handleSaveAsPhoto = useCallback(async () => {
    const stage = stageRef.current
    if (!stage || !photo) return

    setSavingAsPhoto(true)
    try {
      // Export canvas to blob
      const dataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' })
      const res = await fetch(dataUrl)
      const blob = await res.blob()

      // Upload as new photo
      const formData = new FormData()
      formData.append('file', blob, `anotacao-${photo.originalFilename ?? 'foto'}.png`)
      formData.append('patientId', patientId)
      formData.append('timelineStage', saveAsStage)
      formData.append('notes', `Anotação sobre: ${photo.originalFilename ?? 'foto'}`)
      if (photo.procedureRecordId) {
        formData.append('procedureRecordId', photo.procedureRecordId)
      }

      const uploadRes = await fetch('/api/photos', { method: 'POST', body: formData })
      if (uploadRes.ok) {
        toast.success('Foto anotada salva como nova imagem')
        setShowSaveAsDialog(false)
      } else {
        toast.error('Erro ao salvar como nova foto')
      }
    } catch {
      toast.error('Erro ao salvar como nova foto')
    } finally {
      setSavingAsPhoto(false)
    }
  }, [photo, patientId, saveAsStage])

  // ─── Zoom ─────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const scaleBy = 1.08
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy
    const clampedScale = Math.max(0.5, Math.min(5, newScale))

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }

    setStageScale(clampedScale)
    setStagePos({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    })
  }, [])

  const handlePinch = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const stage = stageRef.current
    if (!stage) return

    const touch1 = e.evt.touches[0]
    const touch2 = e.evt.touches[1]
    if (!touch1 || !touch2) return

    // Stop drawing when pinching
    isDrawing.current = false

    e.evt.preventDefault()

    const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
    const midX = (touch1.clientX + touch2.clientX) / 2
    const midY = (touch1.clientY + touch2.clientY) / 2

    if (!lastPinchDist.current) {
      lastPinchDist.current = dist
      lastPinchCenter.current = { x: midX, y: midY }
      return
    }

    const oldScale = stageScale
    const newScale = Math.max(0.5, Math.min(5, oldScale * (dist / lastPinchDist.current)))

    const stageBox = stage.container().getBoundingClientRect()
    const pointer = {
      x: midX - stageBox.left,
      y: midY - stageBox.top,
    }
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    }

    setStageScale(newScale)
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })

    lastPinchDist.current = dist
    lastPinchCenter.current = { x: midX, y: midY }
  }, [stageScale, stagePos])

  const handlePinchEnd = useCallback(() => {
    lastPinchDist.current = null
    lastPinchCenter.current = null
  }, [])

  const handleZoomIn = useCallback(() => {
    setStageScale((s) => Math.min(5, s * 1.3))
  }, [])

  const handleZoomOut = useCallback(() => {
    setStageScale((s) => Math.max(0.5, s / 1.3))
  }, [])

  const handleZoomReset = useCallback(() => {
    setStageScale(1)
    setStagePos({ x: 0, y: 0 })
  }, [])

  // ─── Deselect on stage click ──────────────────────────────────────

  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (tool !== 'select') return
    const clickedOnEmpty = e.target === e.target.getStage()
    if (clickedOnEmpty) setSelectedId(null)
  }, [tool])

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] w-[90vw] sm:max-w-[90vw] flex-col p-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* Full canvas area with floating controls */}
        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#f5f5f5]"
        >

          {/* ─── Floating: top-center tool bar ─── */}
          <div className="absolute top-3 left-1/2 z-20 -translate-x-1/2 flex items-center gap-0.5 rounded-xl bg-white px-1.5 py-1.5 shadow-lg border border-black/8">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTool(t.key)
                  if (t.key !== 'select') setSelectedId(null)
                  if (t.key === 'select') setToolCursor(null)
                }}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 transition-colors',
                  tool === t.key
                    ? 'bg-[#e8e8ff] text-[#6965db]'
                    : 'text-[#1b1b1f] hover:bg-[#f0f0f0]',
                )}
                title={t.label}
              >
                <t.icon className="size-[18px]" />
                <span className="text-[10px] font-medium leading-none">{t.label}</span>
              </button>
            ))}
          </div>

          {/* ─── Floating: top-right actions ─── */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSaveAsDialog(!showSaveAsDialog)}
                disabled={savingAsPhoto}
                className="shadow-lg gap-1.5 rounded-lg bg-white"
              >
                <Download className="size-4" />
                Salvar como foto
              </Button>
              {showSaveAsDialog && (
                <div className="absolute top-full right-0 mt-2 w-56 rounded-xl bg-white p-3 shadow-lg border border-black/8 space-y-3">
                  <p className="text-[11px] font-medium text-[#868e96] uppercase tracking-wider">Estágio da foto</p>
                  <div className="flex flex-col gap-1">
                    {Object.entries(timelineStageLabels).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSaveAsStage(key)}
                        className={cn(
                          'rounded-md px-3 py-2 text-left text-sm transition-colors',
                          saveAsStage === key
                            ? 'bg-[#e8e8ff] text-[#6965db] font-medium'
                            : 'hover:bg-[#f0f0f0] text-[#1b1b1f]',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSaveAsPhoto}
                    disabled={savingAsPhoto}
                    className="w-full bg-forest text-cream hover:bg-sage gap-1.5"
                  >
                    {savingAsPhoto ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    Salvar
                  </Button>
                </div>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-forest text-cream hover:bg-sage shadow-lg gap-1.5 rounded-lg"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar anotação
            </Button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-9 items-center justify-center rounded-lg bg-white text-[#1b1b1f] shadow-lg border border-black/8 hover:bg-[#f0f0f0] transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* ─── Floating: left sidebar (properties) ─── */}
          <div className="absolute top-16 left-3 z-20 flex w-[180px] flex-col gap-4 rounded-xl bg-white p-3 shadow-lg border border-black/8">
            {/* Stroke color */}
            <div>
              <p className="mb-2 text-[11px] font-medium text-[#868e96] uppercase tracking-wider">Cor</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={cn(
                      'size-8 rounded-md transition-all border',
                      color === c.value
                        ? 'ring-2 ring-[#6965db] ring-offset-1 border-black/20'
                        : 'border-black/10 hover:border-black/25',
                    )}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setColor(c.value)}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            {/* Stroke width */}
            <div>
              <p className="mb-2 text-[11px] font-medium text-[#868e96] uppercase tracking-wider">Espessura</p>
              <div className="flex gap-1">
                {BRUSH_WIDTHS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={cn(
                      'flex h-9 flex-1 items-center justify-center rounded-md border transition-colors',
                      brushWidth === w
                        ? 'border-[#6965db] bg-[#e8e8ff]'
                        : 'border-black/8 hover:bg-[#f0f0f0]',
                    )}
                    onClick={() => setBrushWidth(w)}
                    title={`Espessura ${w}`}
                  >
                    <span
                      className="rounded-full bg-[#1b1b1f]"
                      style={{ width: w + 1, height: w + 1 }}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Floating: bottom-left undo/redo + zoom ─── */}
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-xl bg-white px-1 py-1 shadow-lg border border-black/8">
              <button
                type="button"
                onClick={handleZoomOut}
                className="flex size-9 items-center justify-center rounded-lg text-[#1b1b1f] transition-colors hover:bg-[#f0f0f0]"
                title="Diminuir zoom"
              >
                <ZoomOut className="size-[18px]" />
              </button>
              <span className="text-[11px] font-medium text-[#868e96] w-10 text-center tabular-nums">
                {Math.round(stageScale * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                className="flex size-9 items-center justify-center rounded-lg text-[#1b1b1f] transition-colors hover:bg-[#f0f0f0]"
                title="Aumentar zoom"
              >
                <ZoomIn className="size-[18px]" />
              </button>
              <button
                type="button"
                onClick={handleZoomReset}
                className="flex size-9 items-center justify-center rounded-lg text-[#1b1b1f] transition-colors hover:bg-[#f0f0f0]"
                title="Resetar zoom"
              >
                <Maximize className="size-[16px]" />
              </button>
            </div>
            <div className="flex items-center gap-0.5 rounded-xl bg-white px-1 py-1 shadow-lg border border-black/8">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                className="flex size-9 items-center justify-center rounded-lg text-[#1b1b1f] transition-colors hover:bg-[#f0f0f0] disabled:opacity-30"
                title="Desfazer"
              >
                <Undo2 className="size-[18px]" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                className="flex size-9 items-center justify-center rounded-lg text-[#1b1b1f] transition-colors hover:bg-[#f0f0f0] disabled:opacity-30"
                title="Refazer"
              >
                <Redo2 className="size-[18px]" />
              </button>
            </div>
          </div>
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {bgImage && stageSize.width > 0 && (
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePos.x}
              y={stagePos.y}
              onWheel={handleWheel}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onTouchStart={(e) => {
                if (e.evt.touches.length === 2) {
                  handlePinch(e)
                } else {
                  handleStageMouseDown()
                }
              }}
              onTouchMove={(e) => {
                if (e.evt.touches.length === 2) {
                  handlePinch(e)
                } else {
                  handleStageMouseMove()
                }
              }}
              onTouchEnd={(e) => {
                handlePinchEnd()
                if (e.evt.touches.length === 0) {
                  handleStageMouseUp()
                }
              }}
              onMouseLeave={() => { handleStageMouseUp(); setShapePreview(null); setToolCursor(null) }}
              onClick={handleStageClick}
              onTap={handleStageClick}
              style={{ cursor: tool === 'select' ? 'default' : 'none' }}
            >
              {/* Background image layer (non-interactive) */}
              <Layer name="bg-layer" listening={false}>
                <KonvaImage
                  image={bgImage}
                  width={stageSize.width}
                  height={stageSize.height}
                />
              </Layer>

              {/* Drawing layer */}
              <Layer>
                {shapes.map((shape) => {
                  const isDraggable = tool === 'select'
                  const isSelected = selectedId === shape.id

                  switch (shape.type) {
                    case 'freedraw':
                      return (
                        <Line
                          key={shape.id}
                          id={shape.id}
                          points={shape.points}
                          stroke={shape.color}
                          strokeWidth={shape.strokeWidth}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.5}
                          draggable={isDraggable}
                          onClick={() => tool === 'select' && setSelectedId(shape.id)}
                          onTap={() => tool === 'select' && setSelectedId(shape.id)}
                          shadowBlur={isSelected ? 6 : 0}
                          shadowColor="#3b82f6"
                        />
                      )
                    case 'arrow':
                      return (
                        <Arrow
                          key={shape.id}
                          id={shape.id}
                          points={shape.points}
                          stroke={shape.color}
                          strokeWidth={shape.strokeWidth}
                          fill={shape.color}
                          pointerLength={12}
                          pointerWidth={10}
                          draggable={isDraggable}
                          onClick={() => tool === 'select' && setSelectedId(shape.id)}
                          onTap={() => tool === 'select' && setSelectedId(shape.id)}
                          shadowBlur={isSelected ? 6 : 0}
                          shadowColor="#3b82f6"
                        />
                      )
                    case 'line':
                      return (
                        <Line
                          key={shape.id}
                          id={shape.id}
                          points={shape.points}
                          stroke={shape.color}
                          strokeWidth={shape.strokeWidth}
                          lineCap="round"
                          draggable={isDraggable}
                          onClick={() => tool === 'select' && setSelectedId(shape.id)}
                          onTap={() => tool === 'select' && setSelectedId(shape.id)}
                          shadowBlur={isSelected ? 6 : 0}
                          shadowColor="#3b82f6"
                        />
                      )
                    case 'ellipse':
                      return (
                        <Ellipse
                          key={shape.id}
                          id={shape.id}
                          x={shape.x}
                          y={shape.y}
                          radiusX={shape.radiusX}
                          radiusY={shape.radiusY}
                          stroke={shape.color}
                          strokeWidth={shape.strokeWidth}
                          fill="transparent"
                          draggable={isDraggable}
                          onClick={() => tool === 'select' && setSelectedId(shape.id)}
                          onTap={() => tool === 'select' && setSelectedId(shape.id)}
                          shadowBlur={isSelected ? 6 : 0}
                          shadowColor="#3b82f6"
                        />
                      )
                    case 'eraser':
                      return (
                        <Line
                          key={shape.id}
                          id={shape.id}
                          points={shape.points}
                          stroke="#000000"
                          strokeWidth={shape.strokeWidth}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.5}
                          globalCompositeOperation="destination-out"
                        />
                      )
                    case 'text':
                      return (
                        <Text
                          key={shape.id}
                          id={shape.id}
                          x={shape.x}
                          y={shape.y}
                          text={shape.text}
                          fontSize={shape.fontSize}
                          fill={shape.color}
                          draggable={isDraggable}
                          onClick={() => tool === 'select' && setSelectedId(shape.id)}
                          onTap={() => tool === 'select' && setSelectedId(shape.id)}
                          shadowBlur={isSelected ? 6 : 0}
                          shadowColor="#3b82f6"
                        />
                      )
                    default:
                      return null
                  }
                })}

                {/* Shape preview while dragging */}
                {shapePreview && tool === 'arrow' && (
                  <Arrow
                    points={[shapePreview.start.x, shapePreview.start.y, shapePreview.end.x, shapePreview.end.y]}
                    stroke={color}
                    strokeWidth={brushWidth}
                    fill={color}
                    pointerLength={12}
                    pointerWidth={10}
                    opacity={0.4}
                    dash={[6, 4]}
                    listening={false}
                  />
                )}
                {shapePreview && tool === 'line' && (
                  <Line
                    points={[shapePreview.start.x, shapePreview.start.y, shapePreview.end.x, shapePreview.end.y]}
                    stroke={color}
                    strokeWidth={brushWidth}
                    lineCap="round"
                    opacity={0.4}
                    dash={[6, 4]}
                    listening={false}
                  />
                )}
                {shapePreview && tool === 'circle' && (
                  <Ellipse
                    x={(shapePreview.start.x + shapePreview.end.x) / 2}
                    y={(shapePreview.start.y + shapePreview.end.y) / 2}
                    radiusX={Math.abs(shapePreview.end.x - shapePreview.start.x) / 2}
                    radiusY={Math.abs(shapePreview.end.y - shapePreview.start.y) / 2}
                    stroke={color}
                    strokeWidth={brushWidth}
                    fill="transparent"
                    opacity={0.4}
                    dash={[6, 4]}
                    listening={false}
                  />
                )}

                {/* Tool cursor indicator */}
                {tool !== 'select' && toolCursor && (
                  <KonvaCircle
                    x={toolCursor.x}
                    y={toolCursor.y}
                    radius={tool === 'eraser' ? brushWidth * 2 : brushWidth / 2 + 1}
                    stroke={tool === 'eraser' ? '#666' : color}
                    strokeWidth={1}
                    dash={tool === 'eraser' ? [3, 3] : undefined}
                    fill={tool === 'eraser' ? undefined : `${color}33`}
                    listening={false}
                  />
                )}
              </Layer>
            </Stage>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

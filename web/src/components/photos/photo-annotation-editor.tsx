'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Stage, Layer, Line, Arrow, Ellipse, Text, Image as KonvaImage } from 'react-konva'
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

type AnnotationShape = FreeDrawShape | ArrowShape | LineShape | EllipseShape | TextShape

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
    return pos ? { x: pos.x, y: pos.y } : null
  }, [])

  const handleStageMouseDown = useCallback(() => {
    const pos = getPointerPos()
    if (!pos) return

    if (tool === 'select') return

    if (tool === 'eraser') {
      // Find shape under pointer and remove it
      const stage = stageRef.current
      if (!stage) return
      const target = stage.getIntersection(pos)
      if (target && target.parent !== stage.findOne('.bg-layer')) {
        const shapeId = target.id() || target.parent?.id()
        if (shapeId) {
          const newShapes = shapes.filter((s) => s.id !== shapeId)
          setShapes(newShapes)
          pushHistory(newShapes)
        }
      }
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
    if (!isDrawing.current) return
    const pos = getPointerPos()
    if (!pos) return

    if (tool === 'pencil') {
      currentFreeDrawPoints.current = [...currentFreeDrawPoints.current, pos.x, pos.y]
      // Force re-render for live preview
      setShapes((prev) => {
        const existing = prev.filter((s) => s.id !== '__drawing__')
        return [...existing, {
          id: '__drawing__',
          type: 'freedraw' as const,
          points: [...currentFreeDrawPoints.current],
          color,
          strokeWidth: brushWidth,
        }]
      })
    }
  }, [tool, color, brushWidth, getPointerPos])

  const handleStageMouseUp = useCallback(() => {
    if (!isDrawing.current || !drawStart.current) return
    isDrawing.current = false

    const pos = getPointerPos()
    if (!pos) return

    const start = drawStart.current
    drawStart.current = null

    if (tool === 'pencil') {
      const points = currentFreeDrawPoints.current
      currentFreeDrawPoints.current = []
      if (points.length < 4) return
      const newShape: FreeDrawShape = {
        id: genId(),
        type: 'freedraw',
        points,
        color,
        strokeWidth: brushWidth,
      }
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

          {/* ─── Floating: bottom-left undo/redo ─── */}
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-0.5 rounded-xl bg-white px-1 py-1 shadow-lg border border-black/8">
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
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onTouchStart={handleStageMouseDown}
              onTouchMove={handleStageMouseMove}
              onTouchEnd={handleStageMouseUp}
              onClick={handleStageClick}
              onTap={handleStageClick}
              style={{ cursor: tool === 'select' ? 'default' : tool === 'eraser' ? 'not-allowed' : 'crosshair' }}
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
              </Layer>
            </Stage>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Pencil,
  ArrowUp,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Save,
  X,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { saveAnnotationAction, getAnnotationAction } from '@/actions/photos'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoAnnotationEditorProps {
  photo: PhotoAssetWithUrl | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DrawingTool = 'pencil' | 'arrow' | 'text' | 'eraser'

const PRESET_COLORS = [
  { name: 'Vermelho', value: '#ef4444' },
  { name: 'Azul', value: '#3b82f6' },
  { name: 'Verde', value: '#22c55e' },
  { name: 'Amarelo', value: '#eab308' },
  { name: 'Branco', value: '#ffffff' },
  { name: 'Preto', value: '#000000' },
]

const BRUSH_WIDTHS = [2, 4, 6, 8]

// ─── Component ──────────────────────────────────────────────────────

export function PhotoAnnotationEditor({
  photo,
  open,
  onOpenChange,
}: PhotoAnnotationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<DrawingTool>('pencil')
  const [color, setColor] = useState('#ef4444')
  const [brushWidth, setBrushWidth] = useState(4)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const isAddingArrow = useRef(false)
  const arrowStartPoint = useRef<{ x: number; y: number } | null>(null)

  // Initialize Fabric.js canvas when dialog opens
  useEffect(() => {
    if (!open || !photo?.signedUrl || !canvasRef.current) return

    let cancelled = false

    const initCanvas = async () => {
      setLoading(true)

      // Dynamic import of Fabric.js
      const fabric = await import('fabric')

      if (cancelled || !canvasRef.current) return

      // Clean up existing canvas
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose()
        fabricCanvasRef.current = null
      }

      const container = containerRef.current
      if (!container) return

      const containerWidth = container.clientWidth
      const containerHeight = container.clientHeight - 60 // Leave room for toolbar

      // Load background image to get dimensions
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = async () => {
        if (cancelled) return

        // Scale image to fit container
        const scale = Math.min(
          containerWidth / img.width,
          containerHeight / img.height,
          1
        )
        const canvasWidth = Math.round(img.width * scale)
        const canvasHeight = Math.round(img.height * scale)

        canvasRef.current!.width = canvasWidth
        canvasRef.current!.height = canvasHeight

        const canvas = new fabric.Canvas(canvasRef.current!, {
          width: canvasWidth,
          height: canvasHeight,
          isDrawingMode: true,
        })

        fabricCanvasRef.current = canvas

        // Set background image
        const bgImage = new fabric.FabricImage(img, {
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
        })
        canvas.backgroundImage = bgImage
        canvas.renderAll()

        // Configure brush
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
        canvas.freeDrawingBrush.color = color
        canvas.freeDrawingBrush.width = brushWidth

        // Track changes for undo
        canvas.on('object:added', () => {
          if (!cancelled) {
            const json = JSON.stringify(canvas.toJSON())
            setUndoStack((prev) => [...prev, json])
            setRedoStack([])
          }
        })

        // Load existing annotation
        try {
          const result = await getAnnotationAction(photo.id)
          if (result.success && result.data?.annotationData) {
            const annotationData = result.data.annotationData as Record<string, unknown>
            // Load annotation objects onto canvas, keeping the background
            await canvas.loadFromJSON(annotationData)
            // Restore background since loadFromJSON may override it
            canvas.backgroundImage = bgImage
            canvas.renderAll()
          }
        } catch {
          // Annotation not found or error - continue without annotations
        }

        setLoading(false)
      }

      img.onerror = () => {
        setLoading(false)
      }

      img.src = photo.signedUrl!
    }

    initCanvas()

    return () => {
      cancelled = true
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose()
        fabricCanvasRef.current = null
      }
    }
  }, [open, photo?.signedUrl, photo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update brush settings when tool/color/width change
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    const updateBrush = async () => {
      const fabric = await import('fabric')

      if (tool === 'pencil') {
        canvas.isDrawingMode = true
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
        canvas.freeDrawingBrush.color = color
        canvas.freeDrawingBrush.width = brushWidth
      } else if (tool === 'eraser') {
        canvas.isDrawingMode = true
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
        canvas.freeDrawingBrush.color = '#ffffff'
        canvas.freeDrawingBrush.width = brushWidth * 3
      } else {
        canvas.isDrawingMode = false
      }
    }

    updateBrush()
  }, [tool, color, brushWidth])

  // Handle arrow tool
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || tool !== 'arrow') return

    const handleMouseDown = (opt: any) => {
      const pointer = canvas.getScenePoint(opt.e)
      isAddingArrow.current = true
      arrowStartPoint.current = { x: pointer.x, y: pointer.y }
    }

    const handleMouseUp = async (opt: any) => {
      if (!isAddingArrow.current || !arrowStartPoint.current) return
      isAddingArrow.current = false

      const pointer = canvas.getScenePoint(opt.e)
      const start = arrowStartPoint.current
      arrowStartPoint.current = null

      const fabric = await import('fabric')

      // Create arrow line
      const line = new fabric.Line([start.x, start.y, pointer.x, pointer.y], {
        stroke: color,
        strokeWidth: brushWidth,
        selectable: true,
      })

      // Create arrowhead
      const angle = Math.atan2(pointer.y - start.y, pointer.x - start.x)
      const headLen = 15
      const arrowHead = new fabric.Polygon(
        [
          { x: pointer.x, y: pointer.y },
          {
            x: pointer.x - headLen * Math.cos(angle - Math.PI / 6),
            y: pointer.y - headLen * Math.sin(angle - Math.PI / 6),
          },
          {
            x: pointer.x - headLen * Math.cos(angle + Math.PI / 6),
            y: pointer.y - headLen * Math.sin(angle + Math.PI / 6),
          },
        ],
        {
          fill: color,
          selectable: true,
        }
      )

      const group = new fabric.Group([line, arrowHead], { selectable: true })
      canvas.add(group)
      canvas.renderAll()
    }

    canvas.on('mouse:down', handleMouseDown)
    canvas.on('mouse:up', handleMouseUp)

    return () => {
      canvas.off('mouse:down', handleMouseDown)
      canvas.off('mouse:up', handleMouseUp)
    }
  }, [tool, color, brushWidth])

  // Handle text tool
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || tool !== 'text') return

    const handleMouseDown = async (opt: any) => {
      const pointer = canvas.getScenePoint(opt.e)
      const fabric = await import('fabric')

      const text = new fabric.IText('Texto', {
        left: pointer.x,
        top: pointer.y,
        fill: color,
        fontSize: brushWidth * 5,
        fontFamily: 'sans-serif',
        selectable: true,
        editable: true,
      })

      canvas.add(text)
      canvas.setActiveObject(text)
      text.enterEditing()
      canvas.renderAll()
    }

    canvas.on('mouse:down', handleMouseDown)

    return () => {
      canvas.off('mouse:down', handleMouseDown)
    }
  }, [tool, color, brushWidth])

  const handleUndo = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || undoStack.length === 0) return

    const current = JSON.stringify(canvas.toJSON())
    setRedoStack((prev) => [...prev, current])

    const previous = undoStack[undoStack.length - 1]
    setUndoStack((prev) => prev.slice(0, -1))

    // Save current background before loading
    const bg = canvas.backgroundImage

    canvas.loadFromJSON(JSON.parse(previous)).then(() => {
      canvas.backgroundImage = bg
      canvas.renderAll()
    })
  }, [undoStack])

  const handleRedo = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || redoStack.length === 0) return

    const current = JSON.stringify(canvas.toJSON())
    setUndoStack((prev) => [...prev, current])

    const next = redoStack[redoStack.length - 1]
    setRedoStack((prev) => prev.slice(0, -1))

    const bg = canvas.backgroundImage

    canvas.loadFromJSON(JSON.parse(next)).then(() => {
      canvas.backgroundImage = bg
      canvas.renderAll()
    })
  }, [redoStack])

  const handleSave = useCallback(async () => {
    const canvas = fabricCanvasRef.current
    if (!canvas || !photo) return

    setSaving(true)
    try {
      const annotationData = canvas.toJSON() as Record<string, unknown>
      await saveAnnotationAction(photo.id, annotationData)
    } finally {
      setSaving(false)
    }
  }, [photo])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] max-w-5xl flex-col p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Anotar Foto — {photo?.originalFilename ?? 'Foto'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Salvar
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          {/* Drawing tools */}
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <Button
              variant={tool === 'pencil' ? 'default' : 'ghost'}
              size="icon-xs"
              onClick={() => setTool('pencil')}
              title="Pincel"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant={tool === 'arrow' ? 'default' : 'ghost'}
              size="icon-xs"
              onClick={() => setTool('arrow')}
              title="Seta"
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              variant={tool === 'text' ? 'default' : 'ghost'}
              size="icon-xs"
              onClick={() => setTool('text')}
              title="Texto"
            >
              <Type className="size-3.5" />
            </Button>
            <Button
              variant={tool === 'eraser' ? 'default' : 'ghost'}
              size="icon-xs"
              onClick={() => setTool('eraser')}
              title="Borracha"
            >
              <Eraser className="size-3.5" />
            </Button>
          </div>

          {/* Color picker */}
          <div className="flex items-center gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={cn(
                  'size-5 rounded-full border-2 transition-transform',
                  color === c.value ? 'scale-125 border-ring' : 'border-transparent hover:scale-110'
                )}
                style={{ backgroundColor: c.value }}
                onClick={() => setColor(c.value)}
                title={c.name}
              />
            ))}
          </div>

          {/* Brush width */}
          <div className="flex items-center gap-1">
            {BRUSH_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={cn(
                  'flex size-6 items-center justify-center rounded border transition-colors',
                  brushWidth === w ? 'border-ring bg-muted' : 'border-transparent hover:bg-muted/50'
                )}
                onClick={() => setBrushWidth(w)}
                title={`Espessura ${w}`}
              >
                <span
                  className="rounded-full bg-foreground"
                  style={{ width: w + 2, height: w + 2 }}
                />
              </button>
            ))}
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Desfazer"
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Refazer"
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-muted/30"
        >
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}
          <canvas ref={canvasRef} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

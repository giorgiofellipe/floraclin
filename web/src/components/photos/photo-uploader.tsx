'use client'

import * as React from 'react'
import { useCallback, useState, useRef } from 'react'
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  timelineStageLabels,
  validateImageFile,
  MAX_IMAGE_WIDTH,
  ACCEPTED_IMAGE_TYPES,
  isDngFile,
} from '@/validations/photo'
import type { TimelineStage } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoUploaderProps {
  patientId: string
  procedureRecordId?: string
  onUploadComplete?: () => void
  defaultStage?: TimelineStage
}

interface PendingFile {
  id: string
  file: File
  preview: string
  status: 'pending' | 'decoding' | 'compressing' | 'uploading' | 'done' | 'error'
  error?: string
  progress: number
}

// ─── DNG → JPEG extractor ──────────────────────────────────────────
//
// iPhone ProRAW and camera DNG files embed a full-resolution JPEG preview
// inside the TIFF/IFD structure. libraw-wasm cannot process "linear DNG"
// files (already-demosaiced, like ProRAW) — known open issue. Instead we
// parse the IFD chain to locate the largest embedded JPEG and return it
// directly. Zero WASM, zero demosaicing, and it preserves Apple's own
// computational photography rendering.

const TIFF_TAG_COMPRESSION = 0x0103
const TIFF_TAG_STRIP_OFFSETS = 0x0111
const TIFF_TAG_STRIP_BYTE_COUNTS = 0x0117
const TIFF_TAG_SUB_IFDS = 0x014a
const TIFF_TAG_JPEG_OFFSET = 0x0201
const TIFF_TAG_JPEG_LENGTH = 0x0202
const TIFF_COMPRESSION_JPEG_OLD = 6
const TIFF_COMPRESSION_JPEG = 7
const JPEG_SOI = 0xffd8

function extractJpegFromDng(buf: ArrayBuffer): Uint8Array | null {
  const view = new DataView(buf)
  const le = view.getUint16(0, false) === 0x4949
  const read16 = (off: number) => view.getUint16(off, le)
  const read32 = (off: number) => view.getUint32(off, le)

  const magic = read16(2)
  if (magic !== 42 && magic !== 43) return null

  let bestJpeg: { offset: number; length: number } | null = null
  const visited = new Set<number>()
  const ifdQueue: number[] = [read32(4)]

  while (ifdQueue.length > 0) {
    const ifdOffset = ifdQueue.pop()!
    if (ifdOffset === 0 || ifdOffset >= buf.byteLength || visited.has(ifdOffset)) continue
    visited.add(ifdOffset)

    const entryCount = read16(ifdOffset)
    if (entryCount > 500) continue

    let compression = 0
    let stripOffset = 0
    let stripLength = 0
    let jpegOffset = 0
    let jpegLength = 0
    const subIfdOffsets: number[] = []

    for (let i = 0; i < entryCount; i++) {
      const entryOff = ifdOffset + 2 + i * 12
      if (entryOff + 12 > buf.byteLength) break
      const tag = read16(entryOff)
      const type = read16(entryOff + 2)
      const count = read32(entryOff + 4)
      const valueOff = entryOff + 8

      const readValue = () => {
        if (type === 3 && count === 1) return read16(valueOff)
        if (type === 4 && count === 1) return read32(valueOff)
        if (type === 4 && count > 1) return read32(read32(valueOff))
        return read32(valueOff)
      }

      switch (tag) {
        case TIFF_TAG_COMPRESSION:
          compression = readValue()
          break
        case TIFF_TAG_STRIP_OFFSETS:
          stripOffset = readValue()
          break
        case TIFF_TAG_STRIP_BYTE_COUNTS:
          stripLength = readValue()
          break
        case TIFF_TAG_JPEG_OFFSET:
          jpegOffset = readValue()
          break
        case TIFF_TAG_JPEG_LENGTH:
          jpegLength = readValue()
          break
        case TIFF_TAG_SUB_IFDS:
          if (type === 4) {
            const ptr = count > 1 ? read32(valueOff) : valueOff
            for (let j = 0; j < count; j++) {
              subIfdOffsets.push(read32(count > 1 ? ptr + j * 4 : valueOff))
            }
          }
          break
      }
    }

    if (jpegOffset > 0 && jpegLength > 0 && jpegOffset + jpegLength <= buf.byteLength) {
      if (!bestJpeg || jpegLength > bestJpeg.length) {
        if (view.getUint16(jpegOffset, false) === JPEG_SOI) {
          bestJpeg = { offset: jpegOffset, length: jpegLength }
        }
      }
    }

    if (
      (compression === TIFF_COMPRESSION_JPEG || compression === TIFF_COMPRESSION_JPEG_OLD) &&
      stripOffset > 0 &&
      stripLength > 0 &&
      stripOffset + stripLength <= buf.byteLength
    ) {
      if (!bestJpeg || stripLength > bestJpeg.length) {
        if (view.getUint16(stripOffset, false) === JPEG_SOI) {
          bestJpeg = { offset: stripOffset, length: stripLength }
        }
      }
    }

    for (const off of subIfdOffsets) ifdQueue.push(off)

    const nextIfdOff = ifdOffset + 2 + entryCount * 12
    if (nextIfdOff + 4 <= buf.byteLength) {
      ifdQueue.push(read32(nextIfdOff))
    }
  }

  if (!bestJpeg) return null
  return new Uint8Array(buf, bestJpeg.offset, bestJpeg.length)
}

async function decodeDngToJpeg(file: File): Promise<File> {
  const buf = await file.arrayBuffer()
  const jpeg = extractJpegFromDng(buf)
  if (!jpeg) {
    throw new Error(
      'Não foi possível extrair a imagem JPEG do arquivo DNG. ' +
        'Verifique se o arquivo não está corrompido.',
    )
  }
  const copy = new Uint8Array(jpeg.length)
  copy.set(jpeg)
  return new File([copy.buffer as ArrayBuffer], file.name.replace(/\.dng$/i, '.jpg'), {
    type: 'image/jpeg',
  })
}

// ─── Image compression utility ──────────────────────────────────────

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      let { width, height } = img

      // Only resize if wider than MAX_IMAGE_WIDTH
      if (width <= MAX_IMAGE_WIDTH) {
        // Try to convert to WebP without resize
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file)
          return
        }
        ctx.drawImage(img, 0, 0)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file)
              return
            }
            const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
              type: 'image/webp',
            })
            resolve(compressed)
          },
          'image/webp',
          0.85
        )
        return
      }

      // Resize proportionally
      const ratio = MAX_IMAGE_WIDTH / width
      width = MAX_IMAGE_WIDTH
      height = Math.round(height * ratio)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
            type: 'image/webp',
          })
          resolve(compressed)
        },
        'image/webp',
        0.85
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Erro ao processar imagem'))
    }

    img.src = url
  })
}

// ─── Component ──────────────────────────────────────────────────────

export function PhotoUploader({
  patientId,
  procedureRecordId,
  onUploadComplete,
  defaultStage,
}: PhotoUploaderProps) {
  const [files, setFiles] = useState<PendingFile[]>([])
  const [timelineStage, setTimelineStage] = useState<TimelineStage>(defaultStage ?? 'pre')
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (newFiles: FileList | File[]) => {
    const incoming = Array.from(newFiles)
    const pending: PendingFile[] = []

    for (const file of incoming) {
      const error = validateImageFile(file)
      if (error) {
        pending.push({ id: crypto.randomUUID(), file, preview: '', status: 'error', error, progress: 0 })
        continue
      }
      let preview = ''
      if (isDngFile(file)) {
        try {
          const jpeg = extractJpegFromDng(await file.arrayBuffer())
          if (jpeg) {
            const copy = new Uint8Array(jpeg.length)
            copy.set(jpeg)
            preview = URL.createObjectURL(new Blob([copy.buffer as ArrayBuffer], { type: 'image/jpeg' }))
          }
        } catch { /* preview stays empty */ }
      } else {
        preview = URL.createObjectURL(file)
      }
      pending.push({ id: crypto.randomUUID(), file, preview, status: 'pending', progress: 0 })
    }

    setFiles((prev) => [...prev, ...pending])
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.preview) URL.revokeObjectURL(file.preview)
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files)
        e.target.value = '' // Reset to allow re-selection
      }
    },
    [addFiles]
  )

  const uploadAll = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending')
    if (pendingFiles.length === 0) return

    setIsUploading(true)

    for (const pendingFile of pendingFiles) {
      try {
        // DNG files must be decoded to JPEG client-side before the
        // standard compress/resize pass (browsers can't render DNG).
        let workingFile = pendingFile.file
        if (isDngFile(workingFile)) {
          setFiles((prev) =>
            prev.map((f) => (f.id === pendingFile.id ? { ...f, status: 'decoding' as const, progress: 10 } : f))
          )
          workingFile = await decodeDngToJpeg(workingFile)
        }

        // Compress
        setFiles((prev) =>
          prev.map((f) => (f.id === pendingFile.id ? { ...f, status: 'compressing' as const, progress: 20 } : f))
        )
        const compressed = await compressImage(workingFile)

        // Upload
        setFiles((prev) =>
          prev.map((f) => (f.id === pendingFile.id ? { ...f, status: 'uploading' as const, progress: 50 } : f))
        )

        const formData = new FormData()
        formData.set('file', compressed)
        formData.set('patientId', patientId)
        formData.set('timelineStage', timelineStage)
        if (procedureRecordId) {
          formData.set('procedureRecordId', procedureRecordId)
        }

        const res = await fetch('/api/photos', { method: 'POST', body: formData })
        const result = await res.json()

        if (result.success) {
          setFiles((prev) =>
            prev.map((f) => (f.id === pendingFile.id ? { ...f, status: 'done' as const, progress: 100 } : f))
          )
          setTimeout(() => {
            setFiles((prev) => {
              const file = prev.find((f) => f.id === pendingFile.id)
              if (file?.preview) URL.revokeObjectURL(file.preview)
              return prev.filter((f) => f.id !== pendingFile.id)
            })
          }, 1500)
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === pendingFile.id
                ? { ...f, status: 'error' as const, error: result.error, progress: 0 }
                : f
            )
          )
        }
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Erro inesperado ao fazer upload'
        console.error('[photo-uploader] upload failed', {
          name: pendingFile.file.name,
          type: pendingFile.file.type,
          size: pendingFile.file.size,
          error: err,
        })
        setFiles((prev) =>
          prev.map((f) =>
            f.id === pendingFile.id
              ? { ...f, status: 'error' as const, error: message, progress: 0 }
              : f
          )
        )
      }
    }

    setIsUploading(false)
    onUploadComplete?.()
  }, [files, patientId, procedureRecordId, timelineStage, onUploadComplete])

  const pendingCount = files.filter((f) => f.status === 'pending').length
  // Include the .dng extension so the native file picker surfaces DNG files
  // even when the browser reports them with an empty or octet-stream MIME.
  const accept = [...ACCEPTED_IMAGE_TYPES, '.dng', 'image/x-adobe-dng'].join(',')

  return (
    <div className="space-y-4">
      {/* Timeline stage selector */}
      <div className="flex items-center gap-3">
        <Label htmlFor="timeline-stage" className="uppercase tracking-wider text-xs text-mid">Estagio</Label>
        <Select items={timelineStageLabels} value={timelineStage} onValueChange={(v) => v && setTimelineStage(v as TimelineStage)}>
          <SelectTrigger className="w-48 border-sage/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          'relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-[3px] border-2 border-dashed p-8 transition-all duration-200',
          isDragOver
            ? 'border-sage bg-sage/5 scale-[1.01]'
            : 'border-[#E8ECEF] hover:border-sage/50 hover:bg-[#F4F6F8]'
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-white">
          <Upload className="size-5 text-sage" />
        </div>
        <p className="text-sm font-medium text-charcoal">
          Arraste e solte fotos aqui
        </p>
        <p className="mt-1 text-xs text-mid">
          ou clique para selecionar (JPEG, PNG, WebP - max 10MB)
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* File previews */}
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {files.map((f) => (
              <div
                key={f.id}
                className={cn(
                  'relative overflow-hidden rounded-[3px] border shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors duration-200',
                  f.status === 'error' && 'border-red-300 bg-red-50/30',
                  f.status === 'done' && 'border-mint/50 bg-white',
                  f.status === 'pending' && 'border-[#E8ECEF] bg-white',
                  (f.status === 'decoding' || f.status === 'compressing' || f.status === 'uploading') && 'border-[#E8ECEF] bg-white'
                )}
              >
                <div className="aspect-square">
                  {f.preview ? (
                    <img
                      src={f.preview}
                      alt={f.file.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="size-8 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Status overlay */}
                {f.status !== 'pending' && f.status !== 'done' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
                    {f.status === 'decoding' && (
                      <>
                        <Loader2 className="size-6 animate-spin text-white" />
                        <span className="mt-1 text-xs text-white">Decodificando DNG...</span>
                      </>
                    )}
                    {f.status === 'compressing' && (
                      <>
                        <Loader2 className="size-6 animate-spin text-white" />
                        <span className="mt-1 text-xs text-white">Comprimindo...</span>
                      </>
                    )}
                    {f.status === 'uploading' && (
                      <>
                        <Loader2 className="size-6 animate-spin text-white" />
                        <span className="mt-1 text-xs text-white">Enviando...</span>
                      </>
                    )}
                    {f.status === 'error' && (
                      <span className="px-2 text-center text-xs text-red-300">
                        {f.error}
                      </span>
                    )}
                  </div>
                )}

                {/* Done indicator */}
                {f.status === 'done' && (
                  <div className="absolute top-1 right-1 rounded-full bg-mint p-0.5">
                    <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}

                {/* Remove button */}
                {(f.status === 'pending' || f.status === 'error') && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(f.id)
                    }}
                    className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70"
                  >
                    <X className="size-3.5" />
                  </button>
                )}

                {/* File name */}
                <div className="truncate px-2.5 py-1.5 text-xs text-mid">
                  {f.file.name}
                </div>
              </div>
            ))}
          </div>

          {/* Upload button */}
          {pendingCount > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-[#F4F6F8]/50 px-4 py-3">
              <span className="text-sm text-charcoal">
                {pendingCount} {pendingCount === 1 ? 'foto pronta' : 'fotos prontas'} para envio
              </span>
              <Button onClick={uploadAll} disabled={isUploading} className="bg-forest text-cream hover:bg-sage shadow-sm">
                {isUploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    Enviar {pendingCount === 1 ? 'foto' : 'fotos'}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

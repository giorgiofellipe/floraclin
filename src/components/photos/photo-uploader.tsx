'use client'

import * as React from 'react'
import { useCallback, useState, useRef } from 'react'
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { uploadPhotoAction } from '@/actions/photos'
import {
  timelineStageValues,
  timelineStageLabels,
  validateImageFile,
  MAX_IMAGE_WIDTH,
  ACCEPTED_IMAGE_TYPES,
} from '@/validations/photo'
import type { TimelineStage } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoUploaderProps {
  patientId: string
  procedureRecordId?: string
  onUploadComplete?: () => void
}

interface PendingFile {
  id: string
  file: File
  preview: string
  status: 'pending' | 'compressing' | 'uploading' | 'done' | 'error'
  error?: string
  progress: number
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
}: PhotoUploaderProps) {
  const [files, setFiles] = useState<PendingFile[]>([])
  const [timelineStage, setTimelineStage] = useState<TimelineStage>('pre')
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const pending: PendingFile[] = Array.from(newFiles)
      .filter((f) => {
        const error = validateImageFile(f)
        return !error
      })
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        status: 'pending' as const,
        progress: 0,
      }))

    // Report validation errors
    Array.from(newFiles).forEach((f) => {
      const error = validateImageFile(f)
      if (error) {
        pending.push({
          id: crypto.randomUUID(),
          file: f,
          preview: '',
          status: 'error',
          error,
          progress: 0,
        })
      }
    })

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
        // Compress
        setFiles((prev) =>
          prev.map((f) => (f.id === pendingFile.id ? { ...f, status: 'compressing' as const, progress: 20 } : f))
        )
        const compressed = await compressImage(pendingFile.file)

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

        const result = await uploadPhotoAction(formData)

        if (result.success) {
          setFiles((prev) =>
            prev.map((f) => (f.id === pendingFile.id ? { ...f, status: 'done' as const, progress: 100 } : f))
          )
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === pendingFile.id
                ? { ...f, status: 'error' as const, error: result.error, progress: 0 }
                : f
            )
          )
        }
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === pendingFile.id
              ? { ...f, status: 'error' as const, error: 'Erro inesperado ao fazer upload', progress: 0 }
              : f
          )
        )
      }
    }

    setIsUploading(false)
    onUploadComplete?.()
  }, [files, patientId, procedureRecordId, timelineStage, onUploadComplete])

  const pendingCount = files.filter((f) => f.status === 'pending').length
  const accept = ACCEPTED_IMAGE_TYPES.join(',')

  return (
    <div className="space-y-4">
      {/* Timeline stage selector */}
      <div className="flex items-center gap-3">
        <Label htmlFor="timeline-stage" className="uppercase tracking-wider text-xs text-mid">Estagio</Label>
        <Select value={timelineStage} onValueChange={(v) => v && setTimelineStage(v as TimelineStage)}>
          <SelectTrigger className="w-48 border-sage/20">
            <SelectValue>
              {(value: string) => timelineStageLabels[value as TimelineStage] ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {timelineStageValues.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {timelineStageLabels[stage]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          'relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-200',
          isDragOver
            ? 'border-sage bg-sage/5 scale-[1.01]'
            : 'border-blush hover:border-sage/50 hover:bg-petal/20'
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-petal/60">
          <Upload className="size-5 text-sage" />
        </div>
        <p className="text-sm font-medium text-forest">
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
                  'relative overflow-hidden rounded-xl border shadow-sm transition-all duration-200',
                  f.status === 'error' && 'border-red-300 bg-red-50/30',
                  f.status === 'done' && 'border-mint/50 bg-mint/5',
                  f.status === 'pending' && 'border-sage/15 bg-cream/30',
                  (f.status === 'compressing' || f.status === 'uploading') && 'border-sage/15 bg-cream/30'
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
            <div className="flex items-center justify-between rounded-lg bg-petal/30 px-4 py-3">
              <span className="text-sm text-forest">
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

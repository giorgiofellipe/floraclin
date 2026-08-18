'use client'

import { useRef, useState } from 'react'
import { Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useQueryClient } from '@tanstack/react-query'

const MAX_BYTES = 1 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'

interface ClinicLogoUploaderProps {
  initialLogoUrl: string | null
}

/**
 * Upload / replace / clear the tenant's logo image. Used by the clinic
 * settings page; the saved URL is the same `tenants.logoUrl` that's read
 * by `<ClinicHeader>` (receitas, atestados, evoluções, termos de
 * consentimento, procedimentos, os relatórios em PDF e o prontuário
 * completo) and by the public booking page, so it shows up everywhere
 * automatically.
 */
export function ClinicLogoUploader({ initialLogoUrl }: ClinicLogoUploaderProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error('Logo muito grande. Máximo 1 MB.')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/tenant/logo', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar logo')
      setLogoUrl(data.logoUrl as string)
      qc.invalidateQueries({ queryKey: ['tenant'] })
      toast.success('Logo atualizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar logo')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleRemove() {
    if (!confirm('Remover o logo da clínica?')) return
    setRemoving(true)
    try {
      const res = await fetch('/api/tenant/logo', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao remover logo')
      }
      setLogoUrl(null)
      qc.invalidateQueries({ queryKey: ['tenant'] })
      toast.success('Logo removido')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover logo')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[3px] border border-dashed border-[#E8ECEF] bg-blush/30">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo can be SVG or hosted on Supabase storage, doesn't fit next/image's loader assumptions
          <img
            src={logoUrl}
            alt="Logo da clínica"
            className="h-full w-full object-contain p-2"
          />
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-mid">
            Sem logo
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <p className="text-sm text-charcoal">
          Aparece no topo de documentos impressos (receitas, atestados,
          evoluções, termos de consentimento e procedimentos), nos
          relatórios em PDF e no prontuário completo, além da página
          pública de agendamento.
        </p>
        <p className="text-xs text-mid">
          PNG, JPG, WebP ou SVG · Máximo 1 MB · Imagem quadrada recomendada (será
          centralizada e ajustada em 64 × 64 px no documento).
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || removing}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadIcon className="h-3.5 w-3.5" />
            )}
            {logoUrl ? 'Trocar logo' : 'Enviar logo'}
          </Button>
          {logoUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading || removing}
              onClick={handleRemove}
              className="text-mid hover:text-rose-700"
            >
              {removing ? (
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="h-3.5 w-3.5" />
              )}
              Remover
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </div>
    </div>
  )
}

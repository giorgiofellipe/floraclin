'use client'

import { useState } from 'react'
import { SendIcon, Copy, Loader2Icon, CheckIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SendAnamnesisDialogProps {
  patientId: string
  patientName: string
  patientPhone?: string
}

export function SendAnamnesisDialog({
  patientId,
  patientName,
  patientPhone,
}: SendAnamnesisDialogProps) {
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setUrl(null)
    setCopied(false)

    try {
      const res = await fetch(`/api/patients/${patientId}/anamnesis-link`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Falha ao gerar link')
      const data = await res.json()
      setUrl(data.url)
    } catch {
      toast.error('Erro ao gerar link de anamnese')
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    if (!url) return
    navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Link copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  function getWhatsAppUrl() {
    if (!url || !patientPhone) return null
    const digits = patientPhone.replace(/\D/g, '')
    const phone = digits.startsWith('55') ? digits : `55${digits}`
    const message = `Olá ${patientName.split(' ')[0]}! Preencha seu formulário de anamnese antes da consulta: ${url}`
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  }

  // Not generated yet — show the generate button
  if (!url) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="border-sage/20 text-sage hover:bg-sage/5 gap-2"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? (
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <SendIcon className="h-3.5 w-3.5" />
        )}
        {loading ? 'Gerando link...' : 'Enviar Anamnese'}
      </Button>
    )
  }

  // Link generated — show inline result
  const whatsAppUrl = getWhatsAppUrl()

  return (
    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
      {/* URL display (truncated) */}
      <div className="flex items-center gap-1.5 rounded-md border border-sage/15 bg-sage/5 px-2.5 py-1.5 text-xs text-mid max-w-[280px]">
        <span className="truncate">{url.replace('https://', '')}</span>
      </div>

      {/* Copy button */}
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all',
          copied
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-white border border-sage/20 text-charcoal hover:bg-sage/5'
        )}
      >
        {copied ? <CheckIcon className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>

      {/* WhatsApp button */}
      {whatsAppUrl && (
        <a
          href={whatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1DA851] transition-colors"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          WhatsApp
        </a>
      )}

      {/* Expiry note */}
      <span className="text-[10px] text-mid/50 whitespace-nowrap">2h</span>
    </div>
  )
}

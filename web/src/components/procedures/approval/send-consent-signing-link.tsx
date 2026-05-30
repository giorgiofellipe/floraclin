'use client'

import { useState } from 'react'
import { SendIcon, Copy, Loader2Icon, CheckIcon, ChevronDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface SendConsentSigningLinkProps {
  patientId: string
  patientName: string
  patientPhone?: string | null
  procedureRecordId: string
  consentTypes: string[]
  renderedContents?: Record<string, string>
  whatsappApiEnabled?: boolean
}

export function SendConsentSigningLink({
  patientId,
  patientName,
  patientPhone,
  procedureRecordId,
  consentTypes,
  renderedContents,
  whatsappApiEnabled = false,
}: SendConsentSigningLinkProps) {
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sendingApi, setSendingApi] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setUrl(null)
    setCopied(false)

    try {
      const res = await fetch('/api/consent/send-signing-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          procedureRecordId,
          consentTypes,
          renderedContents,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Falha ao gerar link')
      }
      const data = await res.json()
      setUrl(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar link de assinatura')
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

  async function handleSendViaApi() {
    if (!url) return
    setSendingApi(true)
    try {
      const res = await fetch('/api/consent/send-signing-link/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, patientId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao enviar' }))
        throw new Error(err.error || 'Erro ao enviar')
      }
      toast.success('Link de assinatura enviado via WhatsApp')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar via WhatsApp')
    } finally {
      setSendingApi(false)
    }
  }

  function getWhatsAppUrl() {
    if (!url || !patientPhone) return null
    const digits = patientPhone.replace(/\D/g, '')
    const phone = digits.startsWith('55') ? digits : `55${digits}`
    const firstName = patientName.split(' ')[0]
    const message = `Olá ${firstName}! Acesse o link abaixo para revisar e assinar os termos do seu procedimento: ${url}`
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  }

  if (!url) {
    return (
      <button
        type="button"
        className="flex items-center gap-2 rounded-[3px] border border-forest/30 px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal disabled:opacity-50"
        onClick={handleGenerate}
        disabled={loading || consentTypes.length === 0}
      >
        {loading ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <SendIcon className="size-4" />
        )}
        {loading ? 'Gerando link...' : 'Enviar termos e contrato para assinatura'}
      </button>
    )
  }

  const whatsAppUrl = getWhatsAppUrl()

  return (
    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
      <div className="flex items-center gap-1.5 rounded-md border border-sage/15 bg-sage/5 px-2.5 py-1.5 text-xs text-mid max-w-[280px]">
        <span className="truncate">{url.replace('https://', '')}</span>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all',
          copied
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-white border border-sage/20 text-charcoal hover:bg-sage/5',
        )}
      >
        {copied ? <CheckIcon className="size-3" /> : <Copy className="size-3" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>

      {whatsAppUrl && whatsappApiEnabled ? (
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={handleSendViaApi}
            disabled={sendingApi}
            className="flex items-center gap-1.5 rounded-l-md bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1DA851] transition-colors disabled:opacity-50"
          >
            {sendingApi ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            )}
            Enviar via WhatsApp
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex items-center self-stretch rounded-r-md border-l border-[#1DA851] bg-[#25D366] px-1.5 text-white hover:bg-[#1DA851] transition-colors"
                >
                  <ChevronDownIcon className="size-3.5" />
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => window.open(whatsAppUrl, '_blank', 'noopener,noreferrer')}
              >
                Abrir no WhatsApp Web
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : whatsAppUrl ? (
        <a
          href={whatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1DA851] transition-colors"
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          WhatsApp
        </a>
      ) : null}

      <span className="text-[10px] text-mid/50 whitespace-nowrap">24h</span>
    </div>
  )
}

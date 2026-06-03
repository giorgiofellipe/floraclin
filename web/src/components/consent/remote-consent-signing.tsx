'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { SignaturePad } from './signature-pad'
import { collectDeviceFingerprint, type DeviceFingerprint, type Geolocation } from '@/lib/signature-evidence'
import { Loader2, CheckCircle } from 'lucide-react'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface RemoteConsentSigningProps {
  token: string
  firstName: string
  whatsappEnabled?: boolean
  templates: ConsentTemplate[]
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

export function RemoteConsentSigning({ token, firstName, whatsappEnabled = false, templates }: RemoteConsentSigningProps) {
  const [agreed, setAgreed] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deviceFingerprint] = useState<DeviceFingerprint>(() => collectDeviceFingerprint())
  const [geolocation, setGeolocation] = useState<Geolocation | undefined>(undefined)
  const [acceptanceIds, setAcceptanceIds] = useState<string[]>([])
  const [signedAt, setSignedAt] = useState<Date | null>(null)
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false)
  const [whatsappSent, setWhatsappSent] = useState(false)
  const [whatsappExpired, setWhatsappExpired] = useState(false)

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeolocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 },
      )
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!signatureData) return

    setStatus('submitting')
    setErrorMessage(null)

    try {
      const res = await fetch('/api/consent/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signatures: templates.map((t) => ({
            consentTemplateId: t.id,
            signatureData,
            deviceFingerprint,
            geolocation,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setAcceptanceIds(data.acceptanceIds ?? [])
      setSignedAt(data.signedAt ? new Date(data.signedAt) : new Date())
      setStatus('success')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }, [signatureData, deviceFingerprint, geolocation, token, templates])

  useEffect(() => {
    if (!signedAt || whatsappSent) return
    const remaining = signedAt.getTime() + 60 * 60 * 1000 - Date.now()
    if (remaining <= 0) {
      setWhatsappExpired(true)
      return
    }
    const timer = setTimeout(() => setWhatsappExpired(true), remaining)
    return () => clearTimeout(timer)
  }, [signedAt, whatsappSent])

  const handleSendWhatsapp = useCallback(async () => {
    if (acceptanceIds.length === 0) return
    setSendingWhatsapp(true)
    try {
      for (const id of acceptanceIds) {
        const res = await fetch(`/api/consent/${id}/send-whatsapp?token=${encodeURIComponent(token)}`, { method: 'POST' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Falha ao enviar')
        }
      }
      setWhatsappSent(true)
    } catch {
      setErrorMessage('Não foi possível enviar os documentos. Solicite uma cópia na clínica.')
    } finally {
      setSendingWhatsapp(false)
    }
  }, [acceptanceIds, token])

  if (status === 'success') {
    return (
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardContent className="flex flex-col items-center gap-4 py-10">
          <div className="flex size-14 items-center justify-center rounded-full bg-mint/20 text-sage">
            <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-charcoal">Termos assinados com sucesso</p>
          <p className="text-sm text-mid">Você pode fechar esta página.</p>

          {whatsappEnabled && !whatsappSent && !whatsappExpired && (
            <Button
              onClick={handleSendWhatsapp}
              disabled={sendingWhatsapp}
              className="mt-2 bg-[#25D366] hover:bg-[#1DA851] text-white"
            >
              {sendingWhatsapp ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WhatsAppIcon className="size-4" />
              )}
              {sendingWhatsapp ? 'Enviando...' : 'Receber cópia via WhatsApp'}
            </Button>
          )}

          {whatsappSent && (
            <div className="flex items-center gap-2 text-sm text-[#25D366] font-medium">
              <CheckCircle className="size-4" />
              Documentos enviados para o seu WhatsApp
            </div>
          )}

          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-medium text-charcoal">Olá, {firstName}</h2>
        <p className="text-sm text-mid mt-1">
          Revise os termos abaixo e assine ao final.
        </p>
      </div>

      {templates.map((template) => (
        <Card key={template.id} className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <CardHeader className="bg-white pb-4">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-[#2A2A2A] text-base">{template.title}</CardTitle>
              <Badge variant="outline" className="border-sage/30 bg-sage/5 text-sage text-xs shrink-0">
                v{template.version}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[50vh] rounded-[3px] border border-[#E8ECEF] bg-white p-5">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                {template.content}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      ))}

      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardContent className="space-y-4 pt-6">
          <label className="flex cursor-pointer items-start gap-3 rounded-[3px] border border-[#E8ECEF] p-4 transition-colors duration-150 hover:bg-[#F4F6F8] hover:border-sage/30">
            <Checkbox
              checked={agreed}
              onCheckedChange={(val) => setAgreed(val === true)}
              disabled={status === 'submitting'}
              className="mt-0.5 border-sage data-[state=checked]:bg-forest data-[state=checked]:border-forest"
            />
            <span className="text-sm font-medium leading-snug text-charcoal">
              Li e concordo com todos os termos apresentados acima
            </span>
          </label>

          {agreed && (
            <>
              <p className="text-sm font-medium text-charcoal">Assinatura</p>
              <SignaturePad onSignatureChange={setSignatureData} disabled={status === 'submitting'} />
            </>
          )}

          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!agreed || !signatureData || status === 'submitting'}
            className="w-full bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200"
            size="lg"
          >
            {status === 'submitting' ? 'Assinando...' : 'Assinar'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { SignaturePad } from './signature-pad'
import { collectDeviceFingerprint, type DeviceFingerprint, type Geolocation } from '@/lib/signature-evidence'

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
  templates: ConsentTemplate[]
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function RemoteConsentSigning({ token, firstName, templates }: RemoteConsentSigningProps) {
  const [agreed, setAgreed] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deviceFingerprint] = useState<DeviceFingerprint>(() => collectDeviceFingerprint())
  const [geolocation, setGeolocation] = useState<Geolocation | undefined>(undefined)

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

      setStatus('success')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }, [signatureData, deviceFingerprint, geolocation, token, templates])

  if (status === 'success') {
    return (
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <div className="flex size-14 items-center justify-center rounded-full bg-mint/20 text-sage">
            <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-charcoal">Termos assinados com sucesso</p>
          <p className="text-sm text-mid">Você pode fechar esta página.</p>
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

'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SignaturePad } from './signature-pad'
import { acceptConsentAction } from '@/actions/consent'
import type { AcceptanceMethod } from '@/types'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface ConsentViewerProps {
  template: ConsentTemplate
  patientId: string
  procedureRecordId?: string
  requireSignature?: boolean
  onAccepted?: () => void
}

export function ConsentViewer({
  template,
  patientId,
  procedureRecordId,
  requireSignature = false,
  onAccepted,
}: ConsentViewerProps) {
  const [checked, setChecked] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  const acceptanceMethod: AcceptanceMethod = requireSignature
    ? signatureData && checked
      ? 'both'
      : signatureData
        ? 'signature'
        : 'checkbox'
    : checked
      ? signatureData
        ? 'both'
        : 'checkbox'
      : 'checkbox'

  const canSubmit = checked && (!requireSignature || !!signatureData)

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await acceptConsentAction({
        patientId,
        consentTemplateId: template.id,
        procedureRecordId,
        acceptanceMethod: signatureData ? (checked ? 'both' : 'signature') : 'checkbox',
        signatureData: signatureData ?? undefined,
      })

      if (result?.error) {
        setError(result.error)
      } else if (result?.fieldErrors) {
        const firstError = Object.values(result.fieldErrors).flat()[0]
        setError(firstError ?? 'Erro de validação')
      } else {
        setAccepted(true)
        onAccepted?.()
      }
    } catch {
      setError('Erro inesperado ao registrar aceite')
    } finally {
      setIsSubmitting(false)
    }
  }, [canSubmit, isSubmitting, patientId, template.id, procedureRecordId, signatureData, checked, onAccepted])

  if (accepted) {
    return (
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <div className="flex size-14 items-center justify-center rounded-full bg-mint/20 text-sage">
            <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-charcoal">
            Termo aceito com sucesso
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <CardHeader className="bg-white pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-[#2A2A2A]">{template.title}</CardTitle>
            <CardDescription className="mt-1 text-mid">
              {CONSENT_TYPE_LABELS[template.type] ?? template.type}
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-sage/30 bg-sage/5 text-sage text-xs">
            Versao {template.version}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {/* Scrollable consent text */}
        <ScrollArea className="h-72 rounded-[3px] border border-[#E8ECEF] bg-white p-5">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
            {template.content}
          </div>
        </ScrollArea>

        {/* Checkbox acceptance */}
        <label className="flex cursor-pointer items-start gap-3 rounded-[3px] border border-[#E8ECEF] p-4 transition-colors duration-150 hover:bg-[#F4F6F8] hover:border-sage/30">
          <Checkbox
            checked={checked}
            onCheckedChange={(val) => setChecked(val === true)}
            disabled={isSubmitting}
            className="mt-0.5 border-sage data-[state=checked]:bg-forest data-[state=checked]:border-forest"
          />
          <span className="text-sm font-medium leading-snug text-charcoal">
            Li e concordo com os termos acima
          </span>
        </label>

        {/* Optional signature pad */}
        {(requireSignature || checked) && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-charcoal">
              {requireSignature ? 'Assinatura (obrigatoria)' : 'Assinatura (opcional)'}
            </p>
            <SignaturePad
              onSignatureChange={setSignatureData}
              disabled={isSubmitting}
            />
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {/* Submit button */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="w-full bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200"
          size="lg"
        >
          {isSubmitting ? 'Registrando...' : 'Confirmar'}
        </Button>
      </CardContent>
    </Card>
  )
}

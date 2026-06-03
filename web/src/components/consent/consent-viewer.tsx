'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SignaturePad } from './signature-pad'
import { useAcceptConsent } from '@/hooks/mutations/use-consent-mutations'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'
import { collectDeviceFingerprint, type DeviceFingerprint, type Geolocation } from '@/lib/signature-evidence'
import { interpolateContract, buildContractData } from '@/lib/contract-interpolation'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface ContractContext {
  patientName: string
  patientCpf?: string | null
  clinicName: string
  practitionerName: string
}

interface ConsentViewerProps {
  template: ConsentTemplate
  patientId: string
  patientCpf?: string | null
  procedureRecordId?: string
  requireSignature?: boolean
  contractContext?: ContractContext
  onAccepted?: () => void
}

export function ConsentViewer({
  template,
  patientId,
  patientCpf,
  procedureRecordId,
  requireSignature = false,
  contractContext,
  onAccepted,
}: ConsentViewerProps) {
  const [checked, setChecked] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
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

  const acceptConsent = useAcceptConsent()
  const isSubmitting = acceptConsent.isPending

  const displayContent = useMemo(() => {
    if (template.type === 'service_contract' && contractContext) {
      return interpolateContract(template.content, buildContractData(
        [], [], { totalAmount: 0, installmentCount: 1 },
        { fullName: contractContext.patientName || '', cpf: contractContext.patientCpf },
        contractContext.practitionerName || '',
        contractContext.clinicName || '',
      ))
    }
    return template.content
  }, [template.type, template.content, contractContext])

  const canSubmit = checked && (!requireSignature || !!signatureData)

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) return

    setError(null)

    try {
      await acceptConsent.mutateAsync({
        patientId,
        consentTemplateId: template.id,
        procedureRecordId,
        acceptanceMethod: signatureData ? (checked ? 'both' : 'signature') : 'checkbox',
        signatureData: signatureData ?? undefined,
        signerCpf: patientCpf ?? undefined,
        deviceFingerprint,
        geolocation,
        ...(template.type === 'service_contract' && displayContent !== template.content
          ? { renderedContent: displayContent }
          : {}),
      })
      setAccepted(true)
      onAccepted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado ao registrar aceite')
    }
  }, [canSubmit, isSubmitting, patientId, patientCpf, template.id, procedureRecordId, signatureData, checked, onAccepted, acceptConsent, deviceFingerprint, geolocation])

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
            Versão {template.version}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {/* Scrollable consent text */}
        <ScrollArea className="h-[65vh] rounded-[3px] border border-[#E8ECEF] bg-white p-5">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
            {displayContent}
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
              {requireSignature ? 'Assinatura (obrigatória)' : 'Assinatura (opcional)'}
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

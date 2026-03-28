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

const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Consentimento Geral',
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor / Ácido Hialurônico',
  biostimulator: 'Bioestimulador',
  custom: 'Personalizado',
}

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
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8">
          <div className="flex size-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            Termo aceito com sucesso
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{template.title}</CardTitle>
            <CardDescription className="mt-1">
              {CONSENT_TYPE_LABELS[template.type] ?? template.type}
            </CardDescription>
          </div>
          <Badge variant="outline">
            Versao {template.version}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Scrollable consent text */}
        <ScrollArea className="h-64 rounded-lg border bg-muted/20 p-4">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {template.content}
          </div>
        </ScrollArea>

        {/* Checkbox acceptance */}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
          <Checkbox
            checked={checked}
            onCheckedChange={(val) => setChecked(val === true)}
            disabled={isSubmitting}
            className="mt-0.5"
          />
          <span className="text-sm font-medium leading-snug">
            Li e concordo com os termos acima
          </span>
        </label>

        {/* Optional signature pad */}
        {(requireSignature || checked) && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
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
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Submit button */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="w-full"
          size="lg"
        >
          {isSubmitting ? 'Registrando...' : 'Confirmar'}
        </Button>
      </CardContent>
    </Card>
  )
}

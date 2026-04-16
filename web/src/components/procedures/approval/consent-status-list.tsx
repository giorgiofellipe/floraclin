'use client'

import * as React from 'react'
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConsentViewer } from '@/components/consent/consent-viewer'
import { cn } from '@/lib/utils'

interface ConsentStatus {
  type: string
  label: string
  signed: boolean
  loading: boolean
}

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface ConsentStatusListProps {
  consentStatuses: ConsentStatus[]
  allConsentsSigned: boolean
  activeConsentType: string | null
  activeConsentTemplate: ConsentTemplate | null
  loadingConsentTemplate: boolean
  patientId: string
  procedureId: string
  onOpenConsent: (type: string) => void
  onConsentAccepted: () => void
}

export function ConsentStatusList({
  consentStatuses,
  allConsentsSigned,
  activeConsentType,
  activeConsentTemplate,
  loadingConsentTemplate,
  patientId,
  procedureId,
  onOpenConsent,
  onConsentAccepted,
}: ConsentStatusListProps) {
  return (
    <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
            <ShieldCheck className="size-4 text-forest" />
          </div>
          <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
            Termos de Consentimento
          </span>
          {allConsentsSigned && (
            <Badge className="bg-mint/20 text-sage text-xs border-0 ml-auto">
              Todos assinados
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {consentStatuses.length === 0 && (
          <div className="flex items-center gap-2 py-4">
            <Loader2 className="size-4 animate-spin text-mid" />
            <span className="text-sm text-mid">Verificando termos...</span>
          </div>
        )}

        {consentStatuses.map((consent) => (
          <div key={consent.type}>
            <div
              className={cn(
                'flex items-center justify-between rounded-[3px] border px-4 py-3 transition-colors',
                consent.signed
                  ? 'border-sage/30 bg-[#F0F7F1]'
                  : 'border-[#E8ECEF] bg-white'
              )}
            >
              <div className="flex items-center gap-3">
                {consent.loading ? (
                  <Loader2 className="size-4 animate-spin text-mid" />
                ) : consent.signed ? (
                  <CheckCircle2 className="size-5 text-sage" />
                ) : (
                  <div className="size-5 rounded border-2 border-[#E8ECEF]" />
                )}
                <span className="text-sm text-charcoal">{consent.label}</span>
              </div>

              {!consent.signed && !consent.loading && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenConsent(consent.type)}
                  className="border-forest/30 text-forest hover:bg-petal text-xs"
                >
                  Assinar
                </Button>
              )}

              {consent.signed && (
                <span className="text-xs text-sage font-medium">Assinado</span>
              )}
            </div>

            {/* Inline consent viewer */}
            {activeConsentType === consent.type && (
              <div className="mt-3">
                {loadingConsentTemplate ? (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <Loader2 className="size-4 animate-spin text-mid" />
                    <span className="text-sm text-mid">Carregando termo...</span>
                  </div>
                ) : activeConsentTemplate ? (
                  <ConsentViewer
                    template={activeConsentTemplate}
                    patientId={patientId}
                    procedureRecordId={procedureId}
                    requireSignature
                    onAccepted={onConsentAccepted}
                  />
                ) : (
                  <div className="rounded-[3px] border border-amber/30 bg-[#FFF4EF] p-4">
                    <p className="text-sm text-amber-dark">
                      Modelo de termo não encontrado. Configure o termo nas configurações.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

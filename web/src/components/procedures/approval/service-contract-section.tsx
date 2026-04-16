'use client'

import * as React from 'react'
import { CheckCircle2, FileText, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SignaturePad } from '@/components/consent/signature-pad'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface ServiceContractSectionProps {
  loadingContract: boolean
  contractTemplate: ConsentTemplate | null
  contractText: string
  contractSigned: boolean
  contractChecked: boolean
  contractSignature: string | null
  contractSigning: boolean
  contractError: string | null
  onCheckedChange: (checked: boolean) => void
  onSignatureChange: (data: string | null) => void
  onSignContract: () => void
}

export function ServiceContractSection({
  loadingContract,
  contractTemplate,
  contractText,
  contractSigned,
  contractChecked,
  contractSignature,
  contractSigning,
  contractError,
  onCheckedChange,
  onSignatureChange,
  onSignContract,
}: ServiceContractSectionProps) {
  return (
    <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
            <FileText className="size-4 text-forest" />
          </div>
          <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
            Contrato de Serviço
          </span>
          {contractSigned && (
            <Badge className="bg-mint/20 text-sage text-xs border-0 ml-auto">
              Assinado
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {loadingContract ? (
          <div className="flex items-center gap-2 py-6 justify-center">
            <Loader2 className="size-4 animate-spin text-mid" />
            <span className="text-sm text-mid">Carregando contrato...</span>
          </div>
        ) : !contractTemplate ? (
          <div className="rounded-[3px] border border-amber/30 bg-[#FFF4EF] p-4">
            <p className="text-sm text-amber-dark">
              Modelo de contrato de serviço não encontrado. Configure o contrato nas configurações.
            </p>
          </div>
        ) : contractSigned ? (
          <div className="flex items-center gap-3 rounded-[3px] border border-sage/30 bg-[#F0F7F1] px-4 py-4">
            <CheckCircle2 className="size-5 text-sage" />
            <span className="text-sm text-charcoal">
              Contrato de serviço assinado com sucesso
            </span>
          </div>
        ) : (
          <>
            {/* Rendered contract text */}
            <ScrollArea className="h-72 rounded-[3px] border border-[#E8ECEF] bg-white p-5">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                {contractText}
              </div>
            </ScrollArea>

            {/* Checkbox acceptance */}
            <label className="flex cursor-pointer items-start gap-3 rounded-[3px] border border-[#E8ECEF] p-4 transition-colors duration-150 hover:bg-[#F4F6F8] hover:border-sage/30">
              <Checkbox
                checked={contractChecked}
                onCheckedChange={(val) => onCheckedChange(val === true)}
                disabled={contractSigning}
                className="mt-0.5 border-sage data-[state=checked]:bg-forest data-[state=checked]:border-forest"
              />
              <span className="text-sm font-medium leading-snug text-charcoal">
                Li e concordo com os termos do contrato de prestação de serviços
              </span>
            </label>

            {/* Signature pad */}
            {contractChecked && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-charcoal">
                  Assinatura do paciente (obrigatória)
                </p>
                <SignaturePad
                  onSignatureChange={onSignatureChange}
                  disabled={contractSigning}
                />
              </div>
            )}

            {/* Error */}
            {contractError && (
              <p className="text-sm text-red-600">{contractError}</p>
            )}

            {/* Sign contract button */}
            <Button
              onClick={onSignContract}
              disabled={!contractChecked || !contractSignature || contractSigning}
              className="w-full bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200"
              size="lg"
            >
              {contractSigning ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Assinando...
                </>
              ) : (
                'Assinar Contrato'
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

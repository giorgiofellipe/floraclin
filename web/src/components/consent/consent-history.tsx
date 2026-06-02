'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { SignaturePad } from './signature-pad'
import { useConsentHistory } from '@/hooks/queries/use-consent'
import { formatDateTime } from '@/lib/utils'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'

const METHOD_LABELS: Record<string, string> = {
  checkbox: 'Checkbox',
  signature: 'Assinatura',
  both: 'Checkbox + Assinatura',
}

interface ConsentHistoryProps {
  patientId: string
}

interface HistoryItem {
  id: string
  templateTitle: string
  templateVersion: number
  templateType: string
  acceptanceMethod: string
  acceptedAt: string | Date
  signatureData: string | null
  contentSnapshot: string
  contentHash: string
  verificationCode: string | null
}

export function ConsentHistory({ patientId }: ConsentHistoryProps) {
  const { data: rawHistory, isLoading } = useConsentHistory(patientId)
  const history = (rawHistory ?? []) as HistoryItem[]

  if (isLoading) {
    return (
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardContent className="py-8 text-center text-sm text-mid">
          Carregando...
        </CardContent>
      </Card>
    )
  }

  if (history.length === 0) {
    return (
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardHeader>
          <CardTitle className="font-semibold text-[#2A2A2A]">Contratos e Termos de Consentimento</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-sm text-mid">
          Nenhum termo assinado.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <CardHeader>
        <CardTitle className="font-semibold text-[#2A2A2A]">Contratos e Termos de Consentimento</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {history.map((item) => (
            <ConsentHistoryItem key={item.id} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ConsentHistoryItem({ item }: { item: HistoryItem }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-charcoal">{item.templateTitle}</span>
          <Badge variant="outline" className="shrink-0 text-xs border-sage/30 bg-sage/5 text-sage">
            v{item.templateVersion}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-mid">
          <Badge className="bg-white text-mid border-0 text-[11px] px-2 py-0">{CONSENT_TYPE_LABELS[item.templateType] ?? item.templateType}</Badge>
          <span className="text-sage/30">|</span>
          <span>{METHOD_LABELS[item.acceptanceMethod] ?? item.acceptanceMethod}</span>
          <span className="text-sage/30">|</span>
          <span>{formatDateTime(item.acceptedAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* View signature */}
        {item.signatureData && (
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              Ver assinatura
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assinatura</DialogTitle>
              </DialogHeader>
              <SignaturePad
                onSignatureChange={() => {}}
                initialData={item.signatureData}
                disabled
              />
              <p className="text-xs text-mid">
                Aceito em {formatDateTime(item.acceptedAt)}
              </p>
            </DialogContent>
          </Dialog>
        )}

        {/* View content snapshot */}
        <Dialog>
          <DialogTrigger render={<Button variant="ghost" size="sm" />}>
            Ver termo
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{item.templateTitle}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-96 rounded-[3px] border border-[#E8ECEF] bg-white p-5">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                {item.contentSnapshot}
              </div>
            </ScrollArea>

            {item.signatureData && (
              <div className="flex flex-col items-center py-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.signatureData} alt="Assinatura" className="h-20 max-w-[240px] object-contain" />
                <div className="mt-1 w-[240px] border-t border-black" />
              </div>
            )}

            <div className="border-t border-gray-200 pt-4">
              <div className="text-[10px] text-gray-400 leading-relaxed space-y-0.5">
                <div>Documento assinado eletronicamente via FloraClin</div>
                {item.verificationCode && (
                  <div>Código de verificação: <span className="font-mono font-medium text-gray-500">{item.verificationCode}</span></div>
                )}
                <div>Assinado em: {formatDateTime(item.acceptedAt)}</div>
                <div>Método: {METHOD_LABELS[item.acceptanceMethod] ?? item.acceptanceMethod}</div>
                <div className="font-mono text-[9px] text-gray-300">SHA-256: {item.contentHash}</div>
                {item.verificationCode && (
                  <div className="mt-1">
                    Verifique a autenticidade:{' '}
                    <a href={`https://app.floraclin.com.br/verify/${item.verificationCode}`} target="_blank" rel="noopener noreferrer" className="font-mono underline text-gray-500">
                      app.floraclin.com.br/verify/{item.verificationCode}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

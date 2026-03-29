'use client'

import { useEffect, useState } from 'react'
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
import { getConsentHistoryAction } from '@/actions/consent'
import { formatDateTime } from '@/lib/utils'

const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Consentimento Geral',
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor / Ácido Hialurônico',
  biostimulator: 'Bioestimulador',
  custom: 'Personalizado',
  service_contract: 'Contrato de Serviço',
}

const METHOD_LABELS: Record<string, string> = {
  checkbox: 'Checkbox',
  signature: 'Assinatura',
  both: 'Checkbox + Assinatura',
}

interface ConsentHistoryProps {
  patientId: string
}

type HistoryItem = Awaited<ReturnType<typeof getConsentHistoryAction>>[number]

export function ConsentHistory({ patientId }: ConsentHistoryProps) {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await getConsentHistoryAction(patientId)
        if (!cancelled) {
          setHistory(data)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [patientId])

  if (loading) {
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
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{item.templateTitle}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-96 rounded-[3px] border border-[#E8ECEF] bg-white p-5">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                {item.contentSnapshot}
              </div>
            </ScrollArea>
            <div className="flex flex-wrap items-center gap-2 text-xs text-mid">
              <span>Hash SHA-256: {item.contentHash}</span>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

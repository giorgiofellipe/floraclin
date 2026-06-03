'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useConsentHistory } from '@/hooks/queries/use-consent'
import { formatDateTime } from '@/lib/utils'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'
import { Download, MessageCircle, Printer, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useState, useMemo } from 'react'
import { useTenant } from '@/hooks/queries/use-tenant'
import { useProfile } from '@/hooks/queries/use-profile'
import { PrintConsent } from './print-consent'

const METHOD_LABELS: Record<string, string> = {
  checkbox: 'Checkbox',
  signature: 'Assinatura',
  both: 'Checkbox + Assinatura',
}

interface ConsentHistoryProps {
  patientId: string
  patientName?: string
  patientCpf?: string | null
  patientHasPhone?: boolean
}

interface ProfessionalSnapshot {
  name: string
  registryLine: string
  signatureDataUrl: string
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
  signatureEvidence: unknown
  professionalSnapshot: unknown
}

export function ConsentHistory({ patientId, patientName, patientCpf, patientHasPhone = false }: ConsentHistoryProps) {
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
            <ConsentHistoryItem key={item.id} item={item} patientName={patientName} patientCpf={patientCpf} patientHasPhone={patientHasPhone} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ConsentHistoryItem({ item, patientName, patientCpf, patientHasPhone }: { item: HistoryItem; patientName?: string; patientCpf?: string | null; patientHasPhone: boolean }) {
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false)
  const { data: tenant } = useTenant()
  const { data: profileResp } = useProfile()

  const displayContent = useMemo(() => {
    if (!item.contentSnapshot.includes('{{')) return item.contentSnapshot
    let text = item.contentSnapshot
    if (patientName) text = text.replace(/\{\{nome_paciente\}\}/g, patientName)
    if (patientCpf) text = text.replace(/\{\{cpf_paciente\}\}/g, patientCpf)
    if (tenant?.name) text = text.replace(/\{\{clinica\}\}/g, tenant.name as string)
    if (profileResp?.data?.fullName) text = text.replace(/\{\{profissional\}\}/g, profileResp.data.fullName)
    return text
  }, [item.contentSnapshot, patientName, patientCpf, tenant, profileResp])

  function handlePrint() {
    window.open(`/termos/${item.id}/imprimir`, '_blank', 'noopener')
  }

  function handleDownload() {
    const a = document.createElement('a')
    a.href = `/api/consent/${item.id}/pdf`
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleSendWhatsapp() {
    setSendingWhatsapp(true)
    try {
      const res = await fetch(`/api/consent/${item.id}/send-whatsapp`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Falha ao enviar')
      }
      toast.success('Termo enviado via WhatsApp')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar via WhatsApp')
    } finally {
      setSendingWhatsapp(false)
    }
  }
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
        <Dialog>
          <DialogTrigger render={<Button variant="ghost" size="sm" />}>
            Ver termo
          </DialogTrigger>
          <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{item.templateTitle}</DialogTitle>
            </DialogHeader>

            <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-3">
              <PrintConsent
                acceptance={{
                  contentSnapshot: displayContent,
                  contentHash: item.contentHash,
                  signatureData: item.signatureData,
                  signatureEvidence: item.signatureEvidence,
                  professionalSnapshot: item.professionalSnapshot,
                  verificationCode: item.verificationCode,
                  acceptedAt: new Date(item.acceptedAt),
                  acceptanceMethod: item.acceptanceMethod,
                  templateTitle: item.templateTitle,
                  templateType: item.templateType,
                  templateVersion: item.templateVersion,
                  patientName: patientName ?? '',
                  patientCpf: patientCpf ?? null,
                  tenantName: (tenant?.name as string) ?? '',
                  tenantPhone: (tenant?.phone as string) ?? null,
                  tenantEmail: (tenant?.email as string) ?? null,
                  tenantLogoUrl: (tenant?.logoUrl as string) ?? null,
                  tenantAddress: (tenant?.address ?? null) as Record<string, unknown> | null,
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-[#E8ECEF] pt-4">
              <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="size-3.5" />
                Imprimir
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
                <Download className="size-3.5" />
                Baixar PDF
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSendWhatsapp}
                disabled={sendingWhatsapp || !patientHasPhone}
                title={!patientHasPhone ? 'Paciente sem telefone cadastrado' : undefined}
              >
                {sendingWhatsapp ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <MessageCircle className="size-3.5" />
                )}
                Enviar WhatsApp
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function SignaturesBlock({ signatureData, professionalSnapshot }: { signatureData: string | null; professionalSnapshot: unknown }) {
  const prof = professionalSnapshot as ProfessionalSnapshot | null
  if (!signatureData && !prof) return null

  return (
    <div className="flex justify-around gap-6 py-4">
      {signatureData && (
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signatureData} alt="Assinatura do paciente" className="h-20 max-w-[200px] object-contain" />
          <div className="mt-1 w-[200px] border-t border-black" />
          <div className="mt-1 text-xs text-mid">Paciente</div>
        </div>
      )}
      {prof && (
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={prof.signatureDataUrl} alt={`Assinatura de ${prof.name}`} className="h-20 max-w-[200px] object-contain" />
          <div className="mt-1 w-[200px] border-t border-black" />
          <div className="mt-1 text-xs font-medium">{prof.name}</div>
          <div className="text-[10px] text-mid">{prof.registryLine}</div>
        </div>
      )}
    </div>
  )
}

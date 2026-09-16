'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, FileCheck, PenLine, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConsentHistory } from '@/components/consent/consent-history'
import { ConsentViewer } from '@/components/consent/consent-viewer'
import { SendConsentSigningLink } from '@/components/procedures/approval/send-consent-signing-link'
import { useConsentTemplates } from '@/hooks/queries/use-consent'
import { useTenant } from '@/hooks/queries/use-tenant'
import { useProfile } from '@/hooks/queries/use-profile'
import { interpolateContract, buildContractData } from '@/lib/contract-interpolation'
import { cn } from '@/lib/utils'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
  isActive: boolean
}

type SigningMode = 'local' | 'remote'

interface PatientConsentTabProps {
  patientId: string
  patientName?: string
  patientCpf?: string | null
  patientPhone?: string | null
  whatsappApiEnabled?: boolean
}

export function PatientConsentTab({
  patientId,
  patientName,
  patientCpf,
  patientPhone,
  whatsappApiEnabled = false,
}: PatientConsentTabProps) {
  const [showNewConsent, setShowNewConsent] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [selectedTemplate, setSelectedTemplate] = useState<ConsentTemplate | null>(null)
  const [mode, setMode] = useState<SigningMode>('local')

  const { data: rawTemplates, isLoading: loadingTemplates } = useConsentTemplates()
  const { data: tenant } = useTenant()
  const { data: profileResp } = useProfile()
  const clinicName = (tenant?.name as string) ?? ''
  const practitionerName = profileResp?.data?.fullName ?? ''
  const templates = (rawTemplates
    ? (Object.values(rawTemplates).flat() as unknown as ConsentTemplate[]).filter((t) => t.isActive)
    : [])

  const templateItems = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of templates) {
      map[t.id] = `${t.title} (v${t.version})`
    }
    return map
  }, [templates])

  useEffect(() => {
    if (!selectedTemplateId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears derived state when selection is removed
      setSelectedTemplate(null)
      return
    }
    async function load() {
      try {
        const res = await fetch(`/api/consent/templates/${selectedTemplateId}`)
        if (res.ok) {
          const data = await res.json()
          setSelectedTemplate(data as ConsentTemplate)
        }
      } catch {
        // ignore
      }
    }
    load()
  }, [selectedTemplateId])

  // The remote page shows this text verbatim, so it must match what the
  // local viewer would have shown for the same template.
  const renderedContents = useMemo(() => {
    if (!selectedTemplate || selectedTemplate.type !== 'service_contract') return undefined
    const content = interpolateContract(selectedTemplate.content, buildContractData(
      [], [], { totalAmount: 0, installmentCount: 1 },
      { fullName: patientName ?? '', cpf: patientCpf },
      practitionerName,
      clinicName,
    ))
    return { [selectedTemplate.id]: content }
  }, [selectedTemplate, patientName, patientCpf, practitionerName, clinicName])

  const resetDialog = () => {
    setSelectedTemplateId('')
    setSelectedTemplate(null)
    setMode('local')
  }

  const handleAccepted = () => {
    setShowNewConsent(false)
    resetDialog()
  }

  const handleOpenChange = (open: boolean) => {
    setShowNewConsent(open)
    if (!open) resetDialog()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">Contratos e termos de consentimento do paciente</p>
        <Button onClick={() => setShowNewConsent(true)}>
          <Plus className="size-4 mr-1" />
          Novo Termo
        </Button>
      </div>

      <ConsentHistory patientId={patientId} patientName={patientName} patientCpf={patientCpf} patientHasPhone={!!patientPhone} />

      <Dialog open={showNewConsent} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Termo de Consentimento</DialogTitle>
          </DialogHeader>
          {loadingTemplates ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-mid" />
              <span className="ml-2 text-sm text-mid">Carregando modelos...</span>
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-mid">
              <FileCheck className="mb-2 size-8" />
              <p className="text-sm">Nenhum modelo de termo cadastrado.</p>
              <p className="text-xs mt-1">
                Cadastre modelos em Configurações &gt; Contratos e Termos.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="uppercase tracking-wider text-sm text-mid font-medium">
                  Selecione o modelo
                </label>
                <Select items={templateItems} value={selectedTemplateId} onValueChange={(v) => setSelectedTemplateId(v ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha um modelo de termo..." />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>

              {selectedTemplate && (
                <>
                  <SigningModeToggle mode={mode} onChange={setMode} />

                  {mode === 'local' ? (
                    <ConsentViewer
                      template={selectedTemplate}
                      patientId={patientId}
                      patientCpf={patientCpf}
                      requireSignature
                      contractContext={{
                        patientName: patientName ?? '',
                        patientCpf,
                        clinicName,
                        practitionerName,
                      }}
                      onAccepted={handleAccepted}
                    />
                  ) : (
                    <div className="space-y-3 rounded-md border border-sage/15 bg-sage/5 p-4">
                      <p className="text-sm text-mid">
                        O paciente recebe um link para ler e assinar o termo no próprio celular. O link vale por 24 horas.
                      </p>
                      <SendConsentSigningLink
                        patientId={patientId}
                        patientName={patientName ?? ''}
                        patientPhone={patientPhone}
                        consentTemplateIds={[selectedTemplate.id]}
                        renderedContents={renderedContents}
                        whatsappApiEnabled={whatsappApiEnabled}
                        label="Gerar link de assinatura"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SigningModeToggle({ mode, onChange }: { mode: SigningMode; onChange: (mode: SigningMode) => void }) {
  const options: { value: SigningMode; label: string; icon: typeof PenLine }[] = [
    { value: 'local', label: 'Assinar neste dispositivo', icon: PenLine },
    { value: 'remote', label: 'Enviar por WhatsApp', icon: Send },
  ]

  return (
    <div role="radiogroup" aria-label="Forma de assinatura" className="grid grid-cols-2 gap-2">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            'flex items-center justify-center gap-2 rounded-[3px] border px-3 py-2 text-sm font-medium transition-colors',
            mode === value
              ? 'border-forest bg-forest text-cream'
              : 'border-sage/30 text-charcoal hover:bg-sage/5',
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

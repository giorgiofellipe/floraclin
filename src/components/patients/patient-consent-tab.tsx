'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, FileCheck } from 'lucide-react'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConsentHistory } from '@/components/consent/consent-history'
import { ConsentViewer } from '@/components/consent/consent-viewer'
import { useConsentTemplates } from '@/hooks/queries/use-consent'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
  isActive: boolean
}

interface PatientConsentTabProps {
  patientId: string
}

export function PatientConsentTab({ patientId }: PatientConsentTabProps) {
  const [showNewConsent, setShowNewConsent] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [selectedTemplate, setSelectedTemplate] = useState<ConsentTemplate | null>(null)

  const { data: rawTemplates, isLoading: loadingTemplates } = useConsentTemplates()
  const templates = (rawTemplates
    ? (Object.values(rawTemplates).flat() as unknown as ConsentTemplate[]).filter((t) => t.isActive)
    : [])

  useEffect(() => {
    if (!selectedTemplateId) {
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

  const handleAccepted = () => {
    setShowNewConsent(false)
    setSelectedTemplateId('')
    setSelectedTemplate(null)
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

      <ConsentHistory patientId={patientId} />

      <Dialog open={showNewConsent} onOpenChange={setShowNewConsent}>
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
                <Select value={selectedTemplateId} onValueChange={(v) => setSelectedTemplateId(v ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha um modelo de termo...">
                      {(value: string) => {
                        const t = templates.find((t) => t.id === value)
                        return t ? `${t.title} (v${t.version})` : value
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title} (v{t.version})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedTemplate && (
                <ConsentViewer
                  template={selectedTemplate}
                  patientId={patientId}
                  requireSignature
                  onAccepted={handleAccepted}
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, ArrowLeft, Send, FileText, User, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { PURPOSE_LABELS } from '@/lib/whatsapp-blueprints'

interface Patient {
  id: string
  fullName: string
  phone: string | null
}

interface VariableMapping {
  index: number
  key: string
  label: string
  example: string
}

interface Template {
  id: string
  name: string
  language: string
  category: string
  body: string
  status: string
  purposeKey: string | null
  variableMapping: VariableMapping[] | null
}

type Step = 'patient' | 'template' | 'variables'

interface StartConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConversationStarted: (conversation: { id: string; phoneNumber: string; profileName: string | null; patientId: string | null }) => void
  preselectedPatient?: Patient | null
}

export function StartConversationDialog({
  open,
  onOpenChange,
  onConversationStarted,
  preselectedPatient,
}: StartConversationDialogProps) {
  const [step, setStep] = useState<Step>('patient')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [variableValues, setVariableValues] = useState<Record<number, string>>({})
  const [sending, setSending] = useState(false)

  // Patient search
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [loadingPatients, setLoadingPatients] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Template list
  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')

  useEffect(() => {
    if (open) {
      if (preselectedPatient) {
        setSelectedPatient(preselectedPatient)
        setStep('template')
        fetchTemplates()
      } else {
        setStep('patient')
        setSelectedPatient(null)
      }
      setSelectedTemplate(null)
      setVariableValues({})
      setPatientSearch('')
      setTemplateSearch('')
      setPatients([])
    }
  }, [open, preselectedPatient])

  const fetchPatients = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setPatients([])
      return
    }
    setLoadingPatients(true)
    try {
      const res = await fetch(`/api/patients?search=${encodeURIComponent(query)}&limit=10`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setPatients(
        (data.data ?? []).filter((p: Patient) => p.phone),
      )
    } catch {
      setPatients([])
    } finally {
      setLoadingPatients(false)
    }
  }, [])

  function handlePatientSearchChange(value: string) {
    setPatientSearch(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      fetchPatients(value)
    }, 300)
  }

  function handleSelectPatient(patient: Patient) {
    setSelectedPatient(patient)
    setStep('template')
    fetchTemplates()
  }

  async function fetchTemplates() {
    setLoadingTemplates(true)
    try {
      const res = await fetch('/api/whatsapp/templates')
      if (!res.ok) throw new Error()
      const data = await res.json()
      const allTemplates = (data.data ?? []) as Array<Record<string, unknown>>
      const approved = allTemplates
        .filter((t) => t.status === 'APPROVED')
        .map((t) => {
          const components = t.components as Array<Record<string, unknown>> | undefined
          const bodyComp = components?.find((c) => c.type === 'BODY')
          return {
            id: t.id as string,
            name: t.name as string,
            language: t.language as string,
            category: t.category as string,
            body: (bodyComp?.text as string) ?? '',
            status: t.status as string,
            purposeKey: (t.purposeKey as string) ?? null,
            variableMapping: (t.variableMapping as VariableMapping[]) ?? null,
          }
        })
      setTemplates(approved)
    } catch {
      toast.error('Erro ao carregar templates')
    } finally {
      setLoadingTemplates(false)
    }
  }

  function handleSelectTemplate(template: Template) {
    if (template.variableMapping && template.variableMapping.length > 0) {
      setSelectedTemplate(template)
      setVariableValues({})
      setStep('variables')
    } else {
      sendConversation(template.name, template.language)
    }
  }

  function handleSendWithVariables() {
    if (!selectedTemplate) return
    const mapping = selectedTemplate.variableMapping ?? []
    const params: Record<string, string> = {}
    for (const v of mapping) {
      params[String(v.index)] = variableValues[v.index] || v.example
    }
    sendConversation(selectedTemplate.name, selectedTemplate.language, params)
  }

  async function sendConversation(
    templateName: string,
    language: string,
    params?: Record<string, string>,
  ) {
    if (!selectedPatient) return
    setSending(true)
    try {
      const res = await fetch('/api/whatsapp/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          templateName,
          language,
          ...(params ? { params } : {}),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao iniciar conversa' }))
        throw new Error(err.error || 'Erro ao iniciar conversa')
      }
      const data = await res.json()
      toast.success('Conversa iniciada')
      onOpenChange(false)
      onConversationStarted(data.data.conversation)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao iniciar conversa')
    } finally {
      setSending(false)
    }
  }

  const filteredTemplates = templates.filter((t) => {
    const q = templateSearch.toLowerCase()
    if (!q) return true
    const purposeLabel = t.purposeKey ? (PURPOSE_LABELS[t.purposeKey] ?? '') : ''
    return t.name.toLowerCase().includes(q) || purposeLabel.toLowerCase().includes(q)
  })

  // Step: variables
  if (step === 'variables' && selectedTemplate) {
    const mapping = selectedTemplate.variableMapping ?? []
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <button type="button" onClick={() => setStep('template')} className="text-mid hover:text-charcoal">
                <ArrowLeft className="h-4 w-4" />
              </button>
              Preencher variáveis
            </DialogTitle>
            <DialogDescription>
              Preencha os campos para personalizar a mensagem.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {mapping.map((v) => (
              <div key={v.index} className="space-y-1">
                <Label className="text-xs text-mid">
                  {`{{${v.index}}}`} — {v.label}
                </Label>
                <Input
                  placeholder={v.example}
                  value={variableValues[v.index] ?? ''}
                  onChange={(e) =>
                    setVariableValues((prev) => ({ ...prev, [v.index]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-2 rounded-lg bg-muted/30 p-3">
            <p className="text-xs text-mid mb-1">Pré-visualização:</p>
            <p className="text-sm text-charcoal whitespace-pre-wrap">
              {(() => {
                let preview = selectedTemplate.body
                for (const v of mapping) {
                  preview = preview.replace(
                    `{{${v.index}}}`,
                    variableValues[v.index] || `[${v.label}]`,
                  )
                }
                return preview
              })()}
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setStep('template')}>
              Voltar
            </Button>
            <Button onClick={handleSendWithVariables} disabled={sending}>
              <Send className="h-3.5 w-3.5" />
              Enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Step: template
  if (step === 'template') {
    const utilityTemplates = filteredTemplates.filter((t) => t.category === 'UTILITY')
    const marketingTemplates = filteredTemplates.filter((t) => t.category === 'MARKETING')

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {!preselectedPatient && (
                <button type="button" onClick={() => setStep('patient')} className="text-mid hover:text-charcoal">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              Escolher template
            </DialogTitle>
            <DialogDescription>
              Enviando para <strong>{selectedPatient?.fullName}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mid" />
            <Input
              placeholder="Buscar template..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {loadingTemplates && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}

            {!loadingTemplates && filteredTemplates.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum template aprovado encontrado.
              </div>
            )}

            {!loadingTemplates && utilityTemplates.length > 0 && (
              <>
                <p className="text-xs font-medium text-mid uppercase tracking-wider pt-1">Utilitário</p>
                {utilityTemplates.map((template) => (
                  <TemplateCard key={template.id} template={template} sending={sending} onSelect={handleSelectTemplate} />
                ))}
              </>
            )}

            {!loadingTemplates && marketingTemplates.length > 0 && (
              <>
                <p className="text-xs font-medium text-mid uppercase tracking-wider pt-2">Marketing</p>
                {marketingTemplates.map((template) => (
                  <TemplateCard key={template.id} template={template} sending={sending} onSelect={handleSelectTemplate} />
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Step: patient search
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Busque um paciente para iniciar a conversa via WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mid" />
          <Input
            placeholder="Buscar paciente por nome ou telefone..."
            value={patientSearch}
            onChange={(e) => handlePatientSearchChange(e.target.value)}
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1">
          {loadingPatients && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!loadingPatients && patientSearch.length >= 2 && patients.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhum paciente com telefone encontrado.
            </div>
          )}

          {!loadingPatients && patientSearch.length < 2 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Digite ao menos 2 caracteres para buscar.
            </div>
          )}

          {patients.map((patient) => (
            <button
              key={patient.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              onClick={() => handleSelectPatient(patient)}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sage/15 text-sm font-medium text-sage">
                <User className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-charcoal">{patient.fullName}</p>
                <p className="flex items-center gap-1 text-xs text-mid">
                  <Phone className="size-3" />
                  {patient.phone}
                </p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TemplateCard({
  template,
  sending,
  onSelect,
}: {
  template: Template
  sending?: boolean
  onSelect: (t: Template) => void
}) {
  const purposeLabel = template.purposeKey ? PURPOSE_LABELS[template.purposeKey] : null

  return (
    <button
      type="button"
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
      disabled={sending}
      onClick={() => onSelect(template)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{template.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-muted-foreground">{template.language}</span>
              {purposeLabel && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {purposeLabel}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Send className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      </div>
      {template.body && (
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
          {template.body}
        </p>
      )}
    </button>
  )
}

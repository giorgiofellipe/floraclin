'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, AlertCircle, FileText, ClipboardCheck, CheckIcon, PencilIcon, ArrowLeftIcon } from 'lucide-react'
import {
  useDocumentTemplates,
} from '@/hooks/queries/use-document-templates'
import {
  useIssueClinicalDocument,
} from '@/hooks/queries/use-clinical-documents'
import { useProfile } from '@/hooks/queries/use-profile'
import { useTenant } from '@/hooks/queries/use-tenant'
import { DocumentPreview } from './document-preview'
import { DeliveryActions } from './delivery-actions'
import { AVAILABLE_DOCUMENT_PLACEHOLDERS } from '@/lib/templates/placeholders'
import type { ClinicalDocumentKind } from '@/validations/clinical-document'
import { cn } from '@/lib/utils'

interface PatientLike {
  id: string
  fullName: string
  cpf: string | null
  birthDate: string | null
  phone: string | null
}

export interface IssueDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: PatientLike
}

const NO_TEMPLATE_VALUE = '__none__'

type WizardStep = 'kind' | 'template' | 'preview' | 'compose' | 'delivery'

const STEP_LABELS: Record<string, string> = {
  kind: 'Tipo',
  template: 'Modelo',
  preview: 'Pré-visualização',
  compose: 'Editar',
  delivery: 'Entrega',
}

export function IssueDocumentDialog({
  open,
  onOpenChange,
  patient,
}: IssueDocumentDialogProps) {
  const [step, setStep] = React.useState<WizardStep>('kind')
  const [kind, setKind] = React.useState<ClinicalDocumentKind>('atestado')
  const [templateId, setTemplateId] = React.useState<string>(NO_TEMPLATE_VALUE)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [issuedId, setIssuedId] = React.useState<string | null>(null)
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null)

  const { data: templatesData } = useDocumentTemplates({ kind })
  const { data: profileResp, isLoading: profileLoading } = useProfile()
  const { data: tenant } = useTenant()
  const issueMutation = useIssueClinicalDocument()

  const profile = profileResp?.data
  const profileReady = Boolean(
    profile?.signatureData &&
      profile?.registryType &&
      profile?.registryNumber &&
      profile?.registryState,
  )

  React.useEffect(() => {
    if (!open) {
      setStep('kind')
      setKind('atestado')
      setTemplateId(NO_TEMPLATE_VALUE)
      setTitle('')
      setBody('')
      setIssuedId(null)
    }
  }, [open])

  function handleSelectKind(k: ClinicalDocumentKind) {
    setKind(k)
    setTemplateId(NO_TEMPLATE_VALUE)
    setTitle('')
    setBody('')
    setStep('template')
  }

  function handleSelectTemplate(id: string) {
    setTemplateId(id)
    if (id === NO_TEMPLATE_VALUE) {
      setTitle('')
      setBody('')
      setStep('compose')
    } else {
      const tpl = templatesData?.find((t) => t.id === id)
      if (tpl) {
        setBody(tpl.body)
        setTitle(tpl.name)
      }
      setStep('preview')
    }
  }

  function insertPlaceholderAtCursor(token: string) {
    const el = bodyRef.current
    if (!el) {
      setBody((prev) => prev + token)
      return
    }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + token.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  async function handleIssue() {
    if (!profileReady) {
      toast.error('Configure sua assinatura e registro profissional antes de emitir')
      return
    }
    if (!title.trim()) {
      toast.error('Informe um título para o documento')
      return
    }
    if (!body.trim()) {
      toast.error('Escreva o corpo do documento')
      return
    }

    try {
      const res = await issueMutation.mutateAsync({
        patientId: patient.id,
        kind,
        title: title.trim(),
        body,
        templateId: templateId === NO_TEMPLATE_VALUE ? null : templateId,
      })
      setIssuedId(res.data.id)
      setStep('delivery')
      toast.success('Documento emitido')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao emitir documento')
    }
  }

  const previewPractitioner = {
    displayName: profile?.professionalTitle || profile?.fullName || 'Profissional',
    registryLine:
      profile?.registryType && profile?.registryState && profile?.registryNumber
        ? `${profile.registryType}-${profile.registryState} ${profile.registryNumber}`
        : '',
    signatureDataUrl: profile?.signatureData ?? null,
  }

  const previewTenant = tenant
    ? {
        name: tenant.name as string,
        phone: (tenant.phone ?? null) as string | null,
        email: (tenant.email ?? null) as string | null,
        logoUrl: (tenant.logoUrl ?? null) as string | null,
        address: (tenant.address ?? null) as Record<string, string | undefined> | null,
      }
    : { name: '', phone: null, email: null, logoUrl: null, address: null }

  const visibleSteps: WizardStep[] = ['kind', 'template', step === 'compose' ? 'compose' : 'preview']
  const currentStepIndex = visibleSteps.indexOf(step === 'delivery' ? 'preview' : step)

  function handleBack() {
    if (step === 'template') setStep('kind')
    else if (step === 'preview') setStep('template')
    else if (step === 'compose') setStep('template')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-[#E8ECEF] px-4 sm:px-6 py-4">
          <DialogTitle>Novo documento clínico</DialogTitle>
          <DialogDescription>
            Emitir receita ou atestado para {patient.fullName}.
          </DialogDescription>

          {step !== 'delivery' && (
            <div className="flex items-center gap-2 pt-3">
              {visibleSteps.map((s, i) => (
                <React.Fragment key={s}>
                  {i > 0 && <div className={cn('h-px flex-1', i <= currentStepIndex ? 'bg-sage' : 'bg-[#E8ECEF]')} />}
                  <div className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    i < currentStepIndex ? 'text-sage' : i === currentStepIndex ? 'text-forest' : 'text-mid/50',
                  )}>
                    <span className={cn(
                      'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
                      i < currentStepIndex
                        ? 'bg-sage text-cream'
                        : i === currentStepIndex
                          ? 'bg-forest text-cream'
                          : 'bg-[#F4F6F8] text-mid',
                    )}>
                      {i < currentStepIndex ? <CheckIcon className="size-3" /> : i + 1}
                    </span>
                    <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">

        {profileLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-mid" />
          </div>
        ) : !profileReady ? (
          <div className="m-4 rounded-[3px] border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 shrink-0 text-amber-600" />
              <div className="space-y-2">
                <div className="font-medium text-amber-900">
                  Configure seu perfil profissional
                </div>
                <p className="text-sm text-amber-800">
                  Para emitir documentos clínicos você precisa cadastrar sua
                  assinatura, conselho, UF e número de registro.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href="/configuracoes?tab=perfil" />}
                >
                  Ir para o perfil
                </Button>
              </div>
            </div>
          </div>
        ) : step === 'kind' ? (
          <div className="flex flex-1 flex-col items-center justify-center p-4 sm:p-8">
            <h3 className="text-lg font-medium text-charcoal mb-2">Que tipo de documento?</h3>
            <p className="text-sm text-mid mb-6 sm:mb-8">Selecione o tipo de documento que deseja emitir.</p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 max-w-md w-full">
              <button
                type="button"
                onClick={() => handleSelectKind('atestado')}
                className="flex flex-col items-center gap-2 sm:gap-3 rounded-lg border-2 border-[#E8ECEF] bg-white p-4 sm:p-6 transition-all hover:border-forest hover:shadow-md group"
              >
                <div className="rounded-full bg-sage/10 p-3 sm:p-4 group-hover:bg-forest/10 transition-colors">
                  <ClipboardCheck className="size-6 sm:size-8 text-sage group-hover:text-forest transition-colors" />
                </div>
                <span className="text-sm font-medium text-charcoal">Atestado</span>
                <span className="text-xs text-mid text-center hidden sm:block">Comparecimento, afastamento</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectKind('receita')}
                className="flex flex-col items-center gap-2 sm:gap-3 rounded-lg border-2 border-[#E8ECEF] bg-white p-4 sm:p-6 transition-all hover:border-forest hover:shadow-md group"
              >
                <div className="rounded-full bg-sage/10 p-3 sm:p-4 group-hover:bg-forest/10 transition-colors">
                  <FileText className="size-6 sm:size-8 text-sage group-hover:text-forest transition-colors" />
                </div>
                <span className="text-sm font-medium text-charcoal">Receita</span>
                <span className="text-xs text-mid text-center hidden sm:block">Medicamentos, orientações</span>
              </button>
            </div>
          </div>
        ) : step === 'template' ? (
          <div className="flex flex-1 flex-col p-3 sm:p-6">
            <h3 className="text-base sm:text-lg font-medium text-charcoal mb-2">Escolha um modelo</h3>
            <p className="text-xs sm:text-sm text-mid mb-3 sm:mb-6">
              Use um modelo salvo ou comece do zero.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 overflow-hidden">
              <button
                type="button"
                onClick={() => handleSelectTemplate(NO_TEMPLATE_VALUE)}
                className="flex items-center gap-2.5 rounded-lg border-2 border-dashed border-[#E8ECEF] bg-white p-2.5 sm:p-4 text-left transition-all hover:border-forest hover:bg-[#F0F7F1] group overflow-hidden"
              >
                <div className="rounded-full bg-[#F4F6F8] p-2 sm:p-2.5 group-hover:bg-forest/10 transition-colors shrink-0">
                  <PencilIcon className="size-4 sm:size-5 text-mid group-hover:text-forest transition-colors" />
                </div>
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-charcoal">Documento em branco</span>
                  <span className="block text-xs text-mid">Escrever do zero</span>
                </div>
              </button>
              {(templatesData ?? []).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tpl.id)}
                  className="flex items-center gap-2.5 rounded-lg border-2 border-[#E8ECEF] bg-white p-2.5 sm:p-4 text-left transition-all hover:border-forest hover:bg-[#F0F7F1] group overflow-hidden"
                >
                  <div className="rounded-full bg-sage/10 p-2 sm:p-2.5 group-hover:bg-forest/10 transition-colors shrink-0">
                    <FileText className="size-4 sm:size-5 text-sage group-hover:text-forest transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-sm font-medium text-charcoal truncate">{tpl.name}</span>
                    <span className="block text-xs text-mid truncate">
                      {tpl.body.slice(0, 60)}{tpl.body.length > 60 ? '…' : ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : step === 'preview' ? (
          <div className="flex flex-1 flex-col p-3 sm:p-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-medium text-charcoal">Pré-visualização</h3>
                <p className="text-xs sm:text-sm text-mid">Confira antes de emitir.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('compose')}
              >
                <PencilIcon className="size-3.5" />
                Editar
              </Button>
            </div>
            <div className="flex-1 rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-2 sm:p-3 overflow-y-auto">
              <DocumentPreview
                kind={kind}
                title={title}
                body={body}
                patient={{
                  fullName: patient.fullName,
                  cpf: patient.cpf,
                  birthDate: patient.birthDate,
                }}
                practitioner={previewPractitioner}
                tenant={previewTenant}
              />
            </div>
          </div>
        ) : step === 'compose' ? (
          <div className="grid gap-4 p-3 sm:p-4 md:grid-cols-[1fr_1fr] overflow-hidden">
            {/* Left: form */}
            <div className="space-y-4 min-w-0">
              <div className="space-y-2">
                <Label htmlFor="doc-title">Título</Label>
                <Input
                  id="doc-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Atestado de Comparecimento"
                  maxLength={255}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc-body">Corpo do documento</Label>
                <Textarea
                  id="doc-body"
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  placeholder="Use os marcadores abaixo para inserir dados do paciente, da clínica, etc."
                  className="font-serif"
                />
              </div>

              <div>
                <Label className="mb-2 block text-xs uppercase tracking-wider text-mid">
                  Marcadores disponíveis
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_DOCUMENT_PLACEHOLDERS.map((p) => (
                    <button
                      key={p.token}
                      type="button"
                      onClick={() => insertPlaceholderAtCursor(p.token)}
                      className="rounded-full border border-[#E8ECEF] bg-white px-2.5 py-1 text-xs text-charcoal hover:bg-blush/40"
                      title={p.description}
                    >
                      {p.token}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: live preview */}
            <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-2 sm:p-3 min-w-0 overflow-hidden">
              <div className="mb-2 text-xs uppercase tracking-wider text-mid">
                Pré-visualização
              </div>
              <DocumentPreview
                kind={kind}
                title={title}
                body={body}
                patient={{
                  fullName: patient.fullName,
                  cpf: patient.cpf,
                  birthDate: patient.birthDate,
                }}
                practitioner={previewPractitioner}
                tenant={previewTenant}
              />
            </div>
          </div>
        ) : (
          // Delivery step
          <div className="space-y-4 p-4">
            <div className="rounded-[3px] border border-green-200 bg-green-50 p-4">
              <div className="font-medium text-green-900">Documento emitido</div>
              <p className="mt-1 text-sm text-green-800">
                Use as ações abaixo para imprimir, baixar ou enviar via WhatsApp.
              </p>
            </div>

            {issuedId && (
              <DeliveryActions
                documentId={issuedId}
                patientId={patient.id}
                patientHasPhone={Boolean(patient.phone)}
              />
            )}
          </div>
        )}

        </div>

        {profileReady && (step === 'template' || step === 'preview' || step === 'compose') && (
          <DialogFooter className="m-0 flex-row flex-wrap justify-between gap-2 rounded-b-xl border-t border-[#E8ECEF] bg-muted/50 p-3 sm:p-4">
            <Button variant="outline" size="sm" onClick={handleBack}>
              <ArrowLeftIcon className="size-3.5" />
              Voltar
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              {(step === 'preview' || step === 'compose') && (
                <Button size="sm" onClick={handleIssue} disabled={issueMutation.isPending}>
                  {issueMutation.isPending ? 'Emitindo...' : 'Emitir'}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}

        {step === 'delivery' && (
          <DialogFooter className="m-0 flex-row justify-end gap-2 rounded-b-xl border-t border-[#E8ECEF] bg-muted/50 p-4">
            <Button onClick={() => onOpenChange(false)}>Concluir</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

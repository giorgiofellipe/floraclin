'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, AlertCircle } from 'lucide-react'
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

const KIND_OPTIONS: Record<string, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
}

const NO_TEMPLATE_VALUE = '__none__'

type WizardStep = 'compose' | 'delivery'

export function IssueDocumentDialog({
  open,
  onOpenChange,
  patient,
}: IssueDocumentDialogProps) {
  const [step, setStep] = React.useState<WizardStep>('compose')
  const [kind, setKind] = React.useState<ClinicalDocumentKind>('receita')
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

  // Reset form when dialog opens/closes or the kind changes.
  React.useEffect(() => {
    if (!open) {
      setStep('compose')
      setKind('receita')
      setTemplateId(NO_TEMPLATE_VALUE)
      setTitle('')
      setBody('')
      setIssuedId(null)
    }
  }, [open])

  React.useEffect(() => {
    // When kind changes, clear the chosen template (it may not apply).
    setTemplateId(NO_TEMPLATE_VALUE)
  }, [kind])

  React.useEffect(() => {
    if (templateId === NO_TEMPLATE_VALUE || !templatesData) return
    const tpl = templatesData.find((t) => t.id === templateId)
    if (tpl) {
      setBody(tpl.body)
      if (!title) setTitle(tpl.name)
    }
  }, [templateId, templatesData, title])

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
        address: (tenant.address ?? null) as IssueDocumentDialogProps['patient'] extends never
          ? never
          : Record<string, string | undefined> | null,
      }
    : { name: '', phone: null, email: null, logoUrl: null, address: null }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-[#E8ECEF] px-6 py-4">
          <DialogTitle>Novo documento clínico</DialogTitle>
          <DialogDescription>
            Emitir receita ou atestado para {patient.fullName}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">

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
        ) : step === 'compose' ? (
          <div className="grid gap-4 p-4 md:grid-cols-[1fr_1fr]">
            {/* Left: form */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  items={KIND_OPTIONS}
                  value={kind}
                  onValueChange={(v) => setKind((v as ClinicalDocumentKind) ?? 'receita')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Modelo (opcional)</Label>
                <Select
                  items={{
                    [NO_TEMPLATE_VALUE]: 'Sem modelo (em branco)',
                    ...(templatesData ?? []).reduce(
                      (acc, t) => {
                        acc[t.id] = t.name
                        return acc
                      },
                      {} as Record<string, string>,
                    ),
                  }}
                  value={templateId}
                  onValueChange={(v) => setTemplateId(v ?? NO_TEMPLATE_VALUE)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione um modelo" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc-title">Título</Label>
                <Input
                  id="doc-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Receita Dipirona 500mg"
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
                  placeholder="Use os marcadores ao lado para inserir dados do paciente, da clínica, etc."
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
            <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-3">
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

        {profileReady && step === 'compose' && (
          <DialogFooter className="m-0 flex-row justify-end gap-2 rounded-b-xl border-t border-[#E8ECEF] bg-muted/50 p-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleIssue} disabled={issueMutation.isPending}>
              {issueMutation.isPending ? 'Emitindo...' : 'Emitir documento'}
            </Button>
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

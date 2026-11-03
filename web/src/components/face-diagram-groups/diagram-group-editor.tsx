'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, MessageCircle, Play } from 'lucide-react'
import { toast } from 'sonner'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { CatalogProduct, DiagramPointData } from '@/components/face-diagram/types'
import { diagramsToPoints, pointsToViews } from '@/components/face-diagram/points'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useReadOnly } from '@/components/layout/subscription-access'
import { useDiagramProducts } from '@/hooks/queries/use-products'
import { useProcedures } from '@/hooks/queries/use-procedures'
import {
  useCreateDiagramGroup,
  useGenerateDiagramQuote,
  useSendDiagramQuoteWhatsapp,
  useUpdateDiagramGroup,
} from '@/hooks/mutations/use-face-diagram-group-mutations'
import type { DiagramGroupJson } from '@/hooks/queries/use-face-diagram-groups'
import { tryNormalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { isOpenStatus } from '@/lib/procedure-status'
import { DIAGRAM_STATUS_LABELS, isOpenDiagram } from '@/lib/face-diagram-status'
import { cn } from '@/lib/utils'
import { canWriteClinical } from '@/lib/constants'
import type { Patient } from '@/db/queries/patients'
import type { ProcedureStatus, Role } from '@/types'
import type { QuotationLine } from '@/validations/face-diagram-group'
import { QuotationLinesEditor } from './quotation-lines-editor'
import { QuoteHistory } from './quote-history'

const CARD = 'rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]'

interface DiagramGroupEditorProps {
  patient: Patient
  group: DiagramGroupJson | null
  role: Role
}

export function DiagramGroupEditor({ patient, group, role }: DiagramGroupEditorProps) {
  const router = useRouter()
  const subscriptionReadOnly = useReadOnly()
  const [points, setPoints] = useState<DiagramPointData[]>(() => diagramsToPoints(group?.views))
  const [lines, setLines] = useState<QuotationLine[]>(() => group?.quotationLines ?? [])
  const [isQuote, setIsQuote] = useState(() => (group?.quotationLines.length ?? 0) > 0)
  const [confirmingRemoveQuote, setConfirmingRemoveQuote] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'pdf' | 'whatsapp' | null>(null)
  const [syncedUpdatedAt, setSyncedUpdatedAt] = useState(group?.updatedAt)

  if (group && group.updatedAt !== syncedUpdatedAt && !busy && !dirty) {
    setSyncedUpdatedAt(group.updatedAt)
    setPoints(diagramsToPoints(group.views))
    setLines(group.quotationLines)
    setIsQuote(group.quotationLines.length > 0)
  }

  const createGroup = useCreateDiagramGroup()
  const updateGroup = useUpdateDiagramGroup()
  const generateQuoteMutation = useGenerateDiagramQuote()
  const sendWhatsapp = useSendDiagramQuoteWhatsapp()
  const { data: productsData } = useDiagramProducts()
  const { data: procedures, isLoading: loadingProcedures } = useProcedures(patient.id)

  const products = (productsData ?? []) as CatalogProduct[]
  const status = group?.status ?? 'diagram'
  const readOnly = !isOpenDiagram(status) || !canWriteClinical(role) || subscriptionReadOnly
  const saving = createGroup.isPending || updateGroup.isPending

  const hasActiveService = useMemo(
    () =>
      ((procedures ?? []) as { status: ProcedureStatus }[]).some((p) => isOpenStatus(p.status)),
    [procedures],
  )
  const atendimentoHref = `/pacientes/${patient.id}/atendimento`
  const serviceAction = (groupId: string) =>
    hasActiveService
      ? { href: atendimentoHref, label: 'Continuar atendimento' }
      : { href: `${atendimentoHref}?new=1&diagram=${groupId}`, label: 'Iniciar atendimento com este diagrama' }
  const phoneOk = tryNormalizeBrPhoneForWhatsApp(patient.phone).ok
  const hasLines = lines.length > 0

  function handleQuoteToggle(checked: boolean) {
    if (checked) setIsQuote(true)
    else if (hasLines) setConfirmingRemoveQuote(true)
    else setIsQuote(false)
  }

  function removeQuote() {
    setLines([])
    setIsQuote(false)
    setDirty(true)
    setConfirmingRemoveQuote(false)
  }

  async function save(): Promise<string | null> {
    const body = { views: pointsToViews(points), quotationLines: lines }
    try {
      if (!group) {
        const res = await createGroup.mutateAsync({ patientId: patient.id, ...body })
        toast.success('Diagrama salvo')
        router.replace(`/pacientes/${patient.id}/diagramas/${res.data.id}`)
        return res.data.id
      }
      if (dirty) {
        await updateGroup.mutateAsync({ id: group.id, ...body })
        setDirty(false)
        toast.success('Diagrama salvo')
      }
      return group.id
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar diagrama')
      return null
    }
  }

  async function generateQuote(groupId: string): Promise<{ id: string; url: string } | null> {
    try {
      return await generateQuoteMutation.mutateAsync({ groupId, patientId: patient.id })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao gerar orçamento')
      return null
    }
  }

  async function handlePdf() {
    if (!group) return
    // Opened synchronously so the browser does not block it after the awaits
    const tab = window.open('', '_blank')
    setBusy('pdf')
    try {
      const quote = (await save()) === null ? null : await generateQuote(group.id)
      if (!quote) {
        tab?.close()
        return
      }
      if (tab) tab.location.href = quote.url
      else window.open(quote.url, '_blank')
    } finally {
      setBusy(null)
    }
  }

  async function handleWhatsapp() {
    if (!group) return
    setBusy('whatsapp')
    try {
      const quote = (await save()) === null ? null : await generateQuote(group.id)
      if (!quote) return
      const result = await sendWhatsapp.mutateAsync({ quoteId: quote.id, patientId: patient.id })
      toast.success(result?.queued ? 'Orçamento na fila do WhatsApp' : 'Orçamento enviado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao enviar via WhatsApp')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link
          href={`/pacientes/${patient.id}?tab=diagramas`}
          className="inline-flex items-center gap-1 text-sm text-mid hover:text-charcoal"
        >
          <ArrowLeft className="size-4" />
          Voltar para Diagramas
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl text-forest">{patient.fullName}</h1>
          <Badge variant="outline" className="border-sage/30 text-sage">
            {DIAGRAM_STATUS_LABELS[status]}
          </Badge>
        </div>
      </div>

      <section className={CARD}>
        <FaceDiagramEditor
          points={points}
          onChange={(next) => {
            setPoints(next)
            setDirty(true)
          }}
          readOnly={readOnly}
          gender={patient.gender}
          products={products}
        />
      </section>

      {(!readOnly || hasLines) && (
        <section className={cn(CARD, 'space-y-3')}>
          {readOnly ? (
            <h2 className="text-sm font-medium text-charcoal">Orçamento</h2>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="diagram-is-quote" className="cursor-pointer text-sm font-medium text-charcoal">
                Transformar em orçamento?
              </Label>
              <Switch id="diagram-is-quote" checked={isQuote} onCheckedChange={handleQuoteToggle} />
            </div>
          )}
          {isQuote && (
            <QuotationLinesEditor
              value={lines}
              onChange={(next) => {
                setLines(next)
                setDirty(true)
              }}
              readOnly={readOnly}
            />
          )}
        </section>
      )}

      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" onClick={save} disabled={saving || busy !== null}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
          {isQuote && (
            <Button
              type="button"
              variant="outline"
              onClick={handlePdf}
              disabled={!group || !hasLines || busy !== null || saving}
            >
              <FileText className="size-4" />
              {busy === 'pdf' ? 'Gerando...' : 'Gerar PDF'}
            </Button>
          )}
          {isQuote && phoneOk && (
            <Button
              type="button"
              variant="outline"
              onClick={handleWhatsapp}
              disabled={!group || !hasLines || busy !== null || saving}
            >
              <MessageCircle className="size-4" />
              {busy === 'whatsapp' ? 'Enviando...' : 'Enviar por WhatsApp'}
            </Button>
          )}
          {group && (
            <ServiceLink loading={loadingProcedures} {...serviceAction(group.id)} />
          )}
        </div>
      )}

      {readOnly && status === 'in_service' && (
        <ServiceLink href={atendimentoHref} label="Continuar atendimento" />
      )}

      {group && <QuoteHistory groupId={group.id} />}

      <Dialog open={confirmingRemoveQuote} onOpenChange={setConfirmingRemoveQuote}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover orçamento?</DialogTitle>
            <DialogDescription>
              Os procedimentos e valores deste orçamento serão removidos ao salvar. Os PDFs já gerados continuam no histórico.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmingRemoveQuote(false)}>
              Manter orçamento
            </Button>
            <Button type="button" variant="destructive" onClick={removeQuote}>
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ServiceLink({ href, label, loading = false }: { href: string; label: string; loading?: boolean }) {
  if (loading) {
    return (
      <Button type="button" variant="outline" className="text-forest" disabled>
        <Play className="size-4" />
        Verificando atendimento...
      </Button>
    )
  }
  return (
    <Link href={href} className={cn(buttonVariants({ variant: 'outline' }), 'text-forest')}>
      <Play className="size-4" />
      {label}
    </Link>
  )
}

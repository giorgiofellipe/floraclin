'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, MessageCircle, Play } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { CatalogProduct, DiagramPointData } from '@/components/face-diagram/types'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { useReadOnly } from '@/components/layout/subscription-access'
import { useDiagramProducts } from '@/hooks/queries/use-products'
import { useProcedures } from '@/hooks/queries/use-procedures'
import {
  useCreateDiagramGroup,
  useUpdateDiagramGroup,
} from '@/hooks/mutations/use-face-diagram-group-mutations'
import { queryKeys } from '@/hooks/queries/query-keys'
import type { DiagramGroupJson } from '@/hooks/queries/use-face-diagram-groups'
import { tryNormalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { isOpenStatus } from '@/lib/procedure-status'
import { DIAGRAM_STATUS_LABELS } from '@/lib/face-diagram-status'
import { cn } from '@/lib/utils'
import type { Patient } from '@/db/queries/patients'
import type { DiagramViewType, ProcedureStatus, Role } from '@/types'
import type { QuotationLine } from '@/validations/face-diagram-group'
import { QuotationLinesEditor } from './quotation-lines-editor'
import { QuoteHistory } from './quote-history'

const CARD = 'rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
const VIEW_TYPES: DiagramViewType[] = ['front', 'left_profile', 'right_profile']

export function groupToPoints(group: DiagramGroupJson | null): DiagramPointData[] {
  if (!group) return []
  return group.views.flatMap((view) =>
    view.points.map((p) => ({
      id: p.id,
      x: Number(p.x),
      y: Number(p.y),
      viewType: view.viewType,
      productName: p.productName,
      activeIngredient: p.activeIngredient ?? undefined,
      quantity: Number(p.quantity),
      quantityUnit: p.quantityUnit as DiagramPointData['quantityUnit'],
      technique: p.technique ?? undefined,
      depth: p.depth ?? undefined,
      notes: p.notes ?? undefined,
    })),
  )
}

function pointsToViews(points: DiagramPointData[]) {
  const views = VIEW_TYPES.map((viewType) => ({
    viewType,
    points: points
      .filter((p) => (p.viewType || 'front') === viewType)
      .map((p) => ({
        x: p.x,
        y: p.y,
        productName: p.productName,
        activeIngredient: p.activeIngredient,
        quantity: p.quantity,
        quantityUnit: p.quantityUnit,
        technique: p.technique,
        depth: p.depth,
        notes: p.notes,
      })),
  })).filter((v) => v.points.length > 0)
  return views.length > 0 ? views : [{ viewType: 'front' as const, points: [] }]
}

interface DiagramGroupEditorProps {
  patient: Patient
  group: DiagramGroupJson | null
  role: Role
}

export function DiagramGroupEditor({ patient, group, role }: DiagramGroupEditorProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const subscriptionReadOnly = useReadOnly()
  const [points, setPoints] = useState<DiagramPointData[]>(() => groupToPoints(group))
  const [lines, setLines] = useState<QuotationLine[]>(() => group?.quotationLines ?? [])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'pdf' | 'whatsapp' | null>(null)

  const createGroup = useCreateDiagramGroup()
  const updateGroup = useUpdateDiagramGroup()
  const { data: productsData } = useDiagramProducts()
  const { data: procedures, isLoading: loadingProcedures } = useProcedures(patient.id)

  const products = (productsData ?? []) as CatalogProduct[]
  const status = group?.status ?? 'quote'
  const canWrite = role === 'owner' || role === 'practitioner'
  const readOnly = status !== 'quote' || !canWrite || subscriptionReadOnly
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
  const phoneOk = !!patient.phone && tryNormalizeBrPhoneForWhatsApp(patient.phone).ok
  const hasLines = lines.length > 0

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
    const res = await fetch(`/api/face-diagram-groups/${groupId}/quotes`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(json.error || 'Falha ao gerar orçamento')
      return null
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.diagramGroups.detail(groupId) })
    return json.data
  }

  async function handlePdf() {
    if (!group) return
    // Opened synchronously so the browser does not block it after the awaits
    const tab = window.open('', '_blank')
    setBusy('pdf')
    try {
      if ((await save()) === null) return tab?.close()
      const quote = await generateQuote(group.id)
      if (!quote) return tab?.close()
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
      if ((await save()) === null) return
      const quote = await generateQuote(group.id)
      if (!quote) return
      const res = await fetch(`/api/face-diagram-quotes/${quote.id}/send-whatsapp`, {
        method: 'POST',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Falha ao enviar via WhatsApp')
        return
      }
      toast.success(json.data?.queued ? 'Orçamento na fila do WhatsApp' : 'Orçamento enviado')
      await queryClient.invalidateQueries({ queryKey: queryKeys.diagramGroups.detail(group.id) })
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

      <section className={cn(CARD, 'space-y-3')}>
        <h2 className="text-sm font-medium text-charcoal">Orçamento</h2>
        <QuotationLinesEditor
          value={lines}
          onChange={(next) => {
            setLines(next)
            setDirty(true)
          }}
          readOnly={readOnly}
        />
      </section>

      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" onClick={save} disabled={saving || busy !== null}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handlePdf}
            disabled={!group || !hasLines || busy !== null || saving}
          >
            <FileText className="size-4" />
            {busy === 'pdf' ? 'Gerando...' : 'Gerar PDF'}
          </Button>
          {phoneOk && (
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

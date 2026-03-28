'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  CalendarIcon,
  CheckCircle2,
  AlertTriangle,
  Save,
  Loader2,
  ChevronDown,
  Package,
  FileText,
  Camera,
  Stethoscope,
  CalendarPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { DiagramPointData } from '@/components/face-diagram/types'
import { PhotoUploader } from '@/components/photos/photo-uploader'
import { PhotoGrid } from '@/components/photos/photo-grid'
import { ConsentViewer } from '@/components/consent/consent-viewer'
import {
  createProcedureAction,
  updateProcedureAction,
  listProcedureTypesAction,
  checkConsentStatusAction,
  getPreviousDiagramPointsAction,
} from '@/actions/procedures'
import { getActiveConsentForTypeAction } from '@/actions/consent'
import type { DiagramViewType, QuantityUnit } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { ProductApplicationItem } from '@/validations/procedure'

// ─── Consent type mapping from procedure category ──────────────────

const CATEGORY_TO_CONSENT: Record<string, string> = {
  toxina_botulinica: 'botox',
  botox: 'botox',
  preenchimento: 'filler',
  filler: 'filler',
  bioestimulador: 'biostimulator',
  biostimulator: 'biostimulator',
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'Em andamento',
  completed: 'Concluido',
  cancelled: 'Cancelado',
}

// ─── Types ──────────────────────────────────────────────────────────

interface ProcedureType {
  id: string
  name: string
  category: string
  defaultPrice: string | null
  estimatedDurationMin: number | null
}

interface ConsentInfo {
  id: string
  acceptedAt: Date
  templateTitle: string
  templateType: string
}

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface ProcedureFormProps {
  patientId: string
  procedure?: ProcedureWithDetails | null
  diagrams?: DiagramWithPoints[]
  existingApplications?: ProductApplicationRecord[]
  mode?: 'create' | 'edit' | 'view'
}

// ─── Collapsible Section ───────────────────────────────────────────

function Section({
  title,
  icon,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string
  icon: React.ReactNode
  open: boolean
  onToggle: () => void
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="bg-white">
      <CardHeader
        className="cursor-pointer pb-3 hover:bg-petal/30"
        onClick={onToggle}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            {icon}
            <span className="uppercase tracking-wider text-sm text-forest">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {badge}
            <ChevronDown
              className={cn(
                'size-4 text-mid transition-transform',
                open && 'rotate-180'
              )}
            />
          </div>
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  )
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureForm({
  patientId,
  procedure,
  diagrams: existingDiagrams,
  existingApplications,
  mode = 'create',
}: ProcedureFormProps) {
  const router = useRouter()
  const isReadOnly = mode === 'view'
  const isEdit = mode === 'edit'

  // ─── Form state ──────────────────────────────────────────────────
  const [procedureTypeId, setProcedureTypeId] = useState(
    procedure?.procedureTypeId ?? ''
  )
  const [technique, setTechnique] = useState(procedure?.technique ?? '')
  const [clinicalResponse, setClinicalResponse] = useState(
    procedure?.clinicalResponse ?? ''
  )
  const [adverseEffects, setAdverseEffects] = useState(
    procedure?.adverseEffects ?? ''
  )
  const [notes, setNotes] = useState(procedure?.notes ?? '')
  const [followUpDate, setFollowUpDate] = useState(
    procedure?.followUpDate ?? ''
  )
  const [nextSessionObjectives, setNextSessionObjectives] = useState(
    procedure?.nextSessionObjectives ?? ''
  )

  // ─── Data loading state ──────────────────────────────────────────
  const [procedureTypes, setProcedureTypes] = useState<ProcedureType[]>([])
  const [loadingTypes, setLoadingTypes] = useState(true)

  // ─── Consent state ───────────────────────────────────────────────
  const [consentStatus, setConsentStatus] = useState<ConsentInfo | null>(null)
  const [consentTemplate, setConsentTemplate] = useState<ConsentTemplate | null>(
    null
  )
  const [consentChecking, setConsentChecking] = useState(false)
  const [consentAccepted, setConsentAccepted] = useState(false)

  // ─── Face diagram state ──────────────────────────────────────────
  const [diagramPoints, setDiagramPoints] = useState<DiagramPointData[]>(() => {
    if (existingDiagrams && existingDiagrams.length > 0) {
      const allPoints: DiagramPointData[] = []
      for (const d of existingDiagrams) {
        for (const p of d.points) {
          allPoints.push({
            id: p.id,
            x: parseFloat(p.x),
            y: parseFloat(p.y),
            productName: p.productName,
            activeIngredient: p.activeIngredient ?? undefined,
            quantity: parseFloat(p.quantity),
            quantityUnit: p.quantityUnit as QuantityUnit,
            technique: p.technique ?? undefined,
            depth: p.depth ?? undefined,
            notes: p.notes ?? undefined,
          })
        }
      }
      return allPoints
    }
    return []
  })
  const [previousPoints, setPreviousPoints] = useState<DiagramPointData[]>([])

  // ─── Product applications state ──────────────────────────────────
  const [productApps, setProductApps] = useState<ProductApplicationItem[]>(
    () => {
      if (existingApplications) {
        return existingApplications.map((a) => ({
          productName: a.productName,
          activeIngredient: a.activeIngredient ?? undefined,
          totalQuantity: parseFloat(a.totalQuantity),
          quantityUnit: a.quantityUnit as QuantityUnit,
          batchNumber: a.batchNumber ?? undefined,
          expirationDate: a.expirationDate ?? undefined,
          labelPhotoId: a.labelPhotoId ?? undefined,
          applicationAreas: a.applicationAreas ?? undefined,
          notes: a.notes ?? undefined,
        }))
      }
      return []
    }
  )

  // ─── Photo state ─────────────────────────────────────────────────
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)

  // ─── Submit state ────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ─── Section open state ──────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    consent: true,
    prePhotos: true,
    diagram: true,
    products: true,
    clinicalNotes: true,
    followUp: true,
    postPhotos: true,
  })

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // ─── Load procedure types ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const types = await listProcedureTypesAction()
        setProcedureTypes(types as ProcedureType[])
      } finally {
        setLoadingTypes(false)
      }
    }
    load()
  }, [])

  // ─── Load previous diagram points (ghost overlay) ────────────────
  useEffect(() => {
    async function load() {
      const result = await getPreviousDiagramPointsAction(
        patientId,
        procedure?.id
      )
      if (result.success && result.data && result.data.length > 0) {
        setPreviousPoints(
          result.data.map((p) => ({
            id: p.id,
            x: parseFloat(p.x),
            y: parseFloat(p.y),
            productName: p.productName,
            activeIngredient: p.activeIngredient ?? undefined,
            quantity: parseFloat(p.quantity),
            quantityUnit: p.quantityUnit as QuantityUnit,
            technique: p.technique ?? undefined,
            depth: p.depth ?? undefined,
            notes: p.notes ?? undefined,
          }))
        )
      }
    }
    load()
  }, [patientId, procedure?.id])

  // ─── Check consent when procedure type changes ───────────────────
  const selectedType = useMemo(
    () => procedureTypes.find((t) => t.id === procedureTypeId),
    [procedureTypes, procedureTypeId]
  )

  useEffect(() => {
    if (!selectedType) {
      setConsentStatus(null)
      setConsentTemplate(null)
      return
    }

    const consentType =
      CATEGORY_TO_CONSENT[selectedType.category.toLowerCase()] ?? 'general'

    async function checkConsent() {
      setConsentChecking(true)
      try {
        const result = await checkConsentStatusAction(patientId, consentType)
        if (result.success && result.data) {
          setConsentStatus(result.data)
          setConsentTemplate(null)
        } else {
          setConsentStatus(null)
          const template = await getActiveConsentForTypeAction(consentType)
          setConsentTemplate(template ?? null)
        }
      } finally {
        setConsentChecking(false)
      }
    }

    checkConsent()
  }, [selectedType, patientId])

  // ─── Auto-populate product applications from diagram points ──────
  useEffect(() => {
    if (isReadOnly) return

    const totals = new Map<
      string,
      { totalQuantity: number; activeIngredient?: string; unit: QuantityUnit }
    >()

    for (const point of diagramPoints) {
      const key = `${point.productName}|${point.quantityUnit}`
      const existing = totals.get(key)
      if (existing) {
        existing.totalQuantity += point.quantity
      } else {
        totals.set(key, {
          totalQuantity: point.quantity,
          activeIngredient: point.activeIngredient,
          unit: point.quantityUnit,
        })
      }
    }

    setProductApps((prevApps) => {
      const newApps: ProductApplicationItem[] = []

      for (const [key, total] of totals) {
        const [productName] = key.split('|')
        const existing = prevApps.find(
          (a) => a.productName === productName && a.quantityUnit === total.unit
        )

        newApps.push({
          productName,
          activeIngredient: total.activeIngredient,
          totalQuantity: total.totalQuantity,
          quantityUnit: total.unit,
          batchNumber: existing?.batchNumber,
          expirationDate: existing?.expirationDate,
          labelPhotoId: existing?.labelPhotoId,
          applicationAreas: existing?.applicationAreas,
          notes: existing?.notes,
        })
      }

      return newApps
    })
  }, [diagramPoints, isReadOnly])

  // ─── Handlers ────────────────────────────────────────────────────

  const handleProductAppChange = useCallback(
    (index: number, field: keyof ProductApplicationItem, value: string) => {
      setProductApps((prev) => {
        const updated = [...prev]
        updated[index] = { ...updated[index], [field]: value }
        return updated
      })
    },
    []
  )

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || isReadOnly) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const diagramsPayload =
        diagramPoints.length > 0
          ? [
              {
                viewType: 'front' as DiagramViewType,
                points: diagramPoints.map((p) => ({
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
              },
            ]
          : undefined

      const payload = {
        patientId,
        procedureTypeId,
        technique: technique || undefined,
        clinicalResponse: clinicalResponse || undefined,
        adverseEffects: adverseEffects || undefined,
        notes: notes || undefined,
        followUpDate: followUpDate || undefined,
        nextSessionObjectives: nextSessionObjectives || undefined,
        diagrams: diagramsPayload,
        productApplications: productApps.length > 0 ? productApps : undefined,
      }

      let result
      if (isEdit && procedure?.id) {
        result = await updateProcedureAction(procedure.id, payload)
      } else {
        result = await createProcedureAction(payload)
      }

      if (result.success) {
        router.push(`/pacientes/${patientId}?tab=procedimentos`)
        router.refresh()
      } else {
        setSubmitError(result.error ?? 'Erro ao salvar procedimento')
      }
    } catch {
      setSubmitError('Erro inesperado ao salvar procedimento')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    isSubmitting,
    isReadOnly,
    isEdit,
    procedure?.id,
    patientId,
    procedureTypeId,
    technique,
    clinicalResponse,
    adverseEffects,
    notes,
    followUpDate,
    nextSessionObjectives,
    diagramPoints,
    productApps,
    router,
  ])

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-forest">
            {isEdit
              ? 'Editar Procedimento'
              : mode === 'view'
                ? 'Procedimento'
                : 'Novo Procedimento'}
          </h1>
          {procedure && (
            <p className="mt-1 text-sm text-mid">
              Realizado em{' '}
              {format(
                new Date(procedure.performedAt),
                "dd/MM/yyyy 'as' HH:mm",
                { locale: ptBR }
              )}
            </p>
          )}
        </div>

        {procedure && (
          <Badge
            variant="outline"
            className={cn(
              procedure.status === 'completed' &&
                'border-sage bg-sage/10 text-sage',
              procedure.status === 'in_progress' &&
                'border-amber bg-amber-light text-amber-dark',
              procedure.status === 'cancelled' &&
                'border-red-300 bg-red-100 text-red-800'
            )}
          >
            {STATUS_LABELS[procedure.status] ?? procedure.status}
          </Badge>
        )}
      </div>

      {/* ── Procedure Type Select ───────────────────────────────────── */}
      <Card className="bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="size-4 text-forest" />
            <span className="uppercase tracking-wider text-sm text-forest">
              Tipo de Procedimento
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTypes ? (
            <div className="flex items-center gap-2 text-sm text-mid">
              <Loader2 className="size-4 animate-spin" />
              Carregando tipos...
            </div>
          ) : (
            <Select
              value={procedureTypeId}
              onValueChange={(val) => val && setProcedureTypeId(val)}
              disabled={isReadOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o tipo de procedimento" />
              </SelectTrigger>
              <SelectContent>
                {procedureTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                    {type.defaultPrice && (
                      <span className="ml-2 text-mid">
                        (R$ {parseFloat(type.defaultPrice).toFixed(2)})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* ── Consent Section ─────────────────────────────────────────── */}
      {procedureTypeId && (
        <Section
          title="Consentimento"
          icon={<FileText className="size-4 text-forest" />}
          open={openSections.consent}
          onToggle={() => toggleSection('consent')}
          badge={
            <>
              {consentStatus && (
                <Badge className="bg-sage/10 text-sage border-sage">
                  <CheckCircle2 className="mr-1 size-3" />
                  Assinado
                </Badge>
              )}
              {!consentStatus &&
                consentTemplate &&
                !consentAccepted && (
                  <Badge className="bg-amber-light text-amber-dark border-amber">
                    <AlertTriangle className="mr-1 size-3" />
                    Pendente
                  </Badge>
                )}
              {consentAccepted && (
                <Badge className="bg-sage/10 text-sage border-sage">
                  <CheckCircle2 className="mr-1 size-3" />
                  Aceito agora
                </Badge>
              )}
            </>
          }
        >
          {consentChecking ? (
            <div className="flex items-center gap-2 py-4 text-sm text-mid">
              <Loader2 className="size-4 animate-spin" />
              Verificando consentimento...
            </div>
          ) : consentStatus ? (
            <div className="flex items-center gap-3 rounded-lg bg-sage/5 p-4">
              <CheckCircle2 className="size-5 text-sage" />
              <div>
                <p className="text-sm font-medium text-forest">
                  Termo assinado em{' '}
                  {format(
                    new Date(consentStatus.acceptedAt),
                    "dd/MM/yyyy 'as' HH:mm",
                    { locale: ptBR }
                  )}
                </p>
                <p className="text-xs text-mid">
                  {consentStatus.templateTitle}
                </p>
              </div>
            </div>
          ) : consentTemplate && !consentAccepted ? (
            <ConsentViewer
              template={consentTemplate}
              patientId={patientId}
              procedureRecordId={procedure?.id}
              onAccepted={() => setConsentAccepted(true)}
            />
          ) : consentAccepted ? (
            <div className="flex items-center gap-3 rounded-lg bg-sage/5 p-4">
              <CheckCircle2 className="size-5 text-sage" />
              <p className="text-sm font-medium text-forest">
                Termo aceito com sucesso
              </p>
            </div>
          ) : (
            <p className="py-4 text-sm text-mid">
              Nenhum termo de consentimento encontrado para este tipo de
              procedimento.
            </p>
          )}
        </Section>
      )}

      {/* ── Pre-Procedure Photos ────────────────────────────────────── */}
      <Section
        title="Fotos Pre-Procedimento"
        icon={<Camera className="size-4 text-forest" />}
        open={openSections.prePhotos}
        onToggle={() => toggleSection('prePhotos')}
      >
        {!isReadOnly && (
          <PhotoUploader
            patientId={patientId}
            procedureRecordId={procedure?.id}
            onUploadComplete={() => setPhotoRefreshKey((k) => k + 1)}
          />
        )}
        {procedure?.id && (
          <div className="mt-4">
            <PhotoGrid
              patientId={patientId}
              procedureRecordId={procedure.id}
              refreshKey={photoRefreshKey}
            />
          </div>
        )}
      </Section>

      {/* ── Face Diagram ────────────────────────────────────────────── */}
      <Section
        title="Diagrama Facial"
        icon={
          <svg
            className="size-4 text-forest"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="10" r="7" />
            <path d="M12 17v4M8 21h8" />
          </svg>
        }
        open={openSections.diagram}
        onToggle={() => toggleSection('diagram')}
        badge={
          diagramPoints.length > 0 ? (
            <Badge variant="outline" className="text-xs">
              {diagramPoints.length}{' '}
              {diagramPoints.length === 1 ? 'ponto' : 'pontos'}
            </Badge>
          ) : undefined
        }
      >
        <FaceDiagramEditor
          points={diagramPoints}
          onChange={setDiagramPoints}
          previousPoints={previousPoints}
          readOnly={isReadOnly}
        />
      </Section>

      {/* ── Product Details ─────────────────────────────────────────── */}
      {productApps.length > 0 && (
        <Section
          title="Detalhes dos Produtos"
          icon={<Package className="size-4 text-forest" />}
          open={openSections.products}
          onToggle={() => toggleSection('products')}
          badge={
            <Badge variant="outline" className="text-xs">
              {productApps.length}{' '}
              {productApps.length === 1 ? 'produto' : 'produtos'}
            </Badge>
          }
        >
          <div className="space-y-4">
            {productApps.map((app, index) => (
              <div
                key={`${app.productName}-${app.quantityUnit}-${index}`}
                className="rounded-lg border bg-cream/30 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-medium text-forest">
                    {app.productName}
                  </h4>
                  <Badge variant="outline" className="text-xs">
                    {app.totalQuantity}
                    {app.quantityUnit}
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="uppercase tracking-wider text-xs text-mid">
                      Lote / Batch
                    </Label>
                    <Input
                      value={app.batchNumber ?? ''}
                      onChange={(e) =>
                        handleProductAppChange(
                          index,
                          'batchNumber',
                          e.target.value
                        )
                      }
                      placeholder="Ex: ABC12345"
                      disabled={isReadOnly}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="uppercase tracking-wider text-xs text-mid">
                      Validade
                    </Label>
                    <Input
                      type="date"
                      value={app.expirationDate ?? ''}
                      onChange={(e) =>
                        handleProductAppChange(
                          index,
                          'expirationDate',
                          e.target.value
                        )
                      }
                      disabled={isReadOnly}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <Label className="uppercase tracking-wider text-xs text-mid">
                    Areas de aplicacao
                  </Label>
                  <Input
                    value={app.applicationAreas ?? ''}
                    onChange={(e) =>
                      handleProductAppChange(
                        index,
                        'applicationAreas',
                        e.target.value
                      )
                    }
                    placeholder="Ex: Frontal, Glabela, Periorbital"
                    disabled={isReadOnly}
                    className="mt-1"
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Clinical Notes ──────────────────────────────────────────── */}
      <Section
        title="Notas Clinicas"
        icon={<FileText className="size-4 text-forest" />}
        open={openSections.clinicalNotes}
        onToggle={() => toggleSection('clinicalNotes')}
      >
        <div className="space-y-4">
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Tecnica utilizada
            </Label>
            <Textarea
              value={technique}
              onChange={(e) => setTechnique(e.target.value)}
              placeholder="Descreva a tecnica utilizada..."
              disabled={isReadOnly}
              className="mt-1"
              rows={3}
            />
          </div>

          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Resposta clinica
            </Label>
            <Textarea
              value={clinicalResponse}
              onChange={(e) => setClinicalResponse(e.target.value)}
              placeholder="Descreva a resposta clinica observada..."
              disabled={isReadOnly}
              className="mt-1"
              rows={3}
            />
          </div>

          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Efeitos adversos
            </Label>
            <Textarea
              value={adverseEffects}
              onChange={(e) => setAdverseEffects(e.target.value)}
              placeholder="Registre quaisquer efeitos adversos observados..."
              disabled={isReadOnly}
              className="mt-1"
              rows={2}
            />
          </div>

          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Observacoes gerais
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observacoes adicionais..."
              disabled={isReadOnly}
              className="mt-1"
              rows={3}
            />
          </div>
        </div>
      </Section>

      {/* ── Follow-up ───────────────────────────────────────────────── */}
      <Section
        title="Retorno / Follow-up"
        icon={<CalendarPlus className="size-4 text-forest" />}
        open={openSections.followUp}
        onToggle={() => toggleSection('followUp')}
        badge={
          followUpDate ? (
            <Badge variant="outline" className="text-xs">
              {format(new Date(followUpDate + 'T12:00:00'), 'dd/MM/yyyy', {
                locale: ptBR,
              })}
            </Badge>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Data do retorno
            </Label>
            <Input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              disabled={isReadOnly}
              className="mt-1"
              min={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>

          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Objetivos da proxima sessao
            </Label>
            <Textarea
              value={nextSessionObjectives}
              onChange={(e) => setNextSessionObjectives(e.target.value)}
              placeholder="Descreva os objetivos para a proxima sessao..."
              disabled={isReadOnly}
              className="mt-1"
              rows={3}
            />
          </div>
        </div>
      </Section>

      {/* ── Post-Procedure Photos ───────────────────────────────────── */}
      <Section
        title="Fotos Pos-Procedimento"
        icon={<Camera className="size-4 text-forest" />}
        open={openSections.postPhotos}
        onToggle={() => toggleSection('postPhotos')}
      >
        {!isReadOnly && (
          <PhotoUploader
            patientId={patientId}
            procedureRecordId={procedure?.id}
            onUploadComplete={() => setPhotoRefreshKey((k) => k + 1)}
          />
        )}
      </Section>

      {/* ── Submit ──────────────────────────────────────────────────── */}
      {!isReadOnly && (
        <div className="sticky bottom-0 z-10 border-t bg-cream/95 py-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
              }
              disabled={isSubmitting}
              className="border-forest text-forest hover:bg-petal"
            >
              Cancelar
            </Button>

            {submitError && (
              <p className="flex-1 text-center text-sm text-red-600">
                {submitError}
              </p>
            )}

            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !procedureTypeId}
              className="bg-forest text-cream hover:bg-sage"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="mr-2 size-4" />
                  {isEdit ? 'Salvar Alteracoes' : 'Salvar Procedimento'}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

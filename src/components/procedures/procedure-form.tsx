'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { AppointmentForm } from '@/components/scheduling/appointment-form'
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
import {
  listPractitionersAction,
  listProcedureTypesForSelectAction,
} from '@/actions/appointments'
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
    <Card className="bg-white overflow-hidden border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader
        className="cursor-pointer pb-3 hover:bg-gray-50 transition-colors duration-150"
        onClick={onToggle}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
              {icon}
            </div>
            <span className="uppercase tracking-wider text-sm text-forest font-medium">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {badge}
            <ChevronDown
              className={cn(
                'size-4 text-mid transition-transform duration-200',
                open && 'rotate-180'
              )}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <div
        className={cn(
          'grid transition-all duration-300 ease-in-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <CardContent className="pt-0 pb-5">{children}</CardContent>
        </div>
      </div>
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

  // ─── Follow-up scheduling state ──────────────────────────────────
  const [showFollowUpPrompt, setShowFollowUpPrompt] = useState(false)
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [appointmentPractitioners, setAppointmentPractitioners] = useState<
    { id: string; fullName: string }[]
  >([])
  const [appointmentProcedureTypes, setAppointmentProcedureTypes] = useState<
    { id: string; name: string; estimatedDurationMin: number | null }[]
  >([])

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
        if (followUpDate) {
          setShowFollowUpPrompt(true)
        } else {
          router.push(`/pacientes/${patientId}?tab=procedimentos`)
          router.refresh()
        }
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
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#2A2A2A]">
            {isEdit
              ? 'Editar Procedimento'
              : mode === 'view'
                ? 'Procedimento'
                : 'Novo Procedimento'}
          </h1>
          {procedure && (
            <p className="mt-1.5 text-sm text-mid">
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
              'px-3 py-1',
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
      <Card className="bg-white border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
              <Stethoscope className="size-4 text-forest" />
            </div>
            <span className="uppercase tracking-wider text-sm text-[#2A2A2A] font-medium">
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
                <SelectValue placeholder="Selecione o tipo de procedimento">
                  {(value: string) => {
                    const type = procedureTypes.find((t) => t.id === value)
                    if (!type) return value
                    return type.defaultPrice
                      ? `${type.name} (R$ ${parseFloat(type.defaultPrice).toFixed(2)})`
                      : type.name
                  }}
                </SelectValue>
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
            <Badge variant="outline" className="text-xs border-sage/30 bg-sage/5 text-sage">
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
                className="rounded-[3px] border border-gray-100 bg-white p-5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="font-medium text-forest">
                    {app.productName}
                  </h4>
                  <Badge variant="outline" className="text-xs border-sage/30 bg-sage/5 text-sage px-2.5 py-0.5">
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
        <div className="space-y-5">
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Tecnica utilizada
            </Label>
            <Textarea
              value={technique}
              onChange={(e) => setTechnique(e.target.value)}
              placeholder="Descreva a tecnica utilizada..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Resposta clinica
            </Label>
            <Textarea
              value={clinicalResponse}
              onChange={(e) => setClinicalResponse(e.target.value)}
              placeholder="Descreva a resposta clinica observada..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Efeitos adversos
            </Label>
            <Textarea
              value={adverseEffects}
              onChange={(e) => setAdverseEffects(e.target.value)}
              placeholder="Registre quaisquer efeitos adversos observados..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[60px] resize-none border-sage/20 focus:border-sage/40"
              rows={2}
            />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Observacoes gerais
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observacoes adicionais..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
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
        <div className="space-y-5">
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Data do retorno
            </Label>
            <Input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              disabled={isReadOnly}
              className="mt-1.5 max-w-xs border-sage/20 focus:border-sage/40"
              min={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Objetivos da proxima sessao
            </Label>
            <Textarea
              value={nextSessionObjectives}
              onChange={(e) => setNextSessionObjectives(e.target.value)}
              placeholder="Descreva os objetivos para a proxima sessao..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
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
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-sage/10 bg-white/95 py-4 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.05)] md:sticky md:left-auto md:right-auto">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 md:px-0">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
              }
              disabled={isSubmitting}
              className="border-forest/30 text-forest hover:bg-petal hover:border-forest/50 transition-colors duration-150"
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
              className="bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200 px-6 py-2.5 text-sm font-medium"
              size="lg"
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

      {/* ── Follow-up scheduling prompt ────────────────────────────── */}
      <Dialog
        open={showFollowUpPrompt}
        onOpenChange={(open) => {
          if (!open) {
            setShowFollowUpPrompt(false)
            router.push(`/pacientes/${patientId}?tab=procedimentos`)
            router.refresh()
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-forest">
              Agendar retorno?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-mid">
            Deseja agendar o retorno para{' '}
            <span className="font-medium text-forest">
              {followUpDate
                ? format(new Date(followUpDate + 'T12:00:00'), "dd/MM/yyyy", {
                    locale: ptBR,
                  })
                : ''}
            </span>
            ?
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="border-forest text-forest hover:bg-petal"
              onClick={() => {
                setShowFollowUpPrompt(false)
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
                router.refresh()
              }}
            >
              Pular
            </Button>
            <Button
              className="bg-forest text-cream hover:bg-sage"
              onClick={async () => {
                setShowFollowUpPrompt(false)
                // Load practitioners and procedure types for appointment form
                const [practitioners, procTypes] = await Promise.all([
                  listPractitionersAction(),
                  listProcedureTypesForSelectAction(),
                ])
                setAppointmentPractitioners(practitioners)
                setAppointmentProcedureTypes(procTypes)
                setShowAppointmentForm(true)
              }}
            >
              <CalendarPlus className="mr-2 size-4" />
              Agendar retorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Appointment form for follow-up scheduling ──────────────── */}
      <AppointmentForm
        open={showAppointmentForm}
        onOpenChange={(open) => {
          setShowAppointmentForm(open)
          if (!open) {
            router.push(`/pacientes/${patientId}?tab=procedimentos`)
            router.refresh()
          }
        }}
        practitioners={appointmentPractitioners}
        procedureTypes={appointmentProcedureTypes}
        defaultDate={followUpDate}
      />
    </div>
  )
}

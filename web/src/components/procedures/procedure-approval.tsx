'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  FileText,
  Loader2,
  ShieldCheck,
  ClipboardCheck,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import { ConsentViewer } from '@/components/consent/consent-viewer'
import { SignaturePad } from '@/components/consent/signature-pad'
import { useApproveProcedure } from '@/hooks/mutations/use-procedure-mutations'
import { useAcceptConsent } from '@/hooks/mutations/use-consent-mutations'
import {
  interpolateContract,
  buildContractData,
} from '@/lib/contract-interpolation'
import { cn } from '@/lib/utils'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { DiagramPointData } from '@/components/face-diagram/types'
import type { PaymentMethod } from '@/types'
import type { WizardOverrides } from '@/components/service-wizard/types'

// ─── Consent type mapping from procedure category ──────────────────

const CATEGORY_TO_CONSENT: Record<string, string> = {
  toxina_botulinica: 'botox',
  botox: 'botox',
  preenchimento: 'filler',
  filler: 'filler',
  bioestimulador: 'biostimulator',
  biostimulator: 'biostimulator',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência Bancária',
}

// ─── Types ──────────────────────────────────────────────────────────

interface ConsentStatus {
  type: string
  label: string
  signed: boolean
  loading: boolean
}

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface ProcedureType {
  id: string
  name: string
  category: string
}

interface PatientData {
  id: string
  fullName: string
  cpf?: string | null
  gender?: string | null
}

interface TenantData {
  id: string
  name: string
}

interface FinancialPlan {
  totalAmount: number
  installmentCount: number
  paymentMethod?: PaymentMethod
  notes?: string
}

interface ProcedureApprovalProps {
  procedure: ProcedureWithDetails
  diagrams: DiagramWithPoints[]
  patient: PatientData
  tenant: TenantData
  additionalTypeIds: string[]
  wizardOverrides?: WizardOverrides
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function diagramsToPoints(diagrams: DiagramWithPoints[]): DiagramPointData[] {
  const points: DiagramPointData[] = []
  for (const diagram of diagrams) {
    for (const p of diagram.points) {
      points.push({
        id: p.id,
        x: parseFloat(p.x),
        y: parseFloat(p.y),
        productName: p.productName,
        activeIngredient: p.activeIngredient ?? undefined,
        quantity: parseFloat(p.quantity),
        quantityUnit: p.quantityUnit as DiagramPointData['quantityUnit'],
        technique: p.technique ?? undefined,
        depth: p.depth ?? undefined,
        notes: p.notes ?? undefined,
      })
    }
  }
  return points
}

function computeProductTotals(points: DiagramPointData[]) {
  const totals = new Map<string, { quantity: number; unit: string }>()
  for (const p of points) {
    const key = p.productName
    const existing = totals.get(key)
    if (existing) {
      existing.quantity += p.quantity
    } else {
      totals.set(key, { quantity: p.quantity, unit: p.quantityUnit })
    }
  }
  return Array.from(totals.entries()).map(([name, { quantity, unit }]) => ({
    name,
    quantity,
    unit,
  }))
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureApproval({
  procedure,
  diagrams,
  patient,
  tenant,
  additionalTypeIds,
  wizardOverrides,
}: ProcedureApprovalProps) {
  const router = useRouter()
  const approveProcedure = useApproveProcedure()
  const acceptConsent = useAcceptConsent()

  // ─── State ────────────────────────────────────────────────────────
  const [procedureTypes, setProcedureTypes] = useState<ProcedureType[]>([])
  const [consentStatuses, setConsentStatuses] = useState<ConsentStatus[]>([])
  const [activeConsentType, setActiveConsentType] = useState<string | null>(null)
  const [activeConsentTemplate, setActiveConsentTemplate] = useState<ConsentTemplate | null>(null)
  const [loadingConsentTemplate, setLoadingConsentTemplate] = useState(false)

  // Service contract state
  const [contractTemplate, setContractTemplate] = useState<ConsentTemplate | null>(null)
  const [contractText, setContractText] = useState<string>('')
  const [contractChecked, setContractChecked] = useState(false)
  const [contractSignature, setContractSignature] = useState<string | null>(null)
  const [contractSigned, setContractSigned] = useState(false)
  const [contractSigning, setContractSigning] = useState(false)
  const [contractError, setContractError] = useState<string | null>(null)
  const [loadingContract, setLoadingContract] = useState(true)

  // Approve state
  const [isApproving, setIsApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)

  // ─── Derived data ─────────────────────────────────────────────────
  const financialPlan = procedure.financialPlan as FinancialPlan | null

  const diagramPoints = useMemo(() => diagramsToPoints(diagrams), [diagrams])
  const productTotals = useMemo(() => computeProductTotals(diagramPoints), [diagramPoints])

  // All procedure type IDs (primary + additional)
  const allTypeIds = useMemo(() => {
    const ids = [procedure.procedureTypeId]
    if (additionalTypeIds?.length) {
      ids.push(...additionalTypeIds)
    }
    return ids
  }, [procedure.procedureTypeId, additionalTypeIds])

  // Selected procedure types with details
  const selectedTypes = useMemo(() => {
    return procedureTypes.filter((t) => allTypeIds.includes(t.id))
  }, [procedureTypes, allTypeIds])

  // Required consent types (deduplicated)
  const requiredConsentTypes = useMemo(() => {
    const types = new Set<string>()
    // Always require general consent
    types.add('general')
    for (const pt of selectedTypes) {
      const consentType = CATEGORY_TO_CONSENT[pt.category.toLowerCase()]
      if (consentType) {
        types.add(consentType)
      }
    }
    return Array.from(types)
  }, [selectedTypes])

  // Check if all consents are signed
  const allConsentsSigned = useMemo(() => {
    if (consentStatuses.length === 0) return false
    return consentStatuses.every((c) => c.signed)
  }, [consentStatuses])

  // Can approve = all consents + contract signed
  const canApprove = allConsentsSigned && contractSigned

  // ─── Single initialization: load all data at once ──────────────────
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    async function initAll() {
      // 1. Load procedure types
      const typesRes = await fetch('/api/procedure-types')
      const allProcTypes: ProcedureType[] = typesRes.ok ? await typesRes.json() : []
      setProcedureTypes(allProcTypes)

      // 2. Determine selected types and required consents
      const selected = allProcTypes.filter((t) => allTypeIds.includes(t.id))
      const consentTypes = new Set<string>(['general'])
      for (const pt of selected) {
        const ct = CATEGORY_TO_CONSENT[pt.category.toLowerCase()]
        if (ct) consentTypes.add(ct)
      }
      const requiredTypes = Array.from(consentTypes)

      // 3. Load everything in parallel: consent statuses + contract template + contract status
      const [consentResults, contractTplRes, contractHistRes] = await Promise.all([
        // Check each consent type
        Promise.all(
          requiredTypes.map(async (type) => {
            const checkRes = await fetch(`/api/consent/history/${patient.id}?procedureId=${procedure.id}&type=${type}`)
            const result = checkRes.ok ? await checkRes.json() : { data: null }
            return {
              type,
              label: CONSENT_TYPE_LABELS[type] ?? type,
              signed: !!result.data,
              loading: false,
            } as ConsentStatus
          })
        ),
        // Load contract template
        fetch('/api/consent/templates?type=service_contract&active=true').catch(() => null),
        // Check if contract already signed
        fetch(`/api/consent/history/${patient.id}?procedureId=${procedure.id}&type=service_contract`).catch(() => null),
      ])

      // 4. Apply all state at once
      setConsentStatuses(consentResults)

      const contractTpl = contractTplRes?.ok ? await contractTplRes.json() : null
      if (contractTpl) {
        setContractTemplate(contractTpl as unknown as ConsentTemplate)

        const procedures = selected.map((t) => ({ name: t.name }))
        const products = productTotals.map((p) => ({
          name: p.name,
          quantity: p.quantity,
          unit: p.unit,
        }))

        if (financialPlan) {
          const contractData = buildContractData(
            procedures,
            products,
            financialPlan,
            { fullName: patient.fullName, cpf: patient.cpf },
            procedure.practitionerName,
            tenant.name
          )
          setContractText(interpolateContract(contractTpl.content, contractData))
        } else {
          setContractText(contractTpl.content)
        }
      }

      const contractHist = contractHistRes?.ok ? await contractHistRes.json() : { data: null }
      if (contractHist.data) {
        setContractSigned(true)
      }

      setLoadingContract(false)
    }

    initAll()
  }, [allTypeIds, patient, procedure, tenant.name, financialPlan, productTotals])

  // ─── Refresh consent statuses (after signing a new one) ───────────
  const refreshConsentStatuses = useCallback(async () => {
    const updated = await Promise.all(
      consentStatuses.map(async (s) => {
        const checkRes = await fetch(`/api/consent/history/${patient.id}?procedureId=${procedure.id}&type=${s.type}`)
        const result = checkRes.ok ? await checkRes.json() : { data: null }
        return { ...s, signed: !!result.data, loading: false }
      })
    )
    setConsentStatuses(updated)
  }, [consentStatuses, patient.id, procedure.id])

  // ─── Open consent for signing ─────────────────────────────────────
  const handleOpenConsent = useCallback(async (type: string) => {
    setActiveConsentType(type)
    setLoadingConsentTemplate(true)
    try {
      const tplRes = await fetch(`/api/consent/templates?type=${type}&active=true`)
      if (tplRes.ok) {
        const template = await tplRes.json()
        if (template) setActiveConsentTemplate(template as unknown as ConsentTemplate)
      }
    } catch {
      // ignore
    } finally {
      setLoadingConsentTemplate(false)
    }
  }, [])

  const handleConsentAccepted = useCallback(() => {
    setActiveConsentType(null)
    setActiveConsentTemplate(null)
    refreshConsentStatuses()
  }, [refreshConsentStatuses])

  // ─── Sign service contract ────────────────────────────────────────
  const handleSignContract = useCallback(async () => {
    if (!contractTemplate || !contractChecked || !contractSignature) return

    setContractSigning(true)
    setContractError(null)
    try {
      await acceptConsent.mutateAsync({
        patientId: patient.id,
        consentTemplateId: contractTemplate.id,
        procedureRecordId: procedure.id,
        acceptanceMethod: 'both',
        signatureData: contractSignature,
        renderedContent: contractText,
      })
      setContractSigned(true)
    } catch (err) {
      setContractError(err instanceof Error ? err.message : 'Erro inesperado ao assinar contrato')
    } finally {
      setContractSigning(false)
    }
  }, [contractTemplate, contractChecked, contractSignature, patient.id, procedure.id])

  // ─── Approve procedure ────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!canApprove || isApproving) return

    setIsApproving(true)
    setApproveError(null)
    try {
      await approveProcedure.mutateAsync(procedure.id)
      setApproved(true)
      if (!wizardOverrides?.hideNavigation) {
        setTimeout(() => {
          router.push(`/pacientes/${patient.id}?tab=procedimentos`)
        }, 1500)
      }
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Erro ao aprovar procedimento')
    } finally {
      setIsApproving(false)
    }
  }, [canApprove, isApproving, procedure.id, patient.id, router, wizardOverrides?.hideNavigation])

  // ─── Wizard triggerSave: call approveProcedureAction ──────────────
  const prevTriggerSaveRef = useRef(wizardOverrides?.triggerSave ?? 0)
  
  useEffect(() => {
    const current = wizardOverrides?.triggerSave ?? 0
    if (current === 0 || current === prevTriggerSaveRef.current) return
    prevTriggerSaveRef.current = current
    async function doSave() {
      if (!canApprove) {
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: 'Assine todos os termos e o contrato de serviço para aprovar',
          errorType: 'precondition',
        })
        return
      }

      if (isApproving) return

      setIsApproving(true)
      setApproveError(null)
      try {
        await approveProcedure.mutateAsync(procedure.id)
        setApproved(true)
        wizardOverrides?.onSaveComplete?.({
          success: true,
          procedureId: procedure.id,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao aprovar procedimento'
        setApproveError(msg)
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: msg,
          errorType: 'server',
        })
      } finally {
        setIsApproving(false)
      }
    }
    doSave()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOverrides?.triggerSave])

  // ─── Render ───────────────────────────────────────────────────────

  if (approved && !wizardOverrides) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] max-w-md w-full">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <div className="flex size-16 items-center justify-center rounded-full bg-mint/20 text-sage">
              <CheckCircle2 className="size-8" />
            </div>
            <h2 className="text-lg font-medium text-charcoal">
              Procedimento aprovado com sucesso
            </h2>
            <p className="text-sm text-mid text-center">
              Redirecionando para a ficha do paciente...
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      {!wizardOverrides?.hideTitle && (
        <>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="text-mid hover:text-charcoal"
            >
              <ArrowLeft className="size-4 mr-1" />
              Voltar
            </Button>
          </div>

          <div>
            <h1 className="font-display text-2xl text-forest">
              Aprovar Procedimento
            </h1>
            <p className="text-sm text-mid mt-1">
              Revise o plano, assine os termos e aprove para prosseguir.
            </p>
          </div>
        </>
      )}

      {/* 1. Plan Summary */}
      <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
              <ClipboardCheck className="size-4 text-forest" />
            </div>
            <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
              Resumo do Planejamento
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          {/* Procedure types */}
          <div>
            <p className="text-xs uppercase tracking-wider text-mid mb-2">
              Procedimentos
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedTypes.length > 0 ? (
                selectedTypes.map((t) => (
                  <Badge
                    key={t.id}
                    variant="outline"
                    className="border-sage/30 bg-sage/5 text-sage text-xs"
                  >
                    {t.name}
                  </Badge>
                ))
              ) : (
                <Badge
                  variant="outline"
                  className="border-sage/30 bg-sage/5 text-sage text-xs"
                >
                  {procedure.procedureTypeName}
                </Badge>
              )}
            </div>
          </div>

          {/* Face diagram (read-only) */}
          {diagramPoints.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-mid mb-2">
                Diagrama Facial
              </p>
              <FaceDiagramEditor
                points={diagramPoints}
                onChange={() => {}}
                readOnly
                gender={patient.gender}
              />
            </div>
          )}

          {/* Product totals */}
          {productTotals.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-mid mb-2">
                Produtos Planejados
              </p>
              <div className="space-y-1.5">
                {productTotals.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between rounded-[3px] border border-[#E8ECEF] px-3 py-2"
                  >
                    <span className="text-sm text-charcoal">{p.name}</span>
                    <span className="text-sm font-medium text-forest">
                      {p.quantity} {p.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Financial summary */}
          {financialPlan && (
            <div>
              <p className="text-xs uppercase tracking-wider text-mid mb-2">
                Resumo Financeiro
              </p>
              <div className="rounded-[3px] border border-[#E8ECEF] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-mid">Valor total</span>
                  <span className="text-sm font-semibold text-charcoal">
                    {formatCurrency(financialPlan.totalAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-mid">Parcelas</span>
                  <span className="text-sm text-charcoal">
                    {financialPlan.installmentCount === 1
                      ? 'À vista'
                      : `${financialPlan.installmentCount}x de ${formatCurrency(
                          financialPlan.totalAmount / financialPlan.installmentCount
                        )}`}
                  </span>
                </div>
                {financialPlan.paymentMethod && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-mid">Forma de pagamento</span>
                    <span className="text-sm text-charcoal">
                      {PAYMENT_METHOD_LABELS[financialPlan.paymentMethod] ??
                        financialPlan.paymentMethod}
                    </span>
                  </div>
                )}
                {financialPlan.notes && (
                  <div className="pt-1 border-t border-[#E8ECEF]">
                    <span className="text-xs text-mid">{financialPlan.notes}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Consent Signing Section */}
      <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
              <ShieldCheck className="size-4 text-forest" />
            </div>
            <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
              Termos de Consentimento
            </span>
            {allConsentsSigned && (
              <Badge className="bg-mint/20 text-sage text-xs border-0 ml-auto">
                Todos assinados
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {consentStatuses.length === 0 && (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="size-4 animate-spin text-mid" />
              <span className="text-sm text-mid">Verificando termos...</span>
            </div>
          )}

          {consentStatuses.map((consent) => (
            <div key={consent.type}>
              <div
                className={cn(
                  'flex items-center justify-between rounded-[3px] border px-4 py-3 transition-colors',
                  consent.signed
                    ? 'border-sage/30 bg-[#F0F7F1]'
                    : 'border-[#E8ECEF] bg-white'
                )}
              >
                <div className="flex items-center gap-3">
                  {consent.loading ? (
                    <Loader2 className="size-4 animate-spin text-mid" />
                  ) : consent.signed ? (
                    <CheckCircle2 className="size-5 text-sage" />
                  ) : (
                    <div className="size-5 rounded border-2 border-[#E8ECEF]" />
                  )}
                  <span className="text-sm text-charcoal">{consent.label}</span>
                </div>

                {!consent.signed && !consent.loading && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenConsent(consent.type)}
                    className="border-forest/30 text-forest hover:bg-petal text-xs"
                  >
                    Assinar
                  </Button>
                )}

                {consent.signed && (
                  <span className="text-xs text-sage font-medium">Assinado</span>
                )}
              </div>

              {/* Inline consent viewer */}
              {activeConsentType === consent.type && (
                <div className="mt-3">
                  {loadingConsentTemplate ? (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <Loader2 className="size-4 animate-spin text-mid" />
                      <span className="text-sm text-mid">Carregando termo...</span>
                    </div>
                  ) : activeConsentTemplate ? (
                    <ConsentViewer
                      template={activeConsentTemplate}
                      patientId={patient.id}
                      procedureRecordId={procedure.id}
                      requireSignature
                      onAccepted={handleConsentAccepted}
                    />
                  ) : (
                    <div className="rounded-[3px] border border-amber/30 bg-[#FFF4EF] p-4">
                      <p className="text-sm text-amber-dark">
                        Modelo de termo não encontrado. Configure o termo nas configurações.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 3. Service Contract Section */}
      <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
              <FileText className="size-4 text-forest" />
            </div>
            <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
              Contrato de Serviço
            </span>
            {contractSigned && (
              <Badge className="bg-mint/20 text-sage text-xs border-0 ml-auto">
                Assinado
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {loadingContract ? (
            <div className="flex items-center gap-2 py-6 justify-center">
              <Loader2 className="size-4 animate-spin text-mid" />
              <span className="text-sm text-mid">Carregando contrato...</span>
            </div>
          ) : !contractTemplate ? (
            <div className="rounded-[3px] border border-amber/30 bg-[#FFF4EF] p-4">
              <p className="text-sm text-amber-dark">
                Modelo de contrato de serviço não encontrado. Configure o contrato nas configurações.
              </p>
            </div>
          ) : contractSigned ? (
            <div className="flex items-center gap-3 rounded-[3px] border border-sage/30 bg-[#F0F7F1] px-4 py-4">
              <CheckCircle2 className="size-5 text-sage" />
              <span className="text-sm text-charcoal">
                Contrato de serviço assinado com sucesso
              </span>
            </div>
          ) : (
            <>
              {/* Rendered contract text */}
              <ScrollArea className="h-72 rounded-[3px] border border-[#E8ECEF] bg-white p-5">
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                  {contractText}
                </div>
              </ScrollArea>

              {/* Checkbox acceptance */}
              <label className="flex cursor-pointer items-start gap-3 rounded-[3px] border border-[#E8ECEF] p-4 transition-colors duration-150 hover:bg-[#F4F6F8] hover:border-sage/30">
                <Checkbox
                  checked={contractChecked}
                  onCheckedChange={(val) => setContractChecked(val === true)}
                  disabled={contractSigning}
                  className="mt-0.5 border-sage data-[state=checked]:bg-forest data-[state=checked]:border-forest"
                />
                <span className="text-sm font-medium leading-snug text-charcoal">
                  Li e concordo com os termos do contrato de prestação de serviços
                </span>
              </label>

              {/* Signature pad */}
              {contractChecked && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-charcoal">
                    Assinatura do paciente (obrigatória)
                  </p>
                  <SignaturePad
                    onSignatureChange={setContractSignature}
                    disabled={contractSigning}
                  />
                </div>
              )}

              {/* Error */}
              {contractError && (
                <p className="text-sm text-red-600">{contractError}</p>
              )}

              {/* Sign contract button */}
              <Button
                onClick={handleSignContract}
                disabled={!contractChecked || !contractSignature || contractSigning}
                className="w-full bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200"
                size="lg"
              >
                {contractSigning ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Assinando...
                  </>
                ) : (
                  'Assinar Contrato'
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* 4. Approve Button */}
      {!wizardOverrides?.hideSaveButton && (
        <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
          <CardContent className="py-6">
            {approveError && (
              <div className="rounded-[3px] border border-red-200 bg-red-50 px-4 py-3 mb-4">
                <p className="text-sm text-red-700">{approveError}</p>
              </div>
            )}

            <div className="space-y-3">
              {/* Status summary */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {allConsentsSigned ? (
                    <CheckCircle2 className="size-4 text-sage" />
                  ) : (
                    <div className="size-4 rounded-full border-2 border-[#E8ECEF]" />
                  )}
                  <span
                    className={cn(
                      'text-sm',
                      allConsentsSigned ? 'text-sage font-medium' : 'text-mid'
                    )}
                  >
                    Todos os termos de consentimento assinados
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {contractSigned ? (
                    <CheckCircle2 className="size-4 text-sage" />
                  ) : (
                    <div className="size-4 rounded-full border-2 border-[#E8ECEF]" />
                  )}
                  <span
                    className={cn(
                      'text-sm',
                      contractSigned ? 'text-sage font-medium' : 'text-mid'
                    )}
                  >
                    Contrato de serviço assinado
                  </span>
                </div>
              </div>

              <Button
                onClick={handleApprove}
                disabled={!canApprove || isApproving}
                className="w-full bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50"
                size="lg"
              >
                {isApproving ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Aprovando...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4 mr-2" />
                    Aprovar Procedimento
                  </>
                )}
              </Button>

              {!canApprove && (
                <p className="text-xs text-mid text-center">
                  Assine todos os termos e o contrato de serviço para aprovar
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

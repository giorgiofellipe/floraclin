'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAcceptConsent } from '@/hooks/mutations/use-consent-mutations'
import {
  interpolateContract,
  buildContractData,
} from '@/lib/contract-interpolation'
import { cn, formatCurrency } from '@/lib/utils'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'
import {
  type EncounterCart,
  computeCartTotal,
} from '@/validations/encounter-cart'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { DiagramPointData } from '@/components/face-diagram/types'
import type { PaymentMethod } from '@/types'
import type { WizardOverrides } from '@/components/service-wizard/types'
import { ApprovalSummaryCard } from './approval/approval-summary-card'
import { WizardCart } from '@/components/service-wizard/wizard-cart'
import { ConsentStatusList } from './approval/consent-status-list'
import { ServiceContractSection } from './approval/service-contract-section'
import { SendConsentSigningLink } from './approval/send-consent-signing-link'
import { ClipboardCheck } from 'lucide-react'

const CATEGORY_TO_CONSENT: Record<string, string> = {
  toxina_botulinica: 'botox',
  botox: 'botox',
  preenchimento: 'filler',
  filler: 'filler',
  bioestimulador: 'biostimulator',
  biostimulator: 'biostimulator',
}

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
  phone?: string | null
}

interface TenantData {
  id: string
  name: string
  whatsappApiEnabled?: boolean
}

interface FinancialPlan {
  totalAmount: number
  installmentCount: number
  paymentMethod?: PaymentMethod
  notes?: string
}

interface ProcedureApprovalProps {
  // Legacy single-procedure props (still supported during transition).
  procedure?: ProcedureWithDetails
  diagrams?: DiagramWithPoints[]
  additionalTypeIds?: string[]
  // Multi-line cart props (F5).
  cart?: EncounterCart
  /** One per cart line, same order. Required when `cart` is supplied. */
  draftRecordIds?: string[]
  /** The wizard-generated encounter id used in the finalize URL. */
  encounterId?: string | null
  practitionerId?: string
  /** Notified once the finalize call succeeds (cart-mode primary callback). */
  onApproved?: (result: {
    procedureRecordIds: string[]
    patientPackageId: string | null
    encounterId: string
  }) => void
  /**
   * Cart-mode editing handler. Step 4 owns final adjustments to sessions
   * count and total override (step 2 renders a read-only preview). When
   * supplied, the summary card mounts the editable WizardCart.
   */
  onCartChange?: (next: EncounterCart) => void
  // Shared props.
  patient: PatientData
  tenant: TenantData
  wizardOverrides?: WizardOverrides
}

function diagramsToPoints(diagrams: DiagramWithPoints[]): DiagramPointData[] {
  return diagrams.flatMap((diagram) =>
    diagram.points.map((p) => ({
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
    })),
  )
}

function computeProductTotals(points: DiagramPointData[]) {
  const totals = new Map<string, { quantity: number; unit: string }>()
  for (const p of points) {
    const existing = totals.get(p.productName)
    if (existing) existing.quantity += p.quantity
    else totals.set(p.productName, { quantity: p.quantity, unit: p.quantityUnit })
  }
  return Array.from(totals.entries()).map(([name, { quantity, unit }]) => ({ name, quantity, unit }))
}

export function ProcedureApproval({
  procedure,
  diagrams,
  patient,
  tenant,
  additionalTypeIds,
  cart,
  draftRecordIds,
  encounterId,
  practitionerId,
  onApproved,
  onCartChange,
  wizardOverrides,
}: ProcedureApprovalProps) {
  const router = useRouter()
  const acceptConsent = useAcceptConsent()

  // ── Mode discrimination ───────────────────────────────────────────
  // Cart mode: F5 multi-line flow. We POST to /finalize with cart + drafts.
  // Legacy mode: single procedure record. The legacy `/api/procedures/[id]/approve`
  // route was deleted by D1, so we synthesize a one-line cart and ALSO route
  // through /finalize. This keeps a working legacy entry point until callers
  // migrate to passing `cart` directly.
  const isCartMode = !!cart && !!draftRecordIds && draftRecordIds.length > 0

  if (!isCartMode && !procedure) {
    throw new Error(
      'ProcedureApproval requires either `cart` + `draftRecordIds` (cart mode) or `procedure` (legacy mode).',
    )
  }

  // The "primary" draft record id — the one consent acceptances are recorded
  // against during inline signing (ConsentViewer / contract). In cart mode
  // this is the first draftRecordId; in legacy mode it's `procedure.id`.
  const primaryRecordId = isCartMode
    ? (draftRecordIds as string[])[0]
    : (procedure as ProcedureWithDetails).id

  // Stable encounterId for the finalize URL. The server generates its own
  // canonical id inside the transaction; the URL id is only validated as UUID.
  // For legacy approvals (which never had an encounterId) we mint one here.
  const finalizeEncounterIdRef = useRef<string>(
    encounterId ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : ''),
  )
  useEffect(() => {
    if (encounterId && finalizeEncounterIdRef.current !== encounterId) {
      finalizeEncounterIdRef.current = encounterId
    }
  }, [encounterId])

  const [procedureTypes, setProcedureTypes] = useState<ProcedureType[]>([])
  const [consentStatuses, setConsentStatuses] = useState<ConsentStatus[]>([])
  const [activeConsentType, setActiveConsentType] = useState<string | null>(null)
  const [activeConsentTemplate, setActiveConsentTemplate] = useState<ConsentTemplate | null>(null)
  const [loadingConsentTemplate, setLoadingConsentTemplate] = useState(false)

  const [contractTemplate, setContractTemplate] = useState<ConsentTemplate | null>(null)
  const [contractText, setContractText] = useState<string>('')
  const [contractChecked, setContractChecked] = useState(false)
  const [contractSignature, setContractSignature] = useState<string | null>(null)
  const [contractSigned, setContractSigned] = useState(false)
  const [contractSigning, setContractSigning] = useState(false)
  const [contractError, setContractError] = useState<string | null>(null)
  const [loadingContract, setLoadingContract] = useState(true)

  const [isApproving, setIsApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)

  // Explicit dirty tracking — approval is not a form, so we manage this manually.
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const markDirty = useCallback(() => setHasUnsavedChanges(true), [])
  const markClean = useCallback(() => setHasUnsavedChanges(false), [])

  // Financial plan source: cart mode derives from cart total; legacy mode reads
  // from procedure.financialPlan. Both are surfaced via the `financialPlan`
  // memo for the summary card + contract interpolation.
  const legacyFinancialPlan = (procedure?.financialPlan ?? null) as FinancialPlan | null
  const cartTotal = useMemo(() => (cart ? computeCartTotal(cart) : 0), [cart])

  const financialPlan: FinancialPlan | null = useMemo(() => {
    if (isCartMode && cart) {
      // Default the cart-driven plan to a single instalment until the planner
      // owns this state. The planner UI lives below and could be wired here in
      // a follow-up — F5 keeps the surface narrow.
      return {
        totalAmount: cartTotal,
        installmentCount: legacyFinancialPlan?.installmentCount ?? 1,
        paymentMethod: legacyFinancialPlan?.paymentMethod,
        notes: legacyFinancialPlan?.notes,
      }
    }
    return legacyFinancialPlan
  }, [isCartMode, cart, cartTotal, legacyFinancialPlan])

  const diagramPoints = useMemo(() => diagramsToPoints(diagrams ?? []), [diagrams])
  const productTotals = useMemo(() => computeProductTotals(diagramPoints), [diagramPoints])

  // Procedure-type ids to load consent requirements for. In cart mode this is
  // the union of all cart-line procedureTypeIds; in legacy mode it's the
  // primary type + additionalTypeIds.
  const allTypeIds = useMemo(() => {
    if (isCartMode && cart) {
      const ids = cart.lines.map((l) => l.procedureTypeId)
      return Array.from(new Set(ids))
    }
    const ids = procedure ? [procedure.procedureTypeId] : []
    if (additionalTypeIds?.length) ids.push(...additionalTypeIds)
    return ids
  }, [isCartMode, cart, procedure, additionalTypeIds])

  const selectedTypes = useMemo(
    () => procedureTypes.filter((t) => allTypeIds.includes(t.id)),
    [procedureTypes, allTypeIds],
  )

  const allConsentsSigned = useMemo(() => {
    if (consentStatuses.length === 0) return false
    return consentStatuses.every((c) => c.signed)
  }, [consentStatuses])

  const canApprove = allConsentsSigned && contractSigned

  const allUnsignedTypes = useMemo(() => {
    const unsigned = consentStatuses
      .filter((c) => !c.signed && !c.loading)
      .map((c) => c.type)
    if (!contractSigned && contractTemplate) unsigned.push('service_contract')
    return unsigned
  }, [consentStatuses, contractSigned, contractTemplate])

  const signingRenderedContents = useMemo(() => {
    if (!contractText || contractSigned) return undefined
    return { service_contract: contractText }
  }, [contractText, contractSigned])

  const loadedTypeIdsRef = useRef<string>('')

  useEffect(() => {
    const key = allTypeIds.slice().sort().join(',')
    if (key === loadedTypeIdsRef.current) return
    loadedTypeIdsRef.current = key

    async function initAll() {
      const typesRes = await fetch('/api/procedure-types')
      const allProcTypes: ProcedureType[] = typesRes.ok ? await typesRes.json() : []
      setProcedureTypes(allProcTypes)

      const selected = allProcTypes.filter((t) => allTypeIds.includes(t.id))
      const consentTypes = new Set<string>(['general'])
      for (const pt of selected) {
        const ct = CATEGORY_TO_CONSENT[pt.category.toLowerCase()]
        if (ct) consentTypes.add(ct)
      }
      const requiredTypes = Array.from(consentTypes)

      const [consentResults, contractTplRes, contractHistRes] = await Promise.all([
        Promise.all(
          requiredTypes.map(async (type) => {
            const checkRes = await fetch(
              `/api/consent/history/${patient.id}?procedureId=${primaryRecordId}&type=${type}`,
            )
            const result = checkRes.ok ? await checkRes.json() : { data: null }
            return {
              type,
              label: CONSENT_TYPE_LABELS[type] ?? type,
              signed: !!result.data,
              loading: false,
            } as ConsentStatus
          }),
        ),
        fetch('/api/consent/templates?type=service_contract&active=true').catch(() => null),
        fetch(
          `/api/consent/history/${patient.id}?procedureId=${primaryRecordId}&type=service_contract`,
        ).catch(() => null),
      ])

      setConsentStatuses(consentResults)

      const contractTpl = contractTplRes?.ok ? await contractTplRes.json() : null
      if (contractTpl) {
        setContractTemplate(contractTpl as unknown as ConsentTemplate)
        if (financialPlan) {
          // Procedure list for the contract: prefer cart lines (with sessions)
          // when in cart mode; fall back to selected types in legacy mode.
          const procedureItems = isCartMode && cart
            ? cart.lines.map((l) => ({ name: `${l.procedureTypeName} (${l.sessions}× sessões)` }))
            : selected.map((t) => ({ name: t.name }))

          const practitionerName = procedure?.practitionerName ?? ''

          const contractData = buildContractData(
            procedureItems,
            productTotals.map((p) => ({ name: p.name, quantity: p.quantity, unit: p.unit })),
            financialPlan,
            { fullName: patient.fullName, cpf: patient.cpf },
            practitionerName,
            tenant.name,
          )
          setContractText(interpolateContract(contractTpl.content, contractData))
        } else {
          setContractText(contractTpl.content)
        }
      }

      const contractHist = contractHistRes?.ok ? await contractHistRes.json() : { data: null }
      if (contractHist.data) setContractSigned(true)
      setLoadingContract(false)
    }

    initAll()
  }, [allTypeIds, patient, primaryRecordId, tenant.name, financialPlan, productTotals, isCartMode, cart, procedure])

  // Propagate unsaved-changes state to the wizard.
  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(hasUnsavedChanges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges])

  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshConsentStatuses = useCallback(async () => {
    const [updated, contractHistRes] = await Promise.all([
      Promise.all(
        consentStatuses.map(async (s) => {
          const checkRes = await fetch(
            `/api/consent/history/${patient.id}?procedureId=${primaryRecordId}&type=${s.type}`,
          )
          const result = checkRes.ok ? await checkRes.json() : { data: null }
          return { ...s, signed: !!result.data, loading: false }
        }),
      ),
      fetch(
        `/api/consent/history/${patient.id}?procedureId=${primaryRecordId}&type=service_contract`,
      ).catch(() => null),
    ])
    setConsentStatuses(updated)
    const contractHist = contractHistRes?.ok
      ? await contractHistRes.json()
      : { data: null }
    if (contractHist.data) setContractSigned(true)
  }, [consentStatuses, patient.id, primaryRecordId])

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await refreshConsentStatuses()
    setIsRefreshing(false)
  }, [refreshConsentStatuses])

  // Poll every 15s while there are unsigned items
  useEffect(() => {
    if (allUnsignedTypes.length === 0) return
    const id = setInterval(() => { refreshConsentStatuses() }, 15_000)
    return () => clearInterval(id)
  }, [allUnsignedTypes.length, refreshConsentStatuses])

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

  const handleContractCheckedChange = useCallback((checked: boolean) => {
    setContractChecked(checked)
    markDirty()
  }, [markDirty])

  const handleContractSignatureChange = useCallback((data: string | null) => {
    setContractSignature(data)
    if (data) markDirty()
  }, [markDirty])

  const handleSignContract = useCallback(async () => {
    if (!contractTemplate || !contractChecked || !contractSignature) return

    setContractSigning(true)
    setContractError(null)
    try {
      await acceptConsent.mutateAsync({
        patientId: patient.id,
        consentTemplateId: contractTemplate.id,
        procedureRecordId: primaryRecordId,
        acceptanceMethod: 'both',
        signatureData: contractSignature,
        renderedContent: contractText,
      })
      setContractSigned(true)
      markClean()
    } catch (err) {
      setContractError(err instanceof Error ? err.message : 'Erro inesperado ao assinar contrato')
    } finally {
      setContractSigning(false)
    }
  }, [contractTemplate, contractChecked, contractSignature, patient.id, primaryRecordId, contractText, acceptConsent, markClean])

  // ── Approve action ────────────────────────────────────────────────
  // Always POST to /api/encounters/{id}/finalize. In legacy mode we
  // synthesize a one-line cart from `procedure`.
  const runApprove = useCallback(async (origin: 'button' | 'wizard') => {
    if (isApproving) return
    if (!canApprove) {
      if (origin === 'wizard') {
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: 'Assine todos os termos e o contrato de serviço para aprovar',
          errorType: 'precondition',
        })
      }
      return
    }

    setIsApproving(true)
    setApproveError(null)

    try {
      // Build the finalize payload — synthesize a cart for legacy mode.
      let finalizeCart: EncounterCart
      let finalizeDraftIds: string[]

      if (isCartMode && cart && draftRecordIds) {
        finalizeCart = cart
        finalizeDraftIds = draftRecordIds
      } else if (procedure) {
        const legacyTotal = Number(legacyFinancialPlan?.totalAmount ?? 0)
        finalizeCart = {
          templateId: null,
          templateName: null,
          templateDefaultPrice: null,
          templateValidityMonths: null,
          lines: [
            {
              procedureTypeId: procedure.procedureTypeId,
              procedureTypeName: procedure.procedureTypeName,
              sessions: 1,
              defaultPrice: legacyTotal,
              sourceTemplateLineId: null,
            },
          ],
          totalOverride: null,
        }
        finalizeDraftIds = [procedure.id]
      } else {
        throw new Error('No cart or procedure available to finalize')
      }

      const totalAmount =
        financialPlan?.totalAmount ?? computeCartTotal(finalizeCart)

      const payload = {
        cart: finalizeCart,
        draftRecordIds: finalizeDraftIds,
        patientId: patient.id,
        practitionerId: practitionerId ?? procedure?.practitionerId ?? '',
        financialPlan: {
          totalAmount: String(totalAmount),
          installmentCount: financialPlan?.installmentCount ?? 1,
          paymentMethod: financialPlan?.paymentMethod ?? 'pix',
          notes: financialPlan?.notes,
        },
        // Per-type consents and the service contract are recorded inline via
        // `acceptConsent` against the primary draft record. The finalize
        // endpoint's consent insert loop receives an empty array — no extra
        // rows are produced. If/when we surface per-line consent capture in
        // this UI, populate this array with the collected signatures.
        consents: [] as Array<{
          consentTemplateId: string
          signatureData: string
          contentSnapshot: string
          contentHash: string
          acceptanceMethod: string
        }>,
      }

      const url = `/api/encounters/${finalizeEncounterIdRef.current}/finalize`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = (await res.json()) as
        | {
            success: true
            data: {
              encounterId: string
              patientPackageId: string | null
              procedureRecordIds: string[]
              financialEntryId: string
            }
          }
        | { success: false; error: string }

      if (!res.ok || !json.success) {
        const msg =
          (!json.success && json.error) || 'Erro ao finalizar atendimento'
        throw new Error(msg)
      }

      setApproved(true)
      markClean()

      onApproved?.({
        procedureRecordIds: json.data.procedureRecordIds,
        patientPackageId: json.data.patientPackageId,
        encounterId: json.data.encounterId,
      })

      if (origin === 'wizard') {
        wizardOverrides?.onSaveComplete?.({
          success: true,
          procedureId: json.data.procedureRecordIds[0] ?? primaryRecordId,
          procedureStatus: 'approved',
        })
      } else if (!wizardOverrides?.hideNavigation) {
        setTimeout(
          () => router.push(`/pacientes/${patient.id}?tab=procedimentos`),
          1500,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao aprovar procedimento'
      setApproveError(msg)
      if (origin === 'wizard') {
        wizardOverrides?.onSaveComplete?.({ success: false, error: msg, errorType: 'server' })
      }
    } finally {
      setIsApproving(false)
    }
  }, [
    canApprove,
    isApproving,
    isCartMode,
    cart,
    draftRecordIds,
    procedure,
    legacyFinancialPlan,
    financialPlan,
    patient.id,
    practitionerId,
    primaryRecordId,
    router,
    wizardOverrides,
    onApproved,
    markClean,
  ])

  const handleApprove = useCallback(() => { void runApprove('button') }, [runApprove])

  // Wizard triggerSave: call runApprove via the wizard origin.
  const prevTriggerSaveRef = useRef(wizardOverrides?.triggerSave ?? 0)
  useEffect(() => {
    const current = wizardOverrides?.triggerSave ?? 0
    // Reset on 0 so the next fresh press re-fires (wizard resets to 0
    // after SAVE_COMPLETE, so "1" keeps coming back around).
    if (current === 0) {
      prevTriggerSaveRef.current = 0
      return
    }
    if (current === prevTriggerSaveRef.current) return
    prevTriggerSaveRef.current = current
    void runApprove('wizard')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOverrides?.triggerSave])

  if (approved && !wizardOverrides) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] max-w-md w-full">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <div className="flex size-16 items-center justify-center rounded-full bg-mint/20 text-sage">
              <CheckCircle2 className="size-8" />
            </div>
            <h2 className="text-lg font-medium text-charcoal">Procedimento aprovado com sucesso</h2>
            <p className="text-sm text-mid text-center">Redirecionando para a ficha do paciente...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
            <h1 className="font-display text-2xl text-forest">Aprovar Procedimento</h1>
            <p className="text-sm text-mid mt-1">
              Revise o plano, assine os termos e aprove para prosseguir.
            </p>
          </div>
        </>
      )}

      {/* Summary: cart mode renders a multi-line bundle summary; legacy
          mode falls back to the existing single-procedure summary card. */}
      {isCartMode && cart ? (
        <CartApprovalSummary
          cart={cart}
          financialPlan={financialPlan}
          onCartChange={onCartChange}
        />
      ) : (
        procedure && (
          <ApprovalSummaryCard
            procedure={procedure}
            selectedTypes={selectedTypes}
            diagramPoints={diagramPoints}
            productTotals={productTotals}
            financialPlan={financialPlan}
            patientGender={patient.gender}
          />
        )
      )}

      {allUnsignedTypes.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-center gap-3 overflow-hidden">
          <SendConsentSigningLink
            patientId={patient.id}
            patientName={patient.fullName}
            patientPhone={patient.phone}
            procedureRecordId={primaryRecordId}
            consentTypes={allUnsignedTypes}
            renderedContents={signingRenderedContents}
            whatsappApiEnabled={tenant.whatsappApiEnabled}
          />
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-[3px] border border-sage/20 px-3 py-2.5 text-xs font-medium text-mid transition-colors hover:bg-sage/5 hover:text-charcoal disabled:opacity-50"
            title="Verificar assinaturas"
          >
            <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      )}

      <ConsentStatusList
        consentStatuses={consentStatuses}
        allConsentsSigned={allConsentsSigned}
        activeConsentType={activeConsentType}
        activeConsentTemplate={activeConsentTemplate}
        loadingConsentTemplate={loadingConsentTemplate}
        patientId={patient.id}
        patientCpf={patient.cpf}
        procedureId={primaryRecordId}
        onOpenConsent={handleOpenConsent}
        onConsentAccepted={handleConsentAccepted}
      />

      <ServiceContractSection
        loadingContract={loadingContract}
        contractTemplate={contractTemplate}
        contractText={contractText}
        contractSigned={contractSigned}
        contractChecked={contractChecked}
        contractSignature={contractSignature}
        contractSigning={contractSigning}
        contractError={contractError}
        onCheckedChange={handleContractCheckedChange}
        onSignatureChange={handleContractSignatureChange}
        onSignContract={handleSignContract}
      />

      {!wizardOverrides?.hideSaveButton && (
        <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
          <CardContent className="py-6">
            {approveError && (
              <div className="rounded-[3px] border border-red-200 bg-red-50 px-4 py-3 mb-4">
                <p className="text-sm text-red-700">{approveError}</p>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex flex-col gap-2">
                <StatusRow done={allConsentsSigned} label="Todos os termos de consentimento assinados" />
                <StatusRow done={contractSigned} label="Contrato de serviço assinado" />
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

// ── Cart-mode summary card ──────────────────────────────────────────
// Inline so we don't touch any other file (F5 scope). Mirrors the look of
// ApprovalSummaryCard but enumerates cart lines + bundle total.
function CartApprovalSummary({
  cart,
  financialPlan,
  onCartChange,
}: {
  cart: EncounterCart
  financialPlan: FinancialPlan | null
  onCartChange?: (next: EncounterCart) => void
}) {
  const total = useMemo(() => computeCartTotal(cart), [cart])
  const isBundle = cart.templateId !== null || cart.lines.some((l) => l.sessions > 1)
  const editable = !!onCartChange

  return (
    <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
            <ClipboardCheck className="size-4 text-forest" />
          </div>
          <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
            {isBundle ? 'Resumo do Pacote' : 'Resumo do Atendimento'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {cart.templateName && (
          <div>
            <p className="text-xs uppercase tracking-wider text-mid mb-1">Pacote</p>
            <p className="text-sm font-medium text-charcoal">{cart.templateName}</p>
            {cart.templateValidityMonths !== null && (
              <p className="text-xs text-mid mt-0.5">
                Validade: {cart.templateValidityMonths} {cart.templateValidityMonths === 1 ? 'mês' : 'meses'}
              </p>
            )}
          </div>
        )}

        <div>
          <p className="text-xs uppercase tracking-wider text-mid mb-2">
            Procedimentos ({cart.lines.length})
          </p>
          {editable ? (
            <WizardCart
              cart={cart}
              onChange={onCartChange!}
              onRemoveLine={(typeId) =>
                onCartChange!({
                  ...cart,
                  lines: cart.lines.filter((l) => l.procedureTypeId !== typeId),
                })
              }
              onClearTemplate={() =>
                onCartChange!({
                  ...cart,
                  templateId: null,
                  templateName: null,
                  templateDefaultPrice: null,
                  templateValidityMonths: null,
                  lines: cart.lines.filter((l) => l.sourceTemplateLineId === null),
                })
              }
            />
          ) : (
            <div className="space-y-1.5">
              {cart.lines.map((line, idx) => {
                // Template-driven lines carry no per-line price — the
                // package's defaultPrice covers the whole bundle. Render
                // them as "incluído" instead of a misleading R$ 0,00.
                const isTemplateLine = line.sourceTemplateLineId !== null
                return (
                  <div
                    key={`${line.procedureTypeId}-${idx}`}
                    className="flex items-center justify-between rounded-[3px] border border-[#E8ECEF] px-3 py-2"
                  >
                    <div>
                      <p className="text-sm text-charcoal">{line.procedureTypeName}</p>
                      <p className="text-xs text-mid">
                        {line.sessions} {line.sessions === 1 ? 'sessão' : 'sessões'}
                      </p>
                    </div>
                    {isTemplateLine ? (
                      <span className="text-xs uppercase tracking-wider text-sage">
                        Incluído no pacote
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-forest">
                        {formatCurrency(line.defaultPrice * line.sessions)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-mid mb-2">Resumo Financeiro</p>
          <div className="rounded-[3px] border border-[#E8ECEF] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-mid">
                {cart.totalOverride !== null ? 'Valor combinado' : 'Valor total'}
              </span>
              <span className="text-sm font-semibold text-charcoal">
                {formatCurrency(total)}
              </span>
            </div>
            {financialPlan && financialPlan.installmentCount > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-mid">Parcelas</span>
                <span className="text-sm text-charcoal">
                  {financialPlan.installmentCount}x de{' '}
                  {formatCurrency(total / financialPlan.installmentCount)}
                </span>
              </div>
            )}
            {financialPlan?.notes && (
              <div className="pt-1 border-t border-[#E8ECEF]">
                <span className="text-xs text-mid">{financialPlan.notes}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusRow({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="size-4 text-sage" />
      ) : (
        <div className="size-4 rounded-full border-2 border-[#E8ECEF]" />
      )}
      <span className={cn('text-sm', done ? 'text-sage font-medium' : 'text-mid')}>
        {label}
      </span>
    </div>
  )
}

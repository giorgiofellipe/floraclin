'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAcceptConsent } from '@/hooks/mutations/use-consent-mutations'
import {
  interpolateContract,
  buildContractData,
} from '@/lib/contract-interpolation'
import { cn } from '@/lib/utils'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'
import { CATEGORY_TO_CONSENT } from '@/lib/consent-requirements'
import type { EncounterCart } from '@/validations/encounter-cart'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { DiagramPointData } from '@/components/face-diagram/types'
import { diagramsToPoints } from '@/components/face-diagram/points'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import type { PaymentMethod } from '@/types'
import { ConsentStatusList } from './approval/consent-status-list'
import { ServiceContractSection } from './approval/service-contract-section'
import { SendConsentSigningLink } from './approval/send-consent-signing-link'

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

export interface SignaturesPatient {
  id: string
  fullName: string
  cpf?: string | null
  gender?: string | null
  phone?: string | null
}

export interface SignaturesTenant {
  id: string
  name: string
  whatsappApiEnabled?: boolean
}

export interface SignaturesFinancialPlan {
  totalAmount: number
  installmentCount: number
  paymentMethod?: PaymentMethod
  notes?: string
}

export interface PendingSignatures {
  types: string[]
  labels: string[]
}

export function computeProductTotals(points: DiagramPointData[]) {
  const totals = new Map<string, { quantity: number; unit: string }>()
  for (const p of points) {
    const existing = totals.get(p.productName)
    if (existing) existing.quantity += p.quantity
    else totals.set(p.productName, { quantity: p.quantity, unit: p.quantityUnit })
  }
  return Array.from(totals.entries()).map(([name, { quantity, unit }]) => ({ name, quantity, unit }))
}

interface ProcedureSignaturesPanelProps {
  procedure?: ProcedureWithDetails
  patient: SignaturesPatient
  tenant: SignaturesTenant
  additionalTypeIds?: string[]
  primaryRecordId: string
  /** Cart mode: the procedure types come from the cart lines. */
  cart?: EncounterCart
  /** Overrides the plan used to fill the contract. Defaults to `procedure.financialPlan`. */
  financialPlan?: SignaturesFinancialPlan | null
  diagrams?: DiagramWithPoints[]
  /** Called once consent and contract status are loaded, and on every change after. */
  onPendingChange?: (pending: PendingSignatures) => void
  onDirtyChange?: (dirty: boolean) => void
}

export function ProcedureSignaturesPanel({
  procedure,
  patient,
  tenant,
  additionalTypeIds,
  primaryRecordId,
  cart,
  financialPlan: financialPlanProp,
  diagrams,
  onPendingChange,
  onDirtyChange,
}: ProcedureSignaturesPanelProps) {
  const acceptConsent = useAcceptConsent()
  const { data: procedureTypes, isPending: loadingProcedureTypes } = useProcedureTypes()
  const isCartMode = !!cart

  const financialPlan = useMemo(
    () =>
      financialPlanProp !== undefined
        ? financialPlanProp
        : ((procedure?.financialPlan ?? null) as SignaturesFinancialPlan | null),
    [financialPlanProp, procedure],
  )

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
  const [isRefreshing, setIsRefreshing] = useState(false)

  const productTotals = useMemo(
    () => computeProductTotals(diagramsToPoints(diagrams ?? [])),
    [diagrams],
  )

  const allTypeIds = useMemo(() => {
    if (isCartMode && cart) {
      return Array.from(new Set(cart.lines.map((l) => l.procedureTypeId)))
    }
    const ids = procedure ? [procedure.procedureTypeId] : []
    if (additionalTypeIds?.length) ids.push(...additionalTypeIds)
    return ids
  }, [isCartMode, cart, procedure, additionalTypeIds])

  const allConsentsSigned = useMemo(() => {
    if (consentStatuses.length === 0) return false
    return consentStatuses.every((c) => c.signed)
  }, [consentStatuses])

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

  const onPendingChangeRef = useRef(onPendingChange)
  onPendingChangeRef.current = onPendingChange
  const pendingKey = allUnsignedTypes.join(',')
  useEffect(() => {
    if (loadingContract) return
    onPendingChangeRef.current?.({
      types: allUnsignedTypes,
      labels: allUnsignedTypes.map((t) => CONSENT_TYPE_LABELS[t] ?? t),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, loadingContract])

  const loadedTypeIdsRef = useRef<string>('')

  useEffect(() => {
    if (loadingProcedureTypes) return
    const key = allTypeIds.slice().sort().join(',')
    if (key === loadedTypeIdsRef.current) return
    loadedTypeIdsRef.current = key

    async function initAll() {
      const selected = ((procedureTypes ?? []) as ProcedureType[]).filter((t) => allTypeIds.includes(t.id))
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
  }, [allTypeIds, patient, primaryRecordId, tenant.name, financialPlan, productTotals, isCartMode, cart, procedure, loadingProcedureTypes, procedureTypes])

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
    onDirtyChange?.(true)
  }, [onDirtyChange])

  const handleContractSignatureChange = useCallback((data: string | null) => {
    setContractSignature(data)
    if (data) onDirtyChange?.(true)
  }, [onDirtyChange])

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
      onDirtyChange?.(false)
    } catch (err) {
      setContractError(err instanceof Error ? err.message : 'Erro inesperado ao assinar contrato')
    } finally {
      setContractSigning(false)
    }
  }, [contractTemplate, contractChecked, contractSignature, patient.id, primaryRecordId, contractText, acceptConsent, onDirtyChange])

  return (
    <div className="space-y-6">
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
    </div>
  )
}

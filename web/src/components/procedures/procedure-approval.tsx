'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { ApprovalSummaryCard } from './approval/approval-summary-card'
import { ConsentStatusList } from './approval/consent-status-list'
import { ServiceContractSection } from './approval/service-contract-section'

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
  wizardOverrides,
}: ProcedureApprovalProps) {
  const router = useRouter()
  const approveProcedure = useApproveProcedure()
  const acceptConsent = useAcceptConsent()

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

  const financialPlan = procedure.financialPlan as FinancialPlan | null
  const diagramPoints = useMemo(() => diagramsToPoints(diagrams), [diagrams])
  const productTotals = useMemo(() => computeProductTotals(diagramPoints), [diagramPoints])

  const allTypeIds = useMemo(() => {
    const ids = [procedure.procedureTypeId]
    if (additionalTypeIds?.length) ids.push(...additionalTypeIds)
    return ids
  }, [procedure.procedureTypeId, additionalTypeIds])

  const selectedTypes = useMemo(
    () => procedureTypes.filter((t) => allTypeIds.includes(t.id)),
    [procedureTypes, allTypeIds],
  )

  const allConsentsSigned = useMemo(() => {
    if (consentStatuses.length === 0) return false
    return consentStatuses.every((c) => c.signed)
  }, [consentStatuses])

  const canApprove = allConsentsSigned && contractSigned

  // Single initialization: load all data at once.
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

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
            const checkRes = await fetch(`/api/consent/history/${patient.id}?procedureId=${procedure.id}&type=${type}`)
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
        fetch(`/api/consent/history/${patient.id}?procedureId=${procedure.id}&type=service_contract`).catch(() => null),
      ])

      setConsentStatuses(consentResults)

      const contractTpl = contractTplRes?.ok ? await contractTplRes.json() : null
      if (contractTpl) {
        setContractTemplate(contractTpl as unknown as ConsentTemplate)
        if (financialPlan) {
          const contractData = buildContractData(
            selected.map((t) => ({ name: t.name })),
            productTotals.map((p) => ({ name: p.name, quantity: p.quantity, unit: p.unit })),
            financialPlan,
            { fullName: patient.fullName, cpf: patient.cpf },
            procedure.practitionerName,
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
  }, [allTypeIds, patient, procedure, tenant.name, financialPlan, productTotals])

  // Propagate unsaved-changes state to the wizard.
  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(hasUnsavedChanges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges])

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
        procedureRecordId: procedure.id,
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
  }, [contractTemplate, contractChecked, contractSignature, patient.id, procedure.id, contractText, acceptConsent, markClean])

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
      await approveProcedure.mutateAsync(procedure.id)
      setApproved(true)
      markClean()
      if (origin === 'wizard') {
        wizardOverrides?.onSaveComplete?.({ success: true, procedureId: procedure.id })
      } else if (!wizardOverrides?.hideNavigation) {
        setTimeout(() => router.push(`/pacientes/${patient.id}?tab=procedimentos`), 1500)
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
  }, [canApprove, isApproving, procedure.id, patient.id, router, wizardOverrides, approveProcedure, markClean])

  const handleApprove = useCallback(() => { void runApprove('button') }, [runApprove])

  // Wizard triggerSave: call approveProcedureAction.
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

      <ApprovalSummaryCard
        procedure={procedure}
        selectedTypes={selectedTypes}
        diagramPoints={diagramPoints}
        productTotals={productTotals}
        financialPlan={financialPlan}
        patientGender={patient.gender}
      />

      <ConsentStatusList
        consentStatuses={consentStatuses}
        allConsentsSigned={allConsentsSigned}
        activeConsentType={activeConsentType}
        activeConsentTemplate={activeConsentTemplate}
        loadingConsentTemplate={loadingConsentTemplate}
        patientId={patient.id}
        procedureId={procedure.id}
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

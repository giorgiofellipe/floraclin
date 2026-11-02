'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DEFAULT_PROCEDURE_TYPES, DEFAULT_PRODUCTS, PROCEDURE_CATEGORY_LABELS as CATEGORY_LABEL } from '@/lib/constants'
import { toast } from 'sonner'
import { CheckIcon, Building2Icon, SyringeIcon, PackageIcon, UsersIcon, LogOutIcon, PlusIcon } from 'lucide-react'
import { logout } from '@/actions/auth'
import type { CustomProductInput } from './custom-product-form'
import type { Product } from '@/db/queries/products'
import { MaskedInput } from '@/components/ui/masked-input'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { cn } from '@/lib/utils'
import { CLINIC_PHONE_REQUIRED_MESSAGE, hasClinicPhone } from '@/lib/clinic-phone'
import { resetAnalytics, track } from '@/lib/analytics/client'
import type { OnboardingStepName, OnboardingSubmitFailureReason, OnboardingTrackedField } from '@/lib/analytics/events'
import {
  ONBOARDING_ALREADY_COMPLETED,
  ONBOARDING_STEPS,
  type OnboardingCompletionMethod,
  type OnboardingDraft,
  type OnboardingProgressInput,
} from '@/validations/onboarding'
import { useOnboardingAutosave } from './use-onboarding-autosave'
import { useRedirectWhenOnboardingCompleted } from './use-redirect-when-onboarding-completed'
import { useFieldInteractionTracking, useStepAbandonTracking } from './use-onboarding-tracking'
import { useKeyboardInset } from './use-keyboard-inset'
import { ClinicStep, type ClinicStepValues } from './clinic-step'
import { FIRST_PATIENT_HIGHLIGHT_PARAM } from '@/lib/first-patient-highlight'

// Only the clinic step is needed on arrival, and most owners arrive on a
// phone, many in Instagram's or Facebook's in-app browser. The later steps'
// forms (and what they import: the procedure dialog, the invite form, the
// product catalogue) load when the owner gets there, not with step 1.
const ProcedureTypeList = dynamic(() =>
  import('@/components/settings/procedure-type-list').then((m) => m.ProcedureTypeList),
)
const ProcedureTypeForm = dynamic(() =>
  import('@/components/settings/procedure-type-form').then((m) => m.ProcedureTypeForm),
)
const InviteUserForm = dynamic(() => import('@/components/settings/invite-user-form').then((m) => m.InviteUserForm))
const ProductsStep = dynamic(() => import('./products-step').then((m) => m.ProductsStep))

interface ProcedureOverride {
  selected: boolean
  durationMin: number
  defaultPrice: string // masked currency string, e.g. "150,00"
}

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120] as const

type CustomProductItem = CustomProductInput & { isCustom: true }

function withoutCustomFlag({ name, category, activeIngredient, defaultUnit }: CustomProductItem): CustomProductInput {
  return { name, category, activeIngredient, defaultUnit }
}

interface ProcedureTypeItem {
  id: string
  name: string
  category: string
  description: string | null
  defaultPrice: string | null
  estimatedDurationMin: number | null
  preProcedureInstructions: string | null
  postProcedureCare: string | null
  isActive: boolean
}

const STEP_DISPLAY: Record<OnboardingStepName, { label: string; icon: typeof Building2Icon }> = {
  clinic: { label: 'Clínica', icon: Building2Icon },
  procedures: { label: 'Procedimentos', icon: SyringeIcon },
  products: { label: 'Produtos', icon: PackageIcon },
  team: { label: 'Equipe', icon: UsersIcon },
}

// `name` is the step's stable analytics id, independent of the label copy.
const STEPS = ONBOARDING_STEPS.map((name) => ({ name, ...STEP_DISPLAY[name] }))

function submitFailureReason(status: number): OnboardingSubmitFailureReason {
  if (status === 409) return 'slug_taken'
  if (status === 400) return 'validation'
  if (status === 402) return 'subscription_expired'
  if (status === 401 || status === 403) return 'forbidden'
  return 'server_error'
}

function stepProperties(index: number) {
  return { step_index: index, step_name: STEPS[index].name }
}

interface OnboardingWizardProps {
  tenantName: string
  /** The name is only a suggestion from the Google profile, not one the owner saved. */
  tenantNameSuggested?: boolean
  tenantPhone: string | null
  /** Progress autosaved on an earlier visit, to resume from. */
  draft?: OnboardingDraft | null
  existingProcedureTypes: ProcedureTypeItem[]
  existingProducts?: Product[]
  /** Ask for the clinic phone before moving past the first step. */
  phoneRequired?: boolean
}

/** The procedures the wizard offers, all selected, at their default durations. */
function defaultProcedureOverrides(): ProcedureOverride[] {
  return DEFAULT_PROCEDURE_TYPES.map((pt) => ({ selected: true, durationMin: pt.estimatedDurationMin, defaultPrice: '' }))
}

// Pre-select the first product of each category that matches a selected procedure type.
function computeDefaultProductSelection(selectedProcedureFlags: boolean[]): Set<string> {
  const activeCategories = new Set(
    DEFAULT_PROCEDURE_TYPES.filter((_, i) => selectedProcedureFlags[i]).map((pt) => pt.category),
  )
  const seen = new Set<string>()
  const firstPerCategory = new Set<string>()
  for (const p of DEFAULT_PRODUCTS) {
    if (activeCategories.has(p.category) && !seen.has(p.category)) {
      seen.add(p.category)
      firstPerCategory.add(p.name)
    }
  }
  return firstPerCategory
}

function procedureTypesPayload(overrides: ProcedureOverride[]) {
  return DEFAULT_PROCEDURE_TYPES.flatMap((pt, i) => {
    const override = overrides[i]
    if (!override?.selected) return []
    const priceNumber = override.defaultPrice ? parseCurrency(override.defaultPrice) : 0
    return [
      {
        name: pt.name,
        category: pt.category,
        estimatedDurationMin: override.durationMin,
        defaultPrice: priceNumber > 0 ? priceNumber.toFixed(2) : undefined,
      },
    ]
  })
}

// Strip UI-only `origin` from defaults and `isCustom` from customs.
function selectedProductsPayload(names: Set<string>, customs: CustomProductItem[]) {
  return [
    ...DEFAULT_PRODUCTS.filter((p) => names.has(p.name)).map((p) => ({
      name: p.name,
      category: p.category,
      activeIngredient: p.activeIngredient,
      defaultUnit: p.defaultUnit,
    })),
    ...customs.map(withoutCustomFlag),
  ]
}

export function OnboardingWizard({
  tenantName,
  tenantNameSuggested = false,
  tenantPhone,
  draft = null,
  existingProcedureTypes,
  existingProducts = [],
  phoneRequired = false,
}: OnboardingWizardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // A later step needs the clinic step passed; if its save did not land, ask again.
  const clinicStepSaved = Boolean(tenantName.trim()) && (!phoneRequired || hasClinicPhone(tenantPhone))
  const [currentStep, setCurrentStep] = useState(clinicStepSaved ? (draft?.step ?? 0) : 0)

  // Step 1 state: clinic name and phone, the only two things onboarding asks.
  const [clinicData, setClinicData] = useState<ClinicStepValues>({
    name: tenantName || '',
    phone: tenantPhone ?? '',
  })
  const [invalidField, setInvalidField] = useState<OnboardingTrackedField | null>(null)
  // Says where the prefilled name came from until the owner edits it.
  const [nameSuggested, setNameSuggested] = useState(tenantNameSuggested && Boolean(tenantName.trim()))
  const clinicStepValid = clinicData.name.trim().length > 0 && (!phoneRequired || hasClinicPhone(clinicData.phone))

  // Step 2 state: procedure types (local selection before onboarding completes)
  const [procedureOverrides, setProcedureOverrides] = useState<ProcedureOverride[]>(() =>
    draft?.procedures.length === DEFAULT_PROCEDURE_TYPES.length ? draft.procedures : defaultProcedureOverrides(),
  )
  const [showAddProcedure, setShowAddProcedure] = useState(false)

  // Step 3 state: products — re-computed from the procedures until the user
  // manually touches the product selection.
  const [selectedProductNames, setSelectedProductNames] = useState<Set<string>>(() =>
    draft
      ? new Set(draft.selectedProductNames)
      : computeDefaultProductSelection(DEFAULT_PROCEDURE_TYPES.map(() => true)),
  )
  const [productsTouched, setProductsTouched] = useState(draft?.productsTouched ?? false)
  const [customProducts, setCustomProducts] = useState<CustomProductItem[]>(
    () => draft?.customProducts.map((p) => ({ ...p, isCustom: true as const })) ?? [],
  )
  const productsAlreadyConfigured = (existingProducts?.length ?? 0) > 0

  // Step 4 state: track sent invites count
  const [invitesSent, setInvitesSent] = useState(0)
  const [showInviteForm, setShowInviteForm] = useState(false)

  const progress: OnboardingProgressInput = {
    clinic: {
      name: clinicData.name,
      phone: clinicData.phone,
    },
    draft: {
      step: currentStep,
      procedures: procedureOverrides,
      selectedProductNames: [...selectedProductNames],
      productsTouched,
      customProducts: customProducts.map(withoutCustomFlag),
    },
  }
  const autosave = useOnboardingAutosave(progress)
  const trackFieldInteraction = useFieldInteractionTracking(0)
  const abandonTracking = useStepAbandonTracking(currentStep)
  useRedirectWhenOnboardingCompleted(abandonTracking.suppress)
  const keyboardInset = useKeyboardInset()

  function handleClinicChange(values: ClinicStepValues) {
    if (values.name !== clinicData.name) setNameSuggested(false)
    setClinicData(values)
    if (invalidField) setInvalidField(null)
  }

  function toggleDefault(index: number) {
    setProcedureOverrides((prev) =>
      prev.map((o, i) => (i === index ? { ...o, selected: !o.selected } : o)),
    )
  }

  function setProcedureDuration(index: number, durationMin: number) {
    setProcedureOverrides((prev) =>
      prev.map((o, i) => (i === index ? { ...o, durationMin } : o)),
    )
  }

  function setProcedureDefaultPrice(index: number, defaultPrice: string) {
    setProcedureOverrides((prev) =>
      prev.map((o, i) => (i === index ? { ...o, defaultPrice } : o)),
    )
  }

  function handleProductSelectionChange(name: string, selected: boolean) {
    setProductsTouched(true)
    setSelectedProductNames((prev) => {
      const next = new Set(prev)
      if (selected) next.add(name)
      else next.delete(name)
      return next
    })
  }

  function handleAddCustomProduct(product: CustomProductInput) {
    const nameLower = product.name.trim().toLowerCase()
    const collidesWithDefault = DEFAULT_PRODUCTS.some(
      (d) => d.name.toLowerCase() === nameLower,
    )
    setCustomProducts((prev) => {
      const collidesWithCustom = prev.some((p) => p.name.toLowerCase() === nameLower)
      if (collidesWithDefault || collidesWithCustom) {
        toast.error(`Já existe um produto chamado "${product.name}"`)
        return prev
      }
      setProductsTouched(true)
      return [...prev, { ...product, isCustom: true }]
    })
  }

  function handleRemoveCustomProduct(name: string) {
    setProductsTouched(true)
    setCustomProducts((prev) => prev.filter((p) => p.name !== name))
  }

  // Re-sync product pre-selection when procedure selection changes, but only
  // until the user manually touches the product step.
  useEffect(() => {
    if (productsTouched) return
    const flags = procedureOverrides.map((o) => o.selected)
    setSelectedProductNames(computeDefaultProductSelection(flags))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedureOverrides, productsTouched])

  // `onboarding_step_submitted` is sent once per visit to a step: a retried
  // finish after a failed save does not send it again.
  const stepSubmitted = useRef(false)
  // Field names only, never values.
  useEffect(() => {
    stepSubmitted.current = false
    track('onboarding_step_viewed', stepProperties(currentStep))
  }, [currentStep])

  function trackStepSubmitted(extra?: { via: 'defaults' }) {
    if (stepSubmitted.current) return
    stepSubmitted.current = true
    track('onboarding_step_submitted', { ...stepProperties(currentStep), ...extra })
  }

  function handleNext() {
    if (currentStep === 0 && !validateClinicStep()) return
    trackStepSubmitted()
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1))
  }

  function validateClinicStep(): boolean {
    if (clinicData.name.trim().length === 0) {
      track('onboarding_step_validation_error', { ...stepProperties(0), fields: ['name'] })
      setInvalidField('name')
      toast.error('Nome da clínica é obrigatório')
      return false
    }
    if (phoneRequired && !hasClinicPhone(clinicData.phone)) {
      track('onboarding_step_validation_error', { ...stepProperties(0), fields: ['phone'] })
      setInvalidField('phone')
      toast.error(CLINIC_PHONE_REQUIRED_MESSAGE)
      return false
    }
    return true
  }

  function handlePrev() {
    setCurrentStep(prev => Math.max(prev - 1, 0))
  }

  function handleComplete() {
    // onboarding_completed itself is sent by the server, once, when the save
    // succeeds (api/onboarding).
    trackStepSubmitted()
    complete('wizard', procedureTypesPayload(procedureOverrides), selectedProductsPayload(selectedProductNames, customProducts))
  }

  /**
   * "Configurar depois": the procedures and products the wizard offers
   * preselected, no invites, and the same final save (and so the same
   * completion side effects) as the last step, marked `method: defaults`.
   */
  function handleUseDefaults() {
    if (!validateClinicStep()) return
    // Step 1 is submitted either way; `via` tells the shortcut from "Próximo".
    trackStepSubmitted({ via: 'defaults' })
    const overrides = defaultProcedureOverrides()
    complete(
      'defaults',
      procedureTypesPayload(overrides),
      selectedProductsPayload(computeDefaultProductSelection(overrides.map((o) => o.selected)), []),
    )
  }

  function complete(
    method: OnboardingCompletionMethod,
    procedureTypes: ReturnType<typeof procedureTypesPayload>,
    selectedProducts: ReturnType<typeof selectedProductsPayload>,
  ) {
    // Leaving for the dashboard is not abandoning the step.
    abandonTracking.suppress()
    startTransition(async () => {
      await autosave.pause()
      const failed = () => {
        autosave.resume()
        abandonTracking.resume()
      }

      let res: Response
      try {
        res = await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clinic: {
              name: clinicData.name || tenantName,
              phone: clinicData.phone || undefined,
            },
            procedureTypes,
            selectedProducts,
            method,
          }),
        })
      } catch {
        failed()
        track('onboarding_submit_failed', { ...stepProperties(currentStep), reason: 'network_error' })
        toast.error('Erro ao completar o onboarding')
        return
      }

      // A gateway error page is not JSON.
      const result = await res.json().catch(() => null)

      if (result?.success) {
        autosave.finish()
        toast.success('Configuração concluída! Bem-vindo ao FloraClin.')
        // Replace, so Back cannot return to the finished wizard. The
        // dashboard points at the first patient once.
        router.replace(`/dashboard?${FIRST_PATIENT_HIGHLIGHT_PARAM}=1`)
      } else if (res.status === 409 && result?.error === ONBOARDING_ALREADY_COMPLETED) {
        autosave.finish()
        router.replace('/dashboard')
      } else {
        failed()
        track('onboarding_submit_failed', { ...stepProperties(currentStep), reason: submitFailureReason(res.status), status: res.status })
        toast.error(result?.error || 'Erro ao completar o onboarding')
      }
    })
  }

  return (
    // min-h-dvh, not 100vh: on iOS 100vh is taller than what shows under the
    // URL bar. The bottom padding keeps the last field clear of the action bar
    // that is pinned to the bottom on phones.
    <div className="min-h-dvh bg-content-bg">
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-36 sm:py-16">
        {/* Header */}
        <div className="mb-3 text-center sm:mb-12 animate-fade-in-up">
          <h1 className="text-3xl text-charcoal sm:text-5xl font-semibold tracking-tight">
            Bem-vindo ao <span className="font-display text-forest">Flora</span><span className="font-display text-sage">Clin</span>
          </h1>
          <p className="mt-1 text-mid text-base sm:mt-3">
            Configure sua clínica em poucos passos
          </p>
          <button
            type="button"
            onClick={() => {
              // Signing out is not abandoning a step, and the identity is
              // about to be cleared anyway.
              abandonTracking.suppress()
              resetAnalytics()
              void logout()
            }}
            // 44px tall hit area around small text: easy to tap, not loud.
            // charcoal/70, not mid: mid is under 4.5:1 on content-bg.
            className="inline-flex min-h-11 items-center gap-1 px-3 text-xs text-charcoal/70 hover:text-charcoal transition-colors sm:mt-3"
          >
            <LogOutIcon className="h-3 w-3" />
            Sair
          </button>
        </div>

        {/* Stepper */}
        <div className="mb-4 sm:mb-10 animate-fade-in-up-delay-1">
          <div className="relative flex items-start justify-center">
            {/* Connector lines (absolute, behind circles) */}
            {STEPS.map((_, index) => {
              if (index === 0) return null
              return (
                <div
                  key={`line-${index}`}
                  className="absolute top-6 -translate-y-1/2"
                  style={{
                    left: `calc(${((index - 0.5) / STEPS.length) * 100}% - 24px)`,
                    width: `calc(${(1 / STEPS.length) * 100}%)`,
                  }}
                >
                  <div
                    className={`h-[2px] w-full transition-all duration-500 ${
                      index <= currentStep ? 'bg-sage' : 'bg-blush/40'
                    }`}
                  />
                </div>
              )
            })}

            {/* Step circles + labels */}
            {STEPS.map((step, index) => {
              const isCompleted = index < currentStep
              const isCurrent = index === currentStep
              return (
                <div
                  key={step.label}
                  className="relative z-10 flex flex-1 flex-col items-center gap-1 sm:gap-2"
                >
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-500 ${
                      isCompleted
                        ? 'bg-sage text-cream shadow-md shadow-sage/20'
                        : isCurrent
                          ? 'bg-forest text-cream shadow-lg shadow-forest/20'
                          : 'bg-petal text-mid border border-blush/40'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckIcon className="h-5 w-5" />
                    ) : (
                      <span className="text-sm font-semibold">{index + 1}</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-xs font-medium tracking-wide transition-colors duration-300',
                      // Steps ahead stay grey, set apart from the green current
                      // and completed ones; charcoal/70 keeps them above 4.5:1.
                      isCurrent && 'text-forest',
                      isCompleted && 'text-sage',
                      !isCurrent && !isCompleted && 'text-charcoal/70',
                    )}
                  >
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Step Content */}
        <Card
          key={currentStep}
          className="animate-fade-in-up border-blush/30 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-4 sm:p-10"
        >
          {/* Step 1: the clinic's name and phone */}
          {currentStep === 0 && (
            <div>
              <h2 className="text-xl font-medium text-charcoal mb-1 tracking-tight">
                Dados da Clínica
              </h2>
              <p className="text-sm text-mid mb-4 sm:mb-6">
                Só o nome e o telefone. O resto você ajusta depois.
              </p>

              <ClinicStep
                values={clinicData}
                onChange={handleClinicChange}
                onFieldInteraction={trackFieldInteraction}
                invalidField={invalidField}
                nameSuggested={nameSuggested}
              />

              {/* A skip, not a second way forward: a quiet text action under
                  the fields, so Próximo stays the only primary button. */}
              <div className="mt-6 flex flex-col items-center text-center sm:mt-8">
                <Button
                  type="button"
                  variant="link"
                  onClick={handleUseDefaults}
                  disabled={isPending || !clinicStepValid}
                  aria-describedby="use-defaults-hint"
                  data-testid="onboarding-use-defaults"
                  // Disabled reads as plain grey text, not a faded primary.
                  className="h-11 px-3 text-sm text-forest underline decoration-forest/40 underline-offset-4 hover:decoration-forest disabled:text-mid disabled:no-underline disabled:opacity-100"
                >
                  {isPending ? 'Finalizando...' : 'Configurar depois'}
                </Button>
                <p id="use-defaults-hint" className="text-xs text-mid">
                  {clinicStepValid
                    ? 'Usa os procedimentos padrão, você ajusta quando quiser.'
                    : 'Preencha o nome e o telefone para configurar depois.'}
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Procedure Types */}
          {currentStep === 1 && (
            <div>
              <h2 className="text-xl font-medium text-charcoal mb-1 tracking-tight">
                Tipos de Procedimento
              </h2>
              <p className="text-sm text-mid mb-8">
                Selecione os procedimentos que sua clínica oferece. Você pode adicionar mais depois.
              </p>

              {/* Default procedure types — card grid with inline editable duration + price */}
              <div className="mb-8 space-y-3">
                <h3 className="text-xs font-medium text-mid uppercase tracking-wider">
                  Procedimentos Sugeridos
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DEFAULT_PROCEDURE_TYPES.map((pt, index) => {
                    const override = procedureOverrides[index]
                    const selected = override?.selected ?? false
                    return (
                      <div
                        key={pt.name}
                        className={cn(
                          'rounded-lg border p-3 transition-colors',
                          selected
                            ? 'border-forest bg-[#F0F7F1] ring-2 ring-forest/30'
                            : 'border-[#E8ECEF] bg-white hover:bg-[#F4F6F8]',
                        )}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          aria-label={pt.name}
                          onClick={() => toggleDefault(index)}
                          className="relative flex w-full items-start gap-2 text-left cursor-pointer"
                        >
                          {selected && (
                            <span className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-forest text-white">
                              <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />
                            </span>
                          )}
                          <div className="flex-1 min-w-0 pr-6">
                            <span className="block text-sm font-medium text-charcoal leading-tight">
                              {pt.name}
                            </span>
                            <span className="block text-[11px] uppercase tracking-wider text-mid mt-0.5">
                              {CATEGORY_LABEL[pt.category] ?? pt.category}
                            </span>
                          </div>
                        </button>

                        <div
                          className={cn(
                            'mt-3 grid grid-cols-2 gap-2 border-t pt-3 transition-opacity',
                            selected
                              ? 'border-sage/20 opacity-100'
                              : 'border-[#E8ECEF] opacity-50 pointer-events-none',
                          )}
                          aria-hidden={!selected}
                        >
                          <div className="space-y-1">
                            <span className="block text-[10px] uppercase tracking-wider text-mid">
                              Duração
                            </span>
                            <select
                              value={override.durationMin}
                              onChange={(e) => setProcedureDuration(index, Number(e.target.value))}
                              disabled={!selected}
                              tabIndex={selected ? 0 : -1}
                              className="w-full rounded-md border border-sage/30 bg-white px-2 py-1 text-base sm:text-sm text-charcoal focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest/30 disabled:bg-content-bg"
                            >
                              {DURATION_OPTIONS.map((mins) => (
                                <option key={mins} value={mins}>
                                  {mins} min
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <span className="block text-[10px] uppercase tracking-wider text-mid">
                              Preço (opcional)
                            </span>
                            <div className="relative">
                              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-medium text-charcoal">
                                R$
                              </span>
                              <MaskedInput
                                mask={maskCurrency}
                                value={override.defaultPrice}
                                onChange={(e) => setProcedureDefaultPrice(index, e.target.value)}
                                disabled={!selected}
                                tabIndex={selected ? 0 : -1}
                                placeholder="0,00"
                                inputMode="numeric"
                                className="h-auto w-full rounded-md border border-sage/30 bg-white py-1 pl-8 pr-2 text-base sm:text-sm text-charcoal focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest/30 disabled:bg-content-bg"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Existing procedure types (if any were already created via the dialog) */}
              {existingProcedureTypes.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-xs font-medium text-mid uppercase tracking-wider mb-3">
                    Procedimentos já cadastrados
                  </h3>
                  <ProcedureTypeList
                    procedureTypes={existingProcedureTypes}
                    embedded
                  />
                </div>
              )}

              {/* Add custom procedure type */}
              <div className="border-t border-blush/30 pt-5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddProcedure(prev => !prev)}
                  className="mb-3 border-sage/30 text-sage hover:bg-sage/5 hover:text-forest"
                >
                  <PlusIcon className="h-4 w-4" />
                  Adicionar outro procedimento
                </Button>
                {showAddProcedure && (
                  <div className="rounded-[3px] border border-blush/30 p-4 bg-white">
                    <ProcedureTypeForm
                      onSuccess={() => {
                        setShowAddProcedure(false)
                      }}
                      onCancel={() => setShowAddProcedure(false)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Products */}
          {currentStep === 2 && (
            <ProductsStep
              selectedNames={selectedProductNames}
              customProducts={customProducts}
              alreadyConfigured={productsAlreadyConfigured}
              onSelectionChange={handleProductSelectionChange}
              onAddCustom={handleAddCustomProduct}
              onRemoveCustom={handleRemoveCustomProduct}
            />
          )}

          {/* Step 4: Team Invites */}
          {currentStep === 3 && (
            <div>
              <h2 className="text-xl font-medium text-charcoal mb-1 tracking-tight">
                Convide sua Equipe
              </h2>
              <p className="text-sm text-mid mb-8">
                Você pode convidar profissionais e recepcionistas agora, ou fazer isso depois em Configurações.
              </p>

              {invitesSent > 0 && (
                <div className="mb-6 rounded-lg bg-sage/10 border border-sage/20 p-4 flex items-center gap-3 animate-fade-in-up">
                  <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0">
                    <CheckIcon className="h-4 w-4 text-sage" />
                  </div>
                  <div>
                    <p className="text-sm text-sage font-medium">
                      {invitesSent} {invitesSent === 1 ? 'convite enviado' : 'convites enviados'} com sucesso.
                    </p>
                    {!showInviteForm && (
                      <button
                        type="button"
                        onClick={() => setShowInviteForm(true)}
                        className="text-xs text-sage/70 hover:text-forest transition-colors mt-0.5"
                      >
                        Convidar mais alguém
                      </button>
                    )}
                  </div>
                </div>
              )}

              {showInviteForm ? (
                <div className="rounded-lg border border-blush/30 p-5 bg-white animate-fade-in-up">
                  <InviteUserForm
                    onSuccess={() => {
                      setInvitesSent(prev => prev + 1)
                      setShowInviteForm(false)
                    }}
                  />
                </div>
              ) : invitesSent === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <div className="rounded-full bg-sage/10 p-4 mb-4">
                    <UsersIcon className="h-6 w-6 text-sage" />
                  </div>
                  <p className="text-sm text-charcoal font-medium mb-1">Nenhum convite enviado ainda</p>
                  <p className="text-xs text-mid mb-5">Sua equipe receberá um e-mail com link de acesso.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowInviteForm(true)}
                    className="border-sage/30 text-sage hover:bg-sage/5 hover:text-forest"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Convidar membro da equipe
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        {/* Navigation. Pinned to the bottom on phones, above the home
            indicator (safe-area inset) and lifted over the on-screen keyboard
            (useKeyboardInset), so Próximo is always within reach; the page's
            bottom padding keeps it from covering the content. In the page flow
            from `sm` up. While the cookie banner shows, the bar sits on top of
            it (--cookie-banner-offset) instead of under it. No transform-based animation on it or any ancestor:
            a transformed ancestor turns position: fixed into absolute. */}
        <div
          data-testid="onboarding-actions"
          className="fixed inset-x-0 bottom-[var(--cookie-banner-offset,0px)] z-40 border-t border-blush/30 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] transition-transform duration-150 sm:static sm:z-auto sm:mt-8 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"
          // With the keyboard open the cookie banner is behind it, so the bar
          // rises from the bottom edge by the keyboard alone, not from above
          // the banner as well.
          style={keyboardInset > 0 ? { bottom: 0, transform: `translateY(-${keyboardInset}px)` } : undefined}
        >
          {/* On the last step, below sm, Começar a usar takes a full row on top
              and Voltar and the skip action share the row under it: the three
              in one line do not fit a phone. */}
          <div
            className={cn(
              'mx-auto flex max-w-3xl items-center justify-between gap-3',
              currentStep === 3 && 'flex-wrap sm:flex-nowrap',
            )}
          >
            {/* Without Voltar (step 1) Próximo spans the bar on phones: a full thumb target. */}
            <div className={currentStep === 0 ? 'hidden sm:block' : undefined}>
              {currentStep > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePrev}
                  disabled={isPending}
                  className="h-11 border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors sm:h-9"
                  data-testid="onboarding-prev"
                >
                  Voltar
                </Button>
              )}
            </div>

            <div
              className={cn(
                'flex items-center gap-2 sm:gap-3',
                currentStep === 0 && 'w-full sm:w-auto',
                currentStep === 3 && 'contents sm:flex',
              )}
            >
              {currentStep === 3 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleComplete}
                  disabled={isPending}
                  className="h-11 px-2 text-mid hover:text-sage transition-colors duration-200 sm:h-9 sm:px-4"
                  data-testid="onboarding-skip"
                >
                  {invitesSent > 0 ? 'Continuar sem mais convites' : 'Pular por enquanto'}
                </Button>
              )}

              {currentStep < STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={isPending}
                  className={cn(
                    'h-11 bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium transition-all duration-300 shadow-sm hover:shadow-md px-8 sm:h-9',
                    currentStep === 0 && 'w-full sm:w-auto',
                  )}
                  data-testid="onboarding-next"
                >
                  Próximo
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleComplete}
                  disabled={isPending}
                  data-testid="onboarding-complete"
                  className={cn(
                    'order-first h-11 w-full bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium transition-all duration-300 shadow-md hover:shadow-lg px-6 sm:order-none sm:h-9 sm:w-auto sm:px-8',
                    !isPending && 'animate-subtle-pulse',
                  )}
                >
                  {isPending ? 'Finalizando...' : 'Começar a usar'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-gold/50 text-[11px] tracking-wider sm:mt-12">
          floraclin.com.br
        </p>
      </div>
    </div>
  )
}

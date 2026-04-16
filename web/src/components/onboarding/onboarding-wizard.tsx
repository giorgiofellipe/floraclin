'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ClinicSettingsForm } from '@/components/settings/clinic-settings-form'
import { ProcedureTypeList } from '@/components/settings/procedure-type-list'
import { ProcedureTypeForm } from '@/components/settings/procedure-type-form'
import { InviteUserForm } from '@/components/settings/invite-user-form'
import { DEFAULT_PROCEDURE_TYPES, DEFAULT_PRODUCTS, DEFAULT_WORKING_HOURS } from '@/lib/constants'
import { toast } from 'sonner'
import { CheckIcon, Building2Icon, SyringeIcon, PackageIcon, UsersIcon, LogOutIcon, PlusIcon } from 'lucide-react'
import { logout } from '@/actions/auth'
import type { WorkingHours } from '@/validations/tenant'
import { ProductsStep, type ProductStepItem } from './products-step'
import type { CustomProductInput } from './custom-product-form'
import type { Product } from '@/db/queries/products'
import { MaskedInput } from '@/components/ui/masked-input'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { cn } from '@/lib/utils'

interface ProcedureOverride {
  selected: boolean
  durationMin: number
  defaultPrice: string // masked currency string, e.g. "150,00"
}

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120] as const

const CATEGORY_LABEL: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor',
  biostimulator: 'Bioestimulador',
  skinbooster: 'Skinbooster',
  peel: 'Peeling',
  laser: 'Laser',
  microagulhamento: 'Microagulhamento',
  outros: 'Outros',
}

interface ProcedureTypeItem {
  id: string
  name: string
  category: string
  description: string | null
  defaultPrice: string | null
  estimatedDurationMin: number | null
  isActive: boolean
}

const STEPS = [
  { label: 'Clínica', icon: Building2Icon },
  { label: 'Procedimentos', icon: SyringeIcon },
  { label: 'Produtos', icon: PackageIcon },
  { label: 'Equipe', icon: UsersIcon },
]

interface OnboardingWizardProps {
  tenantName: string
  existingProcedureTypes: ProcedureTypeItem[]
  existingProducts?: Product[]
}

export function OnboardingWizard({
  tenantName,
  existingProcedureTypes,
  existingProducts = [],
}: OnboardingWizardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [currentStep, setCurrentStep] = useState(0)

  // Step 1 state: clinic info
  const [clinicData, setClinicData] = useState<Record<string, unknown>>({
    name: tenantName || '',
    phone: '',
    email: '',
    address: {},
    workingHours: DEFAULT_WORKING_HOURS,
  })

  // Step 2 state: procedure types (local selection before onboarding completes)
  const [procedureOverrides, setProcedureOverrides] = useState<ProcedureOverride[]>(() =>
    DEFAULT_PROCEDURE_TYPES.map((pt) => ({
      selected: true,
      durationMin: pt.estimatedDurationMin,
      defaultPrice: '',
    })),
  )
  const [showAddProcedure, setShowAddProcedure] = useState(false)

  // Step 3 state: products — pre-select the first product of each category
  // that matches a selected procedure type. Re-compute when procedures change,
  // but only until the user manually touches the product selection.
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

  const [selectedProductNames, setSelectedProductNames] = useState<Set<string>>(() =>
    computeDefaultProductSelection(DEFAULT_PROCEDURE_TYPES.map(() => true)),
  )
  const [productsTouched, setProductsTouched] = useState(false)
  const [customProducts, setCustomProducts] = useState<ProductStepItem[]>([])
  const productsAlreadyConfigured = (existingProducts?.length ?? 0) > 0

  // Step 4 state: track sent invites count
  const [invitesSent, setInvitesSent] = useState(0)

  const handleClinicChange = useCallback((data: Record<string, unknown>) => {
    setClinicData(data)
  }, [])

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

  function handleNext() {
    if (currentStep === 0) {
      if (!clinicData.name || (clinicData.name as string).trim().length === 0) {
        toast.error('Nome da clínica é obrigatório')
        return
      }
    }
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1))
  }

  function handlePrev() {
    setCurrentStep(prev => Math.max(prev - 1, 0))
  }

  function handleComplete() {
    startTransition(async () => {
      const procedureTypes = DEFAULT_PROCEDURE_TYPES.flatMap((pt, i) => {
        const override = procedureOverrides[i]
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

      // Build selectedProducts — strip UI-only `origin` from defaults and `isCustom` from customs
      const selectedProducts = [
        ...DEFAULT_PRODUCTS.filter((p) => selectedProductNames.has(p.name)).map((p) => ({
          name: p.name,
          category: p.category,
          activeIngredient: p.activeIngredient,
          defaultUnit: p.defaultUnit,
        })),
        ...customProducts.map((p) => ({
          name: p.name,
          category: p.category,
          activeIngredient: p.activeIngredient,
          defaultUnit: p.defaultUnit,
        })),
      ]

      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic: {
            name: (clinicData.name as string) || tenantName,
            phone: (clinicData.phone as string) || undefined,
            email: (clinicData.email as string) || undefined,
            address: (clinicData.address as Record<string, string>) || undefined,
            workingHours: (clinicData.workingHours as WorkingHours) || DEFAULT_WORKING_HOURS,
          },
          procedureTypes,
          selectedProducts,
        }),
      })

      const result = await res.json()

      if (result?.success) {
        toast.success('Configuracao concluida! Bem-vindo ao FloraClin.')
        router.push('/dashboard')
      } else {
        toast.error(result?.error || 'Erro ao completar o onboarding')
      }
    })
  }

  // Slug preview from clinic name
  const slug = (clinicData.name as string || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        {/* Header */}
        <div className="mb-12 text-center animate-fade-in-up">
          <h1 className="text-4xl text-charcoal sm:text-5xl font-semibold tracking-tight">
            Bem-vindo ao <span className="font-display text-forest">Flora</span><span className="font-display text-sage">Clin</span>
          </h1>
          <p className="mt-3 text-mid text-base">
            Configure sua clínica em poucos passos
          </p>
          <button
            type="button"
            onClick={() => logout()}
            className="mt-3 inline-flex items-center gap-1 text-xs text-mid/50 hover:text-mid transition-colors"
          >
            <LogOutIcon className="h-3 w-3" />
            Sair
          </button>
        </div>

        {/* Stepper */}
        <div className="mb-10 animate-fade-in-up-delay-1">
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
                  className="relative z-10 flex flex-1 flex-col items-center gap-2"
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
                    className={`text-xs font-medium tracking-wide transition-colors duration-300 ${
                      isCurrent ? 'text-forest' : isCompleted ? 'text-sage' : 'text-mid/50'
                    }`}
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
          className="animate-fade-in-up border-blush/30 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-8 sm:p-10"
        >
          {/* Step 1: Clinic Settings */}
          {currentStep === 0 && (
            <div>
              <h2 className="text-xl font-medium text-charcoal mb-1 tracking-tight">
                Dados da Clínica
              </h2>
              <p className="text-sm text-mid mb-8">
                Preencha as informações básicas e configure o horário de funcionamento.
              </p>

              <ClinicSettingsForm
                initialData={{
                  name: (clinicData.name as string) || tenantName,
                  phone: (clinicData.phone as string) || '',
                  email: (clinicData.email as string) || '',
                  address: (clinicData.address as Record<string, string>) || null,
                  workingHours: (clinicData.workingHours as WorkingHours) || DEFAULT_WORKING_HOURS,
                }}
                embedded
                onChange={handleClinicChange}
              />

              {slug && (
                <div className="mt-6 rounded-[3px] bg-[#F0F7F1] border border-sage/20 p-4">
                  <p className="text-xs text-mid uppercase tracking-wider mb-1">
                    Link de agendamento online
                  </p>
                  <p className="text-sm font-medium text-forest">
                    floraclin.com.br/c/{slug}
                  </p>
                </div>
              )}
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
                              className="w-full rounded-md border border-sage/30 bg-white px-2 py-1 text-sm text-charcoal focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest/30 disabled:bg-[#F4F6F8]"
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
                                className="h-auto w-full rounded-md border border-sage/30 bg-white py-1 pl-8 pr-2 text-sm text-charcoal focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest/30 disabled:bg-[#F4F6F8]"
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
                    Procedimentos ja cadastrados
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
                Convide profissionais e recepcionistas para usar o sistema. Este passo e opcional.
              </p>

              {invitesSent > 0 && (
                <div className="mb-6 rounded-lg bg-sage/10 border border-sage/20 p-4 flex items-center gap-3 animate-fade-in-up">
                  <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0">
                    <CheckIcon className="h-4 w-4 text-sage" />
                  </div>
                  <p className="text-sm text-sage font-medium">
                    {invitesSent} {invitesSent === 1 ? 'convite enviado' : 'convites enviados'} com sucesso.
                  </p>
                </div>
              )}

              {/* Reuse InviteUserForm -- invites are sent immediately via inviteUserAction */}
              <div className="rounded-lg border border-blush/30 p-5 bg-white">
                <InviteUserForm
                  onSuccess={() => {
                    setInvitesSent(prev => prev + 1)
                  }}
                />
              </div>
            </div>
          )}
        </Card>

        {/* Navigation Buttons */}
        <div className="mt-8 flex items-center justify-between animate-fade-in-up-delay-2">
          <div>
            {currentStep > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={handlePrev}
                disabled={isPending}
                className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                data-testid="onboarding-prev"
              >
                Anterior
              </Button>
            )}
          </div>

          <div className="flex gap-3">
            {currentStep === 3 && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleComplete}
                disabled={isPending}
                className="text-mid hover:text-sage transition-colors duration-200"
                data-testid="onboarding-skip"
              >
                {invitesSent > 0 ? 'Continuar sem mais convites' : 'Pular por enquanto'}
              </Button>
            )}

            {currentStep < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={handleNext}
                className="bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium transition-all duration-300 shadow-sm hover:shadow-md px-8"
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
                className={`bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium transition-all duration-300 shadow-md hover:shadow-lg px-8 ${
                  !isPending ? 'animate-subtle-pulse' : ''
                }`}
              >
                {isPending ? 'Finalizando...' : 'Começar a usar'}
              </Button>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-12 text-center text-gold/50 text-[11px] tracking-wider">
          floraclin.com.br
        </p>
      </div>
    </div>
  )
}

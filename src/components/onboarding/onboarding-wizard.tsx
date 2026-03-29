'use client'

import { useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ClinicSettingsForm } from '@/components/settings/clinic-settings-form'
import { ProcedureTypeList } from '@/components/settings/procedure-type-list'
import { ProcedureTypeForm } from '@/components/settings/procedure-type-form'
import { InviteUserForm } from '@/components/settings/invite-user-form'
import { completeOnboarding } from '@/actions/onboarding'
import { DEFAULT_PROCEDURE_TYPES, DEFAULT_WORKING_HOURS } from '@/lib/constants'
import { toast } from 'sonner'
import { CheckIcon, Building2Icon, SyringeIcon, UsersIcon } from 'lucide-react'
import type { WorkingHours } from '@/validations/tenant'

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
  { label: 'Equipe', icon: UsersIcon },
]

interface OnboardingWizardProps {
  tenantName: string
  existingProcedureTypes: ProcedureTypeItem[]
}

export function OnboardingWizard({ tenantName, existingProcedureTypes }: OnboardingWizardProps) {
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
  const [selectedDefaults, setSelectedDefaults] = useState<boolean[]>(
    DEFAULT_PROCEDURE_TYPES.map(() => true)
  )
  const [showAddProcedure, setShowAddProcedure] = useState(false)

  // Step 3 state: track sent invites count
  const [invitesSent, setInvitesSent] = useState(0)

  const handleClinicChange = useCallback((data: Record<string, unknown>) => {
    setClinicData(data)
  }, [])

  function toggleDefault(index: number) {
    setSelectedDefaults(prev => {
      const next = [...prev]
      next[index] = !next[index]
      return next
    })
  }

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
      const procedureTypes = DEFAULT_PROCEDURE_TYPES
        .filter((_, i) => selectedDefaults[i])
        .map(pt => ({
          name: pt.name,
          category: pt.category,
          estimatedDurationMin: pt.estimatedDurationMin,
        }))

      const result = await completeOnboarding({
        clinic: {
          name: (clinicData.name as string) || tenantName,
          phone: (clinicData.phone as string) || undefined,
          email: (clinicData.email as string) || undefined,
          address: (clinicData.address as Record<string, string>) || undefined,
          workingHours: (clinicData.workingHours as WorkingHours) || DEFAULT_WORKING_HOURS,
        },
        procedureTypes,
      })

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

  const isLastStep = currentStep === STEPS.length - 1

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
        </div>

        {/* Stepper */}
        <div className="mb-10 animate-fade-in-up-delay-1">
          <div className="flex items-center justify-center">
            {STEPS.map((step, index) => {
              const isCompleted = index < currentStep
              const isCurrent = index === currentStep
              return (
                <div key={step.label} className="flex items-center">
                  {index > 0 && (
                    <div
                      className={`h-[2px] w-12 sm:w-24 transition-all duration-500 ${
                        isCompleted ? 'bg-sage' : 'bg-blush/40'
                      }`}
                    />
                  )}
                  <div className="flex flex-col items-center gap-2">
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

              {/* Default procedure types as checkboxes */}
              <div className="space-y-3 mb-8">
                <h3 className="text-xs font-medium text-mid uppercase tracking-wider">Procedimentos Sugeridos</h3>
                {DEFAULT_PROCEDURE_TYPES.map((pt, index) => (
                  <label
                    key={pt.name}
                    className={`flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-all duration-200 ${
                      selectedDefaults[index]
                        ? 'border-sage/40 bg-sage/5 shadow-sm'
                        : 'border-blush/40 hover:border-blush/60 bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDefaults[index]}
                      onChange={() => toggleDefault(index)}
                      className="h-4 w-4 rounded border-mid text-sage focus:ring-sage"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-charcoal">{pt.name}</span>
                      <span className="ml-2 text-xs text-mid">
                        ({pt.estimatedDurationMin} min)
                      </span>
                    </div>
                  </label>
                ))}
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

          {/* Step 3: Team Invites */}
          {currentStep === 2 && (
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
              >
                Anterior
              </Button>
            )}
          </div>

          <div className="flex gap-3">
            {currentStep === 2 && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleComplete}
                disabled={isPending}
                className="text-mid hover:text-sage transition-colors duration-200"
              >
                {invitesSent > 0 ? 'Continuar sem mais convites' : 'Pular por enquanto'}
              </Button>
            )}

            {currentStep < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={handleNext}
                className="bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium transition-all duration-300 shadow-sm hover:shadow-md px-8"
              >
                Próximo
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleComplete}
                disabled={isPending}
                className={`bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium transition-all duration-300 shadow-md hover:shadow-lg px-8 ${
                  !isPending ? 'animate-subtle-pulse' : ''
                }`}
              >
                {isPending ? 'Finalizando...' : 'Comecar a usar'}
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

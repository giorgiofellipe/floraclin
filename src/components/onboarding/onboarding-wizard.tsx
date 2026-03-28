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
        toast.success('Configuração concluída! Bem-vindo ao FloraClin.')
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
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl text-forest sm:text-4xl">
            Bem-vindo ao FloraClin
          </h1>
          <p className="mt-2 text-mid">
            Configure sua clínica em poucos passos
          </p>
        </div>

        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2">
            {STEPS.map((step, index) => {
              const StepIcon = step.icon
              const isCompleted = index < currentStep
              const isCurrent = index === currentStep
              return (
                <div key={step.label} className="flex items-center">
                  {index > 0 && (
                    <div
                      className={`mx-2 h-px w-8 sm:w-16 ${
                        isCompleted ? 'bg-sage' : 'bg-mid/20'
                      }`}
                    />
                  )}
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                        isCompleted
                          ? 'bg-sage text-cream'
                          : isCurrent
                            ? 'bg-forest text-cream'
                            : 'bg-petal text-mid'
                      }`}
                    >
                      {isCompleted ? (
                        <CheckIcon className="h-5 w-5" />
                      ) : (
                        <StepIcon className="h-5 w-5" />
                      )}
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        isCurrent ? 'text-forest' : 'text-mid'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Progress bar */}
          <div className="mt-4 h-1 w-full rounded-full bg-petal">
            <div
              className="h-1 rounded-full bg-sage transition-all duration-300"
              style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Step Content */}
        <Card className="p-6 sm:p-8">
          {/* Step 1: Clinic Settings */}
          {currentStep === 0 && (
            <div>
              <h2 className="text-xl text-forest mb-1">
                Dados da Clínica
              </h2>
              <p className="text-sm text-mid mb-6">
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
                <div className="mt-4 rounded-lg bg-petal p-3">
                  <p className="text-xs text-mid">
                    Link de agendamento online:
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
              <h2 className="text-xl text-forest mb-1">
                Tipos de Procedimento
              </h2>
              <p className="text-sm text-mid mb-6">
                Selecione os procedimentos que sua clínica oferece. Você pode adicionar mais depois.
              </p>

              {/* Default procedure types as checkboxes */}
              <div className="space-y-3 mb-6">
                <h3 className="text-sm font-medium text-foreground">Procedimentos Sugeridos</h3>
                {DEFAULT_PROCEDURE_TYPES.map((pt, index) => (
                  <label
                    key={pt.name}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      selectedDefaults[index]
                        ? 'border-sage bg-sage/5'
                        : 'border-border'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDefaults[index]}
                      onChange={() => toggleDefault(index)}
                      className="h-4 w-4 rounded border-mid text-sage focus:ring-sage"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-foreground">{pt.name}</span>
                      <span className="ml-2 text-xs text-mid">
                        ({pt.estimatedDurationMin} min)
                      </span>
                    </div>
                  </label>
                ))}
              </div>

              {/* Existing procedure types (if any were already created via the dialog) */}
              {existingProcedureTypes.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-3">
                    Procedimentos já cadastrados
                  </h3>
                  <ProcedureTypeList
                    procedureTypes={existingProcedureTypes}
                    embedded
                  />
                </div>
              )}

              {/* Add custom procedure type */}
              <div className="border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddProcedure(prev => !prev)}
                  className="mb-3"
                >
                  Adicionar outro procedimento
                </Button>
                {showAddProcedure && (
                  <div className="rounded-lg border p-4">
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
              <h2 className="text-xl text-forest mb-1">
                Convide sua Equipe
              </h2>
              <p className="text-sm text-mid mb-6">
                Convide profissionais e recepcionistas para usar o sistema. Este passo é opcional.
              </p>

              {invitesSent > 0 && (
                <div className="mb-4 rounded-lg bg-sage/10 p-3">
                  <p className="text-sm text-sage">
                    {invitesSent} {invitesSent === 1 ? 'convite enviado' : 'convites enviados'} com sucesso.
                  </p>
                </div>
              )}

              {/* Reuse InviteUserForm -- invites are sent immediately via inviteUserAction */}
              <div className="rounded-lg border p-4">
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
        <div className="mt-6 flex items-center justify-between">
          <div>
            {currentStep > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={handlePrev}
                disabled={isPending}
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
              >
                {invitesSent > 0 ? 'Continuar sem mais convites' : 'Pular por enquanto'}
              </Button>
            )}

            {currentStep < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={handleNext}
                className="bg-forest text-cream hover:bg-sage"
              >
                Próximo
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleComplete}
                disabled={isPending}
                className="bg-forest text-cream hover:bg-sage"
              >
                {isPending ? 'Finalizando...' : 'Começar a usar'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

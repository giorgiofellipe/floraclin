'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  STEP_LABELS,
  STEP_SUBTITLES,
  STEP_UNAVAILABLE_REASONS,
  type WizardStep,
} from '@/hooks/use-service-wizard'

interface WizardStepperProps {
  currentStep: WizardStep
  isStepAvailable: (step: WizardStep) => boolean
  isStepCompleted: (step: WizardStep) => boolean
  onStepClick: (step: WizardStep) => void
  disabled?: boolean
}

const STEPS: WizardStep[] = [1, 2, 3, 4, 5]

export function WizardStepper({
  currentStep,
  isStepAvailable,
  isStepCompleted,
  onStepClick,
  disabled,
}: WizardStepperProps) {
  return (
    <TooltipProvider>
      <nav
        aria-label="Etapas do atendimento"
        className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]"
      >
        {/* Desktop: horizontal */}
        <ol className="hidden md:flex items-center divide-x divide-gray-100">
          {STEPS.map((step) => {
            const available = isStepAvailable(step) && !disabled
            const completed = isStepCompleted(step)
            const isCurrent = step === currentStep

            return (
              <li key={step} className="flex-1">
                <StepItem
                  step={step}
                  available={available}
                  completed={completed}
                  isCurrent={isCurrent}
                  onClick={() => available && onStepClick(step)}
                />
              </li>
            )
          })}
        </ol>

        {/* Mobile: vertical */}
        <ol className="flex flex-col md:hidden divide-y divide-gray-100">
          {STEPS.map((step) => {
            const available = isStepAvailable(step) && !disabled
            const completed = isStepCompleted(step)
            const isCurrent = step === currentStep

            return (
              <li key={step}>
                <StepItem
                  step={step}
                  available={available}
                  completed={completed}
                  isCurrent={isCurrent}
                  onClick={() => available && onStepClick(step)}
                  vertical
                />
              </li>
            )
          })}
        </ol>
      </nav>
    </TooltipProvider>
  )
}

// ─── Individual step item ───────────────────────────────────────────

interface StepItemProps {
  step: WizardStep
  available: boolean
  completed: boolean
  isCurrent: boolean
  onClick: () => void
  vertical?: boolean
}

function StepItem({
  step,
  available,
  completed,
  isCurrent,
  onClick,
  vertical,
}: StepItemProps) {
  const content = (
    <div
      role="button"
      tabIndex={available ? 0 : -1}
      onClick={available ? onClick : undefined}
      onKeyDown={available ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      className={cn(
        'w-full text-left transition-colors',
        vertical ? 'flex items-center gap-3 px-4 py-3' : 'flex items-center gap-3 px-4 py-3',
        isCurrent && 'bg-forest/5',
        !available && 'cursor-not-allowed opacity-50',
        available && !isCurrent && 'hover:bg-petal/50 cursor-pointer',
      )}
      aria-current={isCurrent ? 'step' : undefined}
      aria-disabled={!available}
    >
      {/* Step indicator circle */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors',
          completed && 'bg-sage text-cream',
          isCurrent && !completed && 'bg-forest text-cream',
          !completed && !isCurrent && 'bg-gray-100 text-mid',
        )}
      >
        {completed ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          step
        )}
      </div>

      {/* Step text */}
      <div className="min-w-0">
        <p
          className={cn(
            'text-sm font-medium',
            isCurrent ? 'text-forest' : completed ? 'text-sage' : 'text-charcoal',
          )}
        >
          {STEP_LABELS[step]}
        </p>
        <p className="text-xs text-mid truncate">{STEP_SUBTITLES[step]}</p>
      </div>

      {/* Current step indicator (desktop) */}
      {isCurrent && !vertical && (
        <div className="ml-auto h-1 w-8 rounded-full bg-forest" />
      )}
    </div>
  )

  // Wrap unavailable steps with tooltip
  if (!available) {
    return (
      <Tooltip>
        <TooltipTrigger>
          {content}
        </TooltipTrigger>
        <TooltipContent>
          <p>{STEP_UNAVAILABLE_REASONS[step]}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return content
}

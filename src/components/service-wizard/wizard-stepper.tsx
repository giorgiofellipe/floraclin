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
        className="flex items-center gap-1"
      >
        {STEPS.map((step, i) => {
          const available = isStepAvailable(step) && !disabled
          const completed = isStepCompleted(step)
          const isCurrent = step === currentStep

          const indicator = (
            <button
              key={step}
              type="button"
              onClick={available ? () => onStepClick(step) : undefined}
              disabled={!available}
              className={cn(
                'group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-all duration-200',
                isCurrent && 'bg-forest text-cream shadow-sm',
                completed && !isCurrent && 'bg-sage/15 text-sage hover:bg-sage/25 cursor-pointer',
                !completed && !isCurrent && available && 'text-mid hover:bg-[#F4F6F8] cursor-pointer',
                !available && 'text-mid/30 cursor-not-allowed',
              )}
              aria-current={isCurrent ? 'step' : undefined}
              aria-disabled={!available}
            >
              {/* Step dot/check */}
              <span className={cn(
                'flex size-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                isCurrent && 'bg-cream/20 text-cream',
                completed && !isCurrent && 'bg-sage text-cream',
                !completed && !isCurrent && 'bg-mid/10 text-mid/60',
              )}>
                {completed ? <Check className="size-3" /> : step}
              </span>
              {/* Label — always visible on desktop, hidden on mobile except current */}
              <span className={cn(
                'hidden sm:inline',
                isCurrent && 'inline', // always show current step label
              )}>
                {STEP_LABELS[step]}
              </span>
            </button>
          )

          return (
            <div key={step} className="flex items-center">
              {!available ? (
                <Tooltip>
                  <TooltipTrigger render={indicator} />
                  <TooltipContent>
                    <p>{STEP_UNAVAILABLE_REASONS[step] || STEP_LABELS[step]}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                indicator
              )}
              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div className={cn(
                  'w-3 sm:w-5 h-px mx-0.5',
                  isStepCompleted(step) ? 'bg-sage/40' : 'bg-mid/15',
                )} />
              )}
            </div>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}

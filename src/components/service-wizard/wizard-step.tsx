'use client'

import { format } from 'date-fns'

interface WizardStepProps {
  title: string
  timestamp?: Date | null
  children: React.ReactNode
}

export function WizardStep({ title, timestamp, children }: WizardStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-charcoal">{title}</h2>
        {timestamp && (
          <span className="text-sm text-mid">
            Ultima atualizacao: {format(new Date(timestamp), "dd/MM/yyyy")} as{' '}
            {format(new Date(timestamp), 'HH:mm')}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

'use client'

import { CheckCircle2 } from 'lucide-react'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'

interface AnamnesisSectionProps {
  value: string
  title: string
  isComplete?: boolean
  children: React.ReactNode
}

export function AnamnesisSection({
  value,
  title,
  isComplete = false,
  children,
}: AnamnesisSectionProps) {
  return (
    <AccordionItem
      value={value}
      className={cn(
        'rounded-xl border px-5 mb-3 transition-all duration-200 overflow-hidden',
        isComplete
          ? 'border-sage/20 bg-sage/[0.02] shadow-sm'
          : 'border-sage/10 bg-white shadow-sm hover:shadow-md'
      )}
    >
      <AccordionTrigger className="py-4 hover:no-underline">
        <div className="flex items-center gap-2.5">
          {isComplete ? (
            <div className="flex size-5 items-center justify-center rounded-full bg-sage/15">
              <CheckCircle2 className="size-3.5 text-sage shrink-0" />
            </div>
          ) : (
            <div className="size-5 rounded-full border-2 border-sage/20 shrink-0" />
          )}
          <span className={cn(
            'text-sm font-medium transition-colors',
            isComplete ? 'text-forest' : 'text-charcoal'
          )}>
            {title}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-5 pt-1">
        {children}
      </AccordionContent>
    </AccordionItem>
  )
}

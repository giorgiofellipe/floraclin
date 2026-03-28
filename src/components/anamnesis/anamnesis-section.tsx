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
    <AccordionItem value={value} className="rounded-lg border px-4 mb-2">
      <AccordionTrigger className="py-3 hover:no-underline">
        <div className="flex items-center gap-2">
          {isComplete && (
            <CheckCircle2 className="size-4 text-green-600 shrink-0" />
          )}
          <span className={cn('text-sm font-medium', isComplete && 'text-green-700')}>
            {title}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        {children}
      </AccordionContent>
    </AccordionItem>
  )
}

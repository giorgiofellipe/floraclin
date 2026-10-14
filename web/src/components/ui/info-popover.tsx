'use client'

import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface InfoPopoverProps {
  content: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * Shows `content` on hover (mouse) or tap (touch), where a native `title` never shows.
 * Disabled controls inside stay disabled; their taps fall through to this trigger.
 */
export function InfoPopover({ content, className, children }: InfoPopoverProps) {
  if (!content) return children

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        nativeButton={false}
        render={<span className={cn('inline-flex [&_:disabled]:pointer-events-none', className)} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-72 text-xs">{content}</PopoverContent>
    </Popover>
  )
}

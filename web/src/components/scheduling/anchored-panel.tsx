'use client'

import * as React from 'react'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useIsTouch } from '@/hooks/use-is-mobile'
import { cn } from '@/lib/utils'

interface AnchoredPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: Element | null
  /** Read by screen readers; shown as the sheet heading on touch. */
  title: string
  children: React.ReactNode
  className?: string
  testId?: string
}

/**
 * A small panel next to what was tapped: a popover with a mouse, a bottom
 * sheet in thumb reach on touch screens.
 */
export function AnchoredPanel({ open, onOpenChange, anchor, title, children, className, testId }: AnchoredPanelProps) {
  const touch = useIsTouch()

  if (touch) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          data-testid={testId}
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-topbar-border" aria-hidden />
          <SheetTitle className="sr-only">{title}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        aria-label={title}
        className={cn('w-80 max-h-(--available-height) overflow-y-auto p-3', className)}
        data-testid={testId}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Mobile sheet with a bounded scrolling body; desktop retains a centered dialog. */
export function ReconciliationDialogContent({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <DialogContent showCloseButton={false} className="top-auto bottom-0 left-0 flex h-[92dvh] max-h-[92dvh] min-w-0 max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:h-auto sm:max-h-[90dvh] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-b-xl">
      <DialogHeader className="shrink-0 flex-row items-center justify-between border-b p-4">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <DialogClose render={<Button variant="ghost" className="size-11 focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2" />} aria-label="Fechar">
          <XIcon />
        </DialogClose>
      </DialogHeader>
      {children}
    </DialogContent>
  )
}

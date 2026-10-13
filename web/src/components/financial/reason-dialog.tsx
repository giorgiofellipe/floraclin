'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  reasonLabel: string
  reason: string
  onReasonChange: (reason: string) => void
  reasonTestId: string
  confirmLabel: string
  pendingLabel: string
  isPending: boolean
  destructive?: boolean
  onConfirm: () => void
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel,
  reason,
  onReasonChange,
  reasonTestId,
  confirmLabel,
  pendingLabel,
  isPending,
  destructive = false,
  onConfirm,
}: ReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-charcoal">{title}</DialogTitle>
          <DialogDescription className="text-mid">{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">{reasonLabel}</Label>
            <Textarea
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Informe o motivo..."
              rows={3}
              data-testid={reasonTestId}
            />
          </div>
        </div>
        <DialogFooter className="pt-2">
          <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            className={destructive ? undefined : 'bg-forest text-cream hover:bg-sage transition-colors'}
            onClick={onConfirm}
            disabled={isPending || !reason.trim()}
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { closePackageSchema, closeReasonLabels, closeReasonValues, type ClosePackageFormValues } from '@/validations/encerrar-pacote'
import { useClosePackage } from '@/hooks/queries/use-packages'
import type { z } from 'zod'

type ClosePackageFormInput = z.input<typeof closePackageSchema>

interface ClosePackageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  packageId: string
}

export function ClosePackageDialog({ open, onOpenChange, packageId }: ClosePackageDialogProps) {
  const { mutateAsync, isPending } = useClosePackage()
  const form = useForm<ClosePackageFormInput, unknown, ClosePackageFormValues>({
    resolver: zodResolver(closePackageSchema),
    defaultValues: { closedReason: 'patient_lost_expiry', closeNote: '' },
  })
  const reason = form.watch('closedReason')
  const onSubmit = async (values: ClosePackageFormValues) => {
    await mutateAsync({ packageId, body: values })
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Encerrar pacote</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-sm text-muted-foreground">Encerrar este pacote sem usar as sessões restantes?</p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo</label>
            <Select value={reason} onValueChange={(v) => form.setValue('closedReason', v as ClosePackageFormInput['closedReason'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {closeReasonValues.map((r) => (
                  <SelectItem key={r} value={r}>{closeReasonLabels[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reason === 'other' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Detalhes</label>
              <Textarea {...form.register('closeNote')} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Encerrando…' : 'Encerrar pacote'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

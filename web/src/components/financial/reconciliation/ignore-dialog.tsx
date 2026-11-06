'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIgnoreLine, type StatementLineView } from '@/hooks/queries/use-bank-reconciliation'

export function IgnoreDialog({ line, onClose }: { line: StatementLineView | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(line)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">{line && <IgnoreForm line={line} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function IgnoreForm({ line, onClose }: { line: StatementLineView; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const ignore = useIgnoreLine()

  async function handleSave() {
    try {
      await ignore.mutateAsync({ lineId: line.id, reason })
      toast.success('Lançamento ignorado')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ignorar o lançamento')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ignorar lançamento</DialogTitle>
        <DialogDescription>
          “{line.memo}” sai da fila de pendentes, mas continua no extrato importado. Você pode restaurá-lo depois.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        <Label htmlFor="ignore-reason">Motivo</Label>
        <Input id="ignore-reason" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: lançamento duplicado pelo banco" />
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button onClick={handleSave} disabled={!reason.trim() || ignore.isPending}>
          {ignore.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Ignorar
        </Button>
      </DialogFooter>
    </>
  )
}

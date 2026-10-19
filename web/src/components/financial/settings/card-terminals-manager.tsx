'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCardTerminals, useDeleteCardTerminal } from '@/hooks/queries/use-card-terminals'
import type { CardTerminalRow } from '@/db/queries/card-terminals'
import { CardTerminalDialog } from './card-terminal-dialog'

function describeTerminal(row: CardTerminalRow): string {
  const credit =
    row.creditPayoutMode === 'lump_sum'
      ? `Crédito em valor único, D+${row.creditLumpSumDays}`
      : 'Crédito por parcela (D+30, D+60...)'
  return `${credit} · Débito D+${row.debitPayoutDays}`
}

export function CardTerminalsManager() {
  const { data, isLoading } = useCardTerminals()
  const terminals = data?.data ?? []
  const deleteTerminal = useDeleteCardTerminal()

  // null: closed; { terminal: null }: creating; { terminal }: editing that row.
  const [editing, setEditing] = useState<{ terminal: CardTerminalRow | null } | null>(null)
  const [toDelete, setToDelete] = useState<CardTerminalRow | null>(null)

  async function handleDelete() {
    if (!toDelete) return
    try {
      await deleteTerminal.mutateAsync(toDelete.id)
      toast.success('Maquininha excluída com sucesso')
      setToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir maquininha')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-sage" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">Maquininhas</h3>
        <div className="flex-1 h-px bg-topbar-border" />
      </div>

      <div className="space-y-1">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-content-bg transition-colors"
          >
            <span className="flex-1 text-sm text-charcoal">
              {terminal.name}
              {terminal.isDefault && (
                <span className="ml-2 rounded bg-sage/10 px-1.5 py-0.5 text-xs text-sage">
                  Padrão
                </span>
              )}
              <span className="text-mid"> · {describeTerminal(terminal)}</span>
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Editar ${terminal.name}`}
                onClick={() => setEditing({ terminal })}
              >
                <PencilIcon className="h-3.5 w-3.5 text-mid" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Excluir ${terminal.name}`}
                onClick={() => setToDelete(terminal)}
              >
                <Trash2Icon className="h-3.5 w-3.5 text-mid" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEditing({ terminal: null })}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Adicionar maquininha
      </Button>

      <CardTerminalDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        terminal={editing?.terminal}
      />

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir maquininha</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a maquininha &ldquo;{toDelete?.name}&rdquo;? Vendas já
              registradas não são afetadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteTerminal.isPending}>
              {deleteTerminal.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2Icon className="h-4 w-4" />
              )}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

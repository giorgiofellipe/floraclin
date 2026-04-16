'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { IconPicker } from './icon-picker'
import { useCreateExpenseCategory } from '@/hooks/mutations/use-financial-settings-mutations'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

interface CreateCategoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (categoryId: string) => void
}

export function CreateCategoryModal({
  open,
  onOpenChange,
  onCreated,
}: CreateCategoryModalProps) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('circle')
  const [error, setError] = useState<string | null>(null)
  const createCategory = useCreateExpenseCategory()

  function handleClose() {
    setName('')
    setIcon('circle')
    setError(null)
    onOpenChange(false)
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)

    try {
      const result = await createCategory.mutateAsync({ name: trimmed, icon })
      toast.success('Categoria criada com sucesso')
      const newId = result?.data?.id
      if (newId) onCreated(newId)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar categoria')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova Categoria</DialogTitle>
          <DialogDescription>
            Crie uma categoria para organizar suas despesas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">
              Nome
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da categoria"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">
              Ícone
            </Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={createCategory.isPending || !name.trim()}
          >
            {createCategory.isPending ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              'Criar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

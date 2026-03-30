'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ProcedureTypeForm } from './procedure-type-form'
import { updateProcedureTypeAction, deleteProcedureTypeAction } from '@/actions/tenants'
import { useInvalidation } from '@/hooks/queries/use-invalidation'
import { formatCurrency } from '@/lib/utils'
import { PROCEDURE_CATEGORIES } from '@/lib/constants'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { PlusIcon, PencilIcon, Trash2Icon, ClipboardListIcon } from 'lucide-react'

const CATEGORY_LABELS: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchimento',
  biostimulator: 'Bioestimulador',
  peel: 'Peeling',
  skinbooster: 'Skinbooster',
  laser: 'Laser',
  microagulhamento: 'Microagulhamento',
  outros: 'Outros',
}

const CATEGORY_COLORS: Record<string, string> = {
  botox: 'bg-sage/10 text-sage border-sage/20',
  filler: 'bg-amber-light text-amber-dark border-amber-mid/20',
  biostimulator: 'bg-mint/15 text-forest border-mint/25',
  peel: 'bg-blush text-charcoal border-blush',
  skinbooster: 'bg-petal text-sage border-sage/20',
  laser: 'bg-gold/10 text-amber-dark border-gold/20',
  microagulhamento: 'bg-sage/10 text-forest border-sage/20',
  outros: 'bg-petal text-mid border-blush',
}

interface ProcedureType {
  id: string
  name: string
  category: string
  description: string | null
  defaultPrice: string | null
  estimatedDurationMin: number | null
  isActive: boolean
}

interface ProcedureTypeListProps {
  procedureTypes: ProcedureType[]
  /** When embedded in wizard, simplifies the layout */
  embedded?: boolean
  /** Map of procedure type ID to whether a template exists */
  templateStatusMap?: Record<string, boolean>
}

export function ProcedureTypeList({ procedureTypes: initialTypes, embedded = false, templateStatusMap }: ProcedureTypeListProps) {
  const router = useRouter()
  const { invalidateProcedureTypes } = useInvalidation()
  const [isPending, startTransition] = useTransition()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingType, setEditingType] = useState<ProcedureType | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  function handleToggleActive(pt: ProcedureType) {
    startTransition(async () => {
      const result = await updateProcedureTypeAction({
        id: pt.id,
        name: pt.name,
        category: pt.category as (typeof PROCEDURE_CATEGORIES)[number],
        isActive: !pt.isActive,
      })
      if (result?.success) {
        toast.success(pt.isActive ? 'Procedimento desativado' : 'Procedimento ativado')
        invalidateProcedureTypes()
      } else {
        toast.error(result?.error || 'Erro ao atualizar')
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteProcedureTypeAction(id)
      if (result?.success) {
        toast.success('Procedimento excluído')
        invalidateProcedureTypes()
        setDeleteConfirm(null)
      } else {
        toast.error(result?.error || 'Erro ao excluir')
      }
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {initialTypes.length} {initialTypes.length === 1 ? 'procedimento cadastrado' : 'procedimentos cadastrados'}
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <PlusIcon data-icon="inline-start" />
            Novo Procedimento
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Novo Tipo de Procedimento</DialogTitle>
            </DialogHeader>
            <ProcedureTypeForm
              onSuccess={() => setCreateOpen(false)}
              onCancel={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialTypes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum tipo de procedimento cadastrado.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Clique em &ldquo;Novo Procedimento&rdquo; para adicionar.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              {!embedded && <TableHead>Ficha</TableHead>}
              {!embedded && <TableHead>Preço</TableHead>}
              <TableHead>Duração</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialTypes.map((pt) => (
              <TableRow key={pt.id} className={!pt.isActive ? 'opacity-50' : ''}>
                <TableCell className="font-medium">{pt.name}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[pt.category] || CATEGORY_COLORS.outros}`}>
                    {CATEGORY_LABELS[pt.category] || pt.category}
                  </span>
                </TableCell>
                {!embedded && (
                  <TableCell>
                    {templateStatusMap?.[pt.id] ? (
                      <span className="inline-flex items-center rounded-full bg-[#F0F7F1] px-2.5 py-0.5 text-xs font-medium text-sage">
                        Ficha configurada
                      </span>
                    ) : (
                      <span className="text-xs text-mid">Sem ficha</span>
                    )}
                  </TableCell>
                )}
                {!embedded && (
                  <TableCell>
                    {pt.defaultPrice
                      ? formatCurrency(parseFloat(pt.defaultPrice))
                      : '-'}
                  </TableCell>
                )}
                <TableCell>
                  {pt.estimatedDurationMin ? `${pt.estimatedDurationMin} min` : '-'}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={pt.isActive}
                    onCheckedChange={() => handleToggleActive(pt)}
                    size="sm"
                    disabled={isPending}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => router.push(`/configuracoes/avaliacao/${pt.id}`)}
                      title="Ficha de Avaliação"
                    >
                      <ClipboardListIcon />
                    </Button>
                    <Dialog
                      open={editingType?.id === pt.id}
                      onOpenChange={(open) => {
                        if (!open) setEditingType(null)
                      }}
                    >
                      <DialogTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditingType(pt)}
                          />
                        }
                      >
                        <PencilIcon />
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Editar Procedimento</DialogTitle>
                        </DialogHeader>
                        <ProcedureTypeForm
                          initialData={pt}
                          onSuccess={() => setEditingType(null)}
                          onCancel={() => setEditingType(null)}
                        />
                      </DialogContent>
                    </Dialog>

                    {deleteConfirm === pt.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={() => handleDelete(pt.id)}
                          disabled={isPending}
                        >
                          Confirmar
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteConfirm(pt.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { PackageTemplateForm } from './package-template-form'
import {
  useDeletePackageTemplate,
  useUpdatePackageTemplate,
  type PackageTemplate,
} from '@/hooks/queries/use-packages'

interface PackageTemplateListProps {
  templates: PackageTemplate[]
  isLoading?: boolean
}

export function PackageTemplateList({
  templates,
  isLoading,
}: PackageTemplateListProps) {
  const updateMutation = useUpdatePackageTemplate()
  const deleteMutation = useDeletePackageTemplate()
  const isPending = updateMutation.isPending || deleteMutation.isPending

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<PackageTemplate | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function handleToggleActive(tpl: PackageTemplate) {
    try {
      await updateMutation.mutateAsync({
        id: tpl.id,
        isActive: !tpl.isActive,
      })
      toast.success(
        tpl.isActive ? 'Modelo desativado' : 'Modelo ativado',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success('Modelo de pacote excluído')
      setDeleteConfirm(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {templates.length}{' '}
          {templates.length === 1 ? 'modelo cadastrado' : 'modelos cadastrados'}
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <PlusIcon data-icon="inline-start" />
            Novo modelo
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Novo modelo de pacote</DialogTitle>
            </DialogHeader>
            <PackageTemplateForm
              onSuccess={() => setCreateOpen(false)}
              onCancel={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">Carregando modelos...</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum modelo de pacote cadastrado.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Clique em &ldquo;Novo modelo&rdquo; para adicionar.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Procedimentos</TableHead>
              <TableHead>Preço sugerido</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((tpl) => (
              <TableRow
                key={tpl.id}
                className={!tpl.isActive ? 'opacity-50' : ''}
              >
                <TableCell className="font-medium">{tpl.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {tpl.lines.map((line) => (
                      <span
                        key={line.id}
                        className="inline-flex items-center rounded-full border border-sage/20 bg-sage/10 px-2 py-0.5 text-xs text-sage"
                      >
                        {line.procedureTypeName} · {line.sessionsCount}x
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {tpl.defaultPrice
                    ? formatCurrency(parseFloat(tpl.defaultPrice))
                    : '-'}
                </TableCell>
                <TableCell>
                  {tpl.validityMonths
                    ? `${tpl.validityMonths} ${tpl.validityMonths === 1 ? 'mês' : 'meses'}`
                    : '-'}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={tpl.isActive}
                    onCheckedChange={() => handleToggleActive(tpl)}
                    size="sm"
                    disabled={isPending}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Dialog
                      open={editing?.id === tpl.id}
                      onOpenChange={(open) => {
                        if (!open) setEditing(null)
                      }}
                    >
                      <DialogTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditing(tpl)}
                          />
                        }
                      >
                        <PencilIcon />
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-xl">
                        <DialogHeader>
                          <DialogTitle>Editar modelo de pacote</DialogTitle>
                        </DialogHeader>
                        <PackageTemplateForm
                          initialData={tpl}
                          onSuccess={() => setEditing(null)}
                          onCancel={() => setEditing(null)}
                        />
                      </DialogContent>
                    </Dialog>

                    {deleteConfirm === tpl.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={() => handleDelete(tpl.id)}
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
                        onClick={() => setDeleteConfirm(tpl.id)}
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

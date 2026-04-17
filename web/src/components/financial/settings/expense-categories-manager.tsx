'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import {
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  useDeleteExpenseCategory,
} from '@/hooks/mutations/use-financial-settings-mutations'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  LockIcon,
  Loader2Icon,
  CheckIcon,
  XIcon,
} from 'lucide-react'
import { IconPicker } from '@/components/financial/expenses/icon-picker'
import { getExpenseIcon } from '@/components/financial/expenses/expense-icon-options'

interface ExpenseCategory {
  id: string
  name: string
  icon: string
  isSystem: boolean
}

export function ExpenseCategoriesManager() {
  const { data: categoriesResponse, isLoading } = useExpenseCategories()
  const categories = categoriesResponse?.data ?? []
  const createCategory = useCreateExpenseCategory()
  const updateCategory = useUpdateExpenseCategory()
  const deleteCategory = useDeleteExpenseCategory()

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('circle')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState('circle')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<ExpenseCategory | null>(null)

  async function handleAdd() {
    if (!newName.trim()) return
    try {
      await createCategory.mutateAsync({ name: newName.trim(), icon: newIcon })
      toast.success('Categoria criada com sucesso')
      setNewName('')
      setNewIcon('circle')
      setShowAddForm(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar categoria')
    }
  }

  function startEdit(category: ExpenseCategory) {
    setEditingId(category.id)
    setEditName(category.name)
    setEditIcon(category.icon)
  }

  async function handleUpdate() {
    if (!editingId || !editName.trim()) return
    try {
      await updateCategory.mutateAsync({ id: editingId, name: editName.trim(), icon: editIcon })
      toast.success('Categoria atualizada com sucesso')
      setEditingId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar categoria')
    }
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
    setEditIcon('circle')
  }

  function confirmDelete(category: ExpenseCategory) {
    setCategoryToDelete(category)
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!categoryToDelete) return
    try {
      await deleteCategory.mutateAsync(categoryToDelete.id)
      toast.success('Categoria excluída com sucesso')
      setDeleteDialogOpen(false)
      setCategoryToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir categoria')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-[#4A6B52]" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
          Categorias de Despesa
        </h3>
        <div className="flex-1 h-px bg-[#E8ECEF]" />
      </div>

      {/* Category list */}
      <div className="space-y-1">
        {(categories as ExpenseCategory[]).map((category) => {
          const Icon = getExpenseIcon(category.icon)
          const isEditing = editingId === category.id

          if (isEditing) {
            return (
              <div
                key={category.id}
                className="p-3 rounded-lg bg-[#F4F6F8] border border-[#E8ECEF] space-y-3"
              >
                <div className="flex items-center gap-3">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={handleUpdate}
                    disabled={updateCategory.isPending}
                  >
                    <CheckIcon className="h-4 w-4 text-[#4A6B52]" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={cancelEdit}>
                    <XIcon className="h-4 w-4 text-mid" />
                  </Button>
                </div>
                <IconPicker value={editIcon} onChange={setEditIcon} />
              </div>
            )
          }

          return (
            <div
              key={category.id}
              className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[#F4F6F8] transition-colors group"
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#4A6B52]/10">
                <Icon className="h-3.5 w-3.5 text-[#4A6B52]" />
              </div>
              <span className="flex-1 text-sm text-[#2A2A2A]">{category.name}</span>
              {category.isSystem ? (
                <LockIcon className="h-3.5 w-3.5 text-mid" />
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => startEdit(category)}
                  >
                    <PencilIcon className="h-3.5 w-3.5 text-mid" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => confirmDelete(category)}
                  >
                    <Trash2Icon className="h-3.5 w-3.5 text-mid" />
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add form */}
      {showAddForm ? (
        <div className="p-3 rounded-lg bg-[#F4F6F8] border border-[#E8ECEF] space-y-3">
          <div className="flex items-center gap-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da categoria"
              className="flex-1"
              autoFocus
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={handleAdd}
              disabled={createCategory.isPending || !newName.trim()}
            >
              <CheckIcon className="h-4 w-4 text-[#4A6B52]" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setShowAddForm(false)
                setNewName('')
                setNewIcon('circle')
              }}
            >
              <XIcon className="h-4 w-4 text-mid" />
            </Button>
          </div>
          <IconPicker value={newIcon} onChange={setNewIcon} />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(true)}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Adicionar Categoria
        </Button>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Categoria</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a categoria &ldquo;{categoryToDelete?.name}&rdquo;?
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteCategory.isPending}
            >
              {deleteCategory.isPending ? (
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

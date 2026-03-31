'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
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
  HomeIcon,
  PackageIcon,
  UsersIcon,
  MegaphoneIcon,
  MonitorIcon,
  ReceiptIcon,
  BriefcaseIcon,
  WrenchIcon,
  CircleIcon,
  WalletIcon,
  CarIcon,
  CoffeeIcon,
  PhoneIcon,
  GlobeIcon,
  HeartIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const ICON_OPTIONS: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: 'home', label: 'Casa', Icon: HomeIcon },
  { value: 'package', label: 'Pacote', Icon: PackageIcon },
  { value: 'users', label: 'Pessoas', Icon: UsersIcon },
  { value: 'megaphone', label: 'Megafone', Icon: MegaphoneIcon },
  { value: 'monitor', label: 'Monitor', Icon: MonitorIcon },
  { value: 'receipt', label: 'Recibo', Icon: ReceiptIcon },
  { value: 'briefcase', label: 'Maleta', Icon: BriefcaseIcon },
  { value: 'wrench', label: 'Ferramenta', Icon: WrenchIcon },
  { value: 'circle', label: 'Circulo', Icon: CircleIcon },
  { value: 'wallet', label: 'Carteira', Icon: WalletIcon },
  { value: 'car', label: 'Carro', Icon: CarIcon },
  { value: 'coffee', label: 'Cafe', Icon: CoffeeIcon },
  { value: 'phone', label: 'Telefone', Icon: PhoneIcon },
  { value: 'globe', label: 'Globo', Icon: GlobeIcon },
  { value: 'heart', label: 'Coracao', Icon: HeartIcon },
]

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  ICON_OPTIONS.map((opt) => [opt.value, opt.Icon])
)

function getCategoryIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] || CircleIcon
}

interface ExpenseCategory {
  id: string
  name: string
  icon: string
  isSystem: boolean
}

export function ExpenseCategoriesManager() {
  const { data: categories = [], isLoading } = useExpenseCategories()
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
      toast.success('Categoria excluida com sucesso')
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
          const Icon = getCategoryIcon(category.icon)
          const isEditing = editingId === category.id

          if (isEditing) {
            return (
              <div
                key={category.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-[#F4F6F8] border border-[#E8ECEF]"
              >
                <Select value={editIcon} onValueChange={setEditIcon}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map((opt) => {
                      const OptIcon = opt.Icon
                      return (
                        <SelectItem key={opt.value} value={opt.value}>
                          <OptIcon className="h-3.5 w-3.5 inline mr-1.5" />
                          {opt.label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
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
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#F4F6F8] border border-[#E8ECEF]">
          <Select value={newIcon} onValueChange={setNewIcon}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ICON_OPTIONS.map((opt) => {
                const OptIcon = opt.Icon
                return (
                  <SelectItem key={opt.value} value={opt.value}>
                    <OptIcon className="h-3.5 w-3.5 inline mr-1.5" />
                    {opt.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
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
              Esta acao nao pode ser desfeita.
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

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useToggleProductActive,
  useToggleProductDiagram,
} from '@/hooks/mutations/use-product-mutations'

import { toast } from 'sonner'
import { PlusIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { PROCEDURE_CATEGORY_LABELS as CATEGORY_LABELS } from '@/lib/constants'

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

interface Product {
  id: string
  name: string
  category: string
  activeIngredient: string | null
  defaultUnit: string
  isActive: boolean
  showInDiagram: boolean
}

interface ProductListProps {
  products: Product[]
}

interface ProductFormData {
  name: string
  category: string
  activeIngredient: string
  defaultUnit: string
}

function ProductFormDialog({
  open,
  onOpenChange,
  initialData,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: Product | null
  onSuccess: () => void
}) {
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const isPending = createProduct.isPending || updateProduct.isPending
  const [form, setForm] = useState<ProductFormData>({
    name: initialData?.name ?? '',
    category: initialData?.category ?? 'botox',
    activeIngredient: initialData?.activeIngredient ?? '',
    defaultUnit: initialData?.defaultUnit ?? 'U',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return

    try {
      if (initialData) {
        await updateProduct.mutateAsync({
          id: initialData.id,
          name: form.name.trim(),
          category: form.category,
          activeIngredient: form.activeIngredient.trim() || undefined,
          defaultUnit: form.defaultUnit,
        })
      } else {
        await createProduct.mutateAsync({
          name: form.name.trim(),
          category: form.category,
          activeIngredient: form.activeIngredient.trim() || undefined,
          defaultUnit: form.defaultUnit,
        })
      }
      toast.success(initialData ? 'Produto atualizado' : 'Produto criado')
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar produto')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initialData ? 'Editar Produto' : 'Novo Produto'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="uppercase tracking-wider text-xs text-mid">Nome *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Botox Allergan 100U"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="uppercase tracking-wider text-xs text-mid">Categoria *</Label>
            <Select
              items={CATEGORY_LABELS}
              value={form.category}
              onValueChange={(val) => val && setForm((f) => ({ ...f, category: val }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="uppercase tracking-wider text-xs text-mid">Princípio Ativo</Label>
            <Input
              value={form.activeIngredient}
              onChange={(e) => setForm((f) => ({ ...f, activeIngredient: e.target.value }))}
              placeholder="Ex: Toxina botulínica tipo A"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="uppercase tracking-wider text-xs text-mid">Unidade Padrão</Label>
            <div className="flex h-9 overflow-hidden rounded-lg border border-input">
              <button
                type="button"
                className={`flex-1 px-4 text-sm font-medium transition-colors ${
                  form.defaultUnit === 'U'
                    ? 'bg-forest text-cream'
                    : 'bg-transparent hover:bg-petal text-charcoal'
                }`}
                onClick={() => setForm((f) => ({ ...f, defaultUnit: 'U' }))}
              >
                U (Unidades)
              </button>
              <button
                type="button"
                className={`flex-1 px-4 text-sm font-medium transition-colors ${
                  form.defaultUnit === 'mL'
                    ? 'bg-forest text-cream'
                    : 'bg-transparent hover:bg-petal text-charcoal'
                }`}
                onClick={() => setForm((f) => ({ ...f, defaultUnit: 'mL' }))}
              >
                mL
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || !form.name.trim()}
              className="bg-forest text-cream hover:bg-sage"
            >
              {isPending ? 'Salvando...' : initialData ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProductList({ products: initialProducts }: ProductListProps) {
  const toggleActive = useToggleProductActive()
  const toggleDiagram = useToggleProductDiagram()
  const deleteProduct = useDeleteProduct()
  const isPending = toggleActive.isPending || toggleDiagram.isPending || deleteProduct.isPending
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function handleToggleActive(product: Product) {
    try {
      await toggleActive.mutateAsync({ id: product.id, isActive: !product.isActive })
      toast.success(product.isActive ? 'Produto desativado' : 'Produto ativado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar')
    }
  }

  async function handleToggleDiagram(product: Product) {
    try {
      await toggleDiagram.mutateAsync({ id: product.id, showInDiagram: !product.showInDiagram })
      toast.success(product.showInDiagram ? 'Removido do diagrama' : 'Adicionado ao diagrama')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteProduct.mutateAsync(id)
      toast.success('Produto excluído')
      setDeleteConfirm(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {initialProducts.length} {initialProducts.length === 1 ? 'produto cadastrado' : 'produtos cadastrados'}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Novo Produto
        </Button>
      </div>

      {initialProducts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum produto cadastrado.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Clique em &ldquo;Novo Produto&rdquo; para adicionar.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Princípio Ativo</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead>Diagrama</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialProducts.map((product) => (
              <TableRow key={product.id} className={!product.isActive ? 'opacity-50' : ''}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[product.category] || CATEGORY_COLORS.outros}`}>
                    {CATEGORY_LABELS[product.category] || product.category}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-mid">
                  {product.activeIngredient || '-'}
                </TableCell>
                <TableCell>{product.defaultUnit}</TableCell>
                <TableCell>
                  <Switch
                    checked={product.isActive}
                    onCheckedChange={() => handleToggleActive(product)}
                    size="sm"
                    disabled={isPending}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={product.showInDiagram}
                    onCheckedChange={() => handleToggleDiagram(product)}
                    size="sm"
                    disabled={isPending || !product.isActive}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setEditingProduct(product)}
                    >
                      <PencilIcon />
                    </Button>
                    {deleteConfirm === product.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={() => handleDelete(product.id)}
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
                        onClick={() => setDeleteConfirm(product.id)}
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

      {/* Create dialog */}
      <ProductFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => { setCreateOpen(false) }}
      />

      {/* Edit dialog */}
      {editingProduct && (
        <ProductFormDialog
          open={!!editingProduct}
          onOpenChange={(open) => { if (!open) setEditingProduct(null) }}
          initialData={editingProduct}
          onSuccess={() => { setEditingProduct(null) }}
        />
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useCreateTenant, useUpdateTenant } from '@/hooks/mutations/use-admin-tenant-mutations'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'

interface Tenant {
  id: string
  name: string
  slug: string
}

interface AdminTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenant: Tenant | null // null = create mode
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function AdminTenantDialog({ open, onOpenChange, tenant }: AdminTenantDialogProps) {
  const isEdit = !!tenant
  const createTenant = useCreateTenant()
  const updateTenant = useUpdateTenant()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  // Reset form when dialog opens/closes or tenant changes
  useEffect(() => {
    if (open) {
      setName(tenant?.name ?? '')
      setSlug(tenant?.slug ?? '')
      setOwnerEmail('')
      setOwnerName('')
      setSlugTouched(isEdit)
    }
  }, [open, tenant, isEdit])

  // Auto-generate slug from name in create mode
  const handleNameChange = useCallback(
    (value: string) => {
      setName(value)
      if (!slugTouched) {
        setSlug(generateSlug(value))
      }
    },
    [slugTouched],
  )

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true)
    setSlug(generateSlug(value))
  }, [])

  const isPending = createTenant.isPending || updateTenant.isPending

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      try {
        if (isEdit && tenant) {
          await updateTenant.mutateAsync({ id: tenant.id, name, slug })
          toast.success('Clínica atualizada')
        } else {
          await createTenant.mutateAsync({ name, slug, ownerEmail, ownerName })
          toast.success('Clínica criada')
        }
        onOpenChange(false)
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Erro ao salvar clínica',
        )
      }
    },
    [isEdit, tenant, name, slug, ownerEmail, ownerName, createTenant, updateTenant, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar Clínica' : 'Nova Clínica'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenant-name">Nome</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Nome da clínica"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenant-slug">Slug</Label>
            <Input
              id="tenant-slug"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="slug-da-clinica"
              required
            />
          </div>

          {!isEdit && (
            <>
              <div className="space-y-2">
                <Label htmlFor="owner-email">E-mail do proprietário</Label>
                <Input
                  id="owner-email"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="proprietario@email.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-name">Nome do proprietário</Label>
                <Input
                  id="owner-name"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Nome completo"
                  required
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-forest text-cream hover:bg-sage transition-colors"
              disabled={isPending}
            >
              {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Salvar' : 'Criar Clínica'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

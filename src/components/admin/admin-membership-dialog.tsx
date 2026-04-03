'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAdminTenants } from '@/hooks/queries/use-admin-tenants'
import { useAddMembership } from '@/hooks/mutations/use-admin-user-mutations'

const ROLE_ITEMS: Record<string, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

interface AdminMembershipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  onSuccess?: () => void
}

export function AdminMembershipDialog({
  open,
  onOpenChange,
  userId,
  onSuccess,
}: AdminMembershipDialogProps) {
  const [tenantId, setTenantId] = useState('')
  const [role, setRole] = useState('')

  const { data: tenantsResult } = useAdminTenants('', 1)
  const addMembership = useAddMembership()

  const tenants = tenantsResult?.data ?? []
  const tenantItems: Record<string, string> = {}
  for (const t of tenants) {
    tenantItems[t.id] = t.name
  }

  const resetForm = () => {
    setTenantId('')
    setRole('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!tenantId || !role) {
      toast.error('Selecione a clínica e o papel')
      return
    }

    try {
      await addMembership.mutateAsync({
        id: userId,
        tenantId,
        role,
      })
      toast.success('Vínculo adicionado com sucesso')
      resetForm()
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao adicionar vínculo')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) resetForm()
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adicionar a clínica</DialogTitle>
          <DialogDescription>
            Vincule este usuário a uma clínica com um papel específico.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Clínica</Label>
            <Select
              items={tenantItems}
              value={tenantId}
              onValueChange={(v) => setTenantId(v ?? '')}
            >
              <SelectTrigger className="w-full border-sage/20 h-8 text-sm">
                <SelectValue placeholder="Selecione uma clínica" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Papel</Label>
            <Select
              items={ROLE_ITEMS}
              value={role}
              onValueChange={(v) => setRole(v ?? '')}
            >
              <SelectTrigger className="w-full border-sage/20 h-8 text-sm">
                <SelectValue placeholder="Selecione o papel" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="submit"
              className="bg-forest text-cream hover:bg-sage transition-colors"
              disabled={addMembership.isPending || !tenantId || !role}
            >
              {addMembership.isPending ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

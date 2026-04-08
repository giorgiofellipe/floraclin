'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useCreateAdminUser } from '@/hooks/mutations/use-admin-user-mutations'

const ROLE_ITEMS: Record<string, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

interface AdminUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AdminUserDialog({ open, onOpenChange }: AdminUserDialogProps) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [role, setRole] = useState('')

  const { data: tenantsResult } = useAdminTenants('', 1)
  const createUser = useCreateAdminUser()

  const tenants = tenantsResult?.data ?? []
  const tenantItems: Record<string, string> = {}
  for (const t of tenants) {
    tenantItems[t.id] = t.name
  }

  const resetForm = () => {
    setEmail('')
    setFullName('')
    setPhone('')
    setTenantId('')
    setRole('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email || !fullName) {
      toast.error('Preencha email e nome completo')
      return
    }

    try {
      await createUser.mutateAsync({
        email,
        fullName,
        phone: phone || undefined,
        tenantId: tenantId || undefined,
        role: role || undefined,
      })
      toast.success('Usuário criado com sucesso')
      resetForm()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar usuário')
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Usuário</DialogTitle>
          <DialogDescription>
            Crie um novo usuário na plataforma.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              placeholder="usuario@exemplo.com"
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-name">Nome completo</Label>
            <Input
              id="user-name"
              placeholder="Nome do usuário"
              value={fullName}
              onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-phone">Telefone (opcional)</Label>
            <Input
              id="user-phone"
              type="tel"
              placeholder="(00) 00000-0000"
              value={phone}
              onChange={(e) => setPhone((e.target as HTMLInputElement).value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Clínica (opcional)</Label>
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

          {tenantId && (
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
          )}

          <DialogFooter>
            <Button
              type="submit"
              className="bg-forest text-cream hover:bg-sage transition-colors"
              disabled={createUser.isPending}
            >
              {createUser.isPending ? 'Criando...' : 'Criar Usuário'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

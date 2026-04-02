'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useInviteUser } from '@/hooks/mutations/use-user-mutations'
import { toast } from 'sonner'
import type { Role } from '@/types'

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

const INVITABLE_ROLES: Role[] = ['practitioner', 'receptionist', 'financial']

interface InviteUserFormProps {
  onSuccess?: () => void
  onCancel?: () => void
}

export function InviteUserForm({ onSuccess, onCancel }: InviteUserFormProps) {
  const inviteUser = useInviteUser()
  const isPending = inviteUser.isPending
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<string>('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      await inviteUser.mutateAsync({ email, fullName, role })
      toast.success('Convite enviado com sucesso')
      setEmail('')
      setFullName('')
      setRole('')
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar convite')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="invite-name">Nome Completo *</Label>
        <Input
          id="invite-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nome do colaborador"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="invite-email">E-mail *</Label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemplo.com"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="invite-role">Papel *</Label>
        <Select items={ROLE_LABELS} value={role} onValueChange={(v) => setRole(v ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione o papel" />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isPending || !email || !fullName || !role}>
          {isPending ? 'Enviando...' : 'Enviar Convite'}
        </Button>
      </div>
    </form>
  )
}

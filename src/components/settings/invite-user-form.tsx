'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { inviteUserAction } from '@/actions/users'
import { useInvalidation } from '@/hooks/queries/use-invalidation'
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
  const { invalidateMembers } = useInvalidation()
  const [isPending, startTransition] = useTransition()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<string>('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    startTransition(async () => {
      const result = await inviteUserAction({
        email,
        fullName,
        role: role as Role,
      })

      if (result?.success) {
        toast.success('Convite enviado com sucesso')
        invalidateMembers()
        setEmail('')
        setFullName('')
        setRole('')
        onSuccess?.()
      } else {
        toast.error(result?.error || 'Erro ao enviar convite')
      }
    })
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
        <Select value={role} onValueChange={(v) => setRole(v ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione o papel">
              {(value: string) => ROLE_LABELS[value as Role] || value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {INVITABLE_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
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

'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { InviteUserForm } from './invite-user-form'
import { updateUserRoleAction, deactivateUserAction } from '@/actions/users'
import { toast } from 'sonner'
import { PlusIcon, UserXIcon } from 'lucide-react'
import type { Role } from '@/types'

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Proprietario',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

const ROLE_VARIANTS: Record<Role, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  practitioner: 'secondary',
  receptionist: 'outline',
  financial: 'outline',
}

const ROLE_COLORS: Record<Role, string> = {
  owner: 'bg-forest/10 text-forest border-forest/20',
  practitioner: 'bg-sage/10 text-sage border-sage/20',
  receptionist: 'bg-blush text-charcoal border-blush',
  financial: 'bg-gold/10 text-amber-dark border-gold/20',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

interface TeamMember {
  id: string
  tenantId: string
  userId: string
  role: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  user: {
    id: string
    email: string
    fullName: string
    phone: string | null
    avatarUrl: string | null
  }
}

interface TeamListProps {
  members: TeamMember[]
  currentUserId: string
  /** When embedded in wizard, simplifies the layout */
  embedded?: boolean
}

export function TeamList({ members, currentUserId, embedded = false }: TeamListProps) {
  const [isPending, startTransition] = useTransition()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deactivateConfirm, setDeactivateConfirm] = useState<string | null>(null)

  function handleRoleChange(userId: string, newRole: string) {
    startTransition(async () => {
      const result = await updateUserRoleAction({ userId, role: newRole as Role })
      if (result?.success) {
        toast.success('Papel atualizado')
      } else {
        toast.error(result?.error || 'Erro ao atualizar papel')
      }
    })
  }

  function handleDeactivate(userId: string) {
    startTransition(async () => {
      const result = await deactivateUserAction(userId)
      if (result?.success) {
        toast.success('Membro desativado')
        setDeactivateConfirm(null)
      } else {
        toast.error(result?.error || 'Erro ao desativar membro')
      }
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {members.filter(m => m.isActive).length} {members.filter(m => m.isActive).length === 1 ? 'membro ativo' : 'membros ativos'}
        </p>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <PlusIcon data-icon="inline-start" />
            Convidar Membro
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Convidar Membro da Equipe</DialogTitle>
            </DialogHeader>
            <InviteUserForm
              onSuccess={() => setInviteOpen(false)}
              onCancel={() => setInviteOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {members.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum membro na equipe.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Clique em &ldquo;Convidar Membro&rdquo; para adicionar.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
              {!embedded && <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isCurrentUser = member.userId === currentUserId
              const isOwner = member.role === 'owner'

              return (
                <TableRow key={member.id} className={!member.isActive ? 'opacity-50' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sage/15 text-sage text-xs font-semibold shrink-0">
                        {getInitials(member.user.fullName)}
                      </div>
                      <span className="font-medium text-charcoal">
                        {member.user.fullName}
                        {isCurrentUser && (
                          <span className="ml-1.5 text-xs text-mid font-normal">(você)</span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{member.user.email}</TableCell>
                  <TableCell>
                    {isOwner || isCurrentUser || !member.isActive ? (
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[member.role as Role] || 'bg-petal text-mid border-blush'}`}>
                        {ROLE_LABELS[member.role as Role] || member.role}
                      </span>
                    ) : (
                      <Select
                        value={member.role}
                        onValueChange={(value) => value && handleRoleChange(member.userId, value)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-[140px] h-7">
                          <SelectValue>
                            {(value: string) => ROLE_LABELS[value as Role] || value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="practitioner">
                            {ROLE_LABELS.practitioner}
                          </SelectItem>
                          <SelectItem value="receptionist">
                            {ROLE_LABELS.receptionist}
                          </SelectItem>
                          <SelectItem value="financial">
                            {ROLE_LABELS.financial}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.isActive ? 'secondary' : 'outline'}>
                      {member.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  {!embedded && (
                    <TableCell className="text-right">
                      {!isCurrentUser && !isOwner && member.isActive && (
                        <>
                          {deactivateConfirm === member.userId ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="destructive"
                                size="xs"
                                onClick={() => handleDeactivate(member.userId)}
                                disabled={isPending}
                              >
                                Confirmar
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setDeactivateConfirm(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeactivateConfirm(member.userId)}
                              title="Desativar membro"
                            >
                              <UserXIcon />
                            </Button>
                          )}
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

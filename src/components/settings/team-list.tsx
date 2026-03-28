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
  owner: 'Proprietário',
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {members.filter(m => m.isActive).length} {members.filter(m => m.isActive).length === 1 ? 'membro ativo' : 'membros ativos'}
        </h3>
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
                  <TableCell className="font-medium">
                    {member.user.fullName}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                    )}
                  </TableCell>
                  <TableCell>{member.user.email}</TableCell>
                  <TableCell>
                    {isOwner || isCurrentUser || !member.isActive ? (
                      <Badge variant={ROLE_VARIANTS[member.role as Role] || 'outline'}>
                        {ROLE_LABELS[member.role as Role] || member.role}
                      </Badge>
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

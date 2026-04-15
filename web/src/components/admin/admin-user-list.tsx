'use client'

import { useCallback, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, formatDate } from '@/lib/utils'
import { useAdminUsers } from '@/hooks/queries/use-admin-users'
import { useUpdateAdminUser, useResetPassword, useRemoveMembership } from '@/hooks/mutations/use-admin-user-mutations'
import { AdminUserDialog } from './admin-user-dialog'
import { AdminMembershipDialog } from './admin-membership-dialog'
import {
  ChevronDownIcon,
  PlusIcon,
  SearchIcon,
  UserIcon,
  TrashIcon,
  KeyIcon,
} from 'lucide-react'

interface Membership {
  tenantId: string
  tenantName: string
  role: string
  isActive: boolean
}

interface AdminUser {
  id: string
  email: string
  fullName: string
  phone?: string | null
  isPlatformAdmin: boolean
  createdAt: string
  memberships: Membership[]
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

const ROLE_BADGE_STYLES: Record<string, string> = {
  owner: 'bg-forest/10 text-forest',
  practitioner: 'bg-sage/10 text-sage',
  receptionist: 'bg-amber/10 text-amber',
  financial: 'bg-blue-50 text-blue-700',
}

const ROLE_ITEMS: Record<string, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

export function AdminUserList() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const search = searchParams.get('search') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [membershipDialogUserId, setMembershipDialogUserId] = useState<string | null>(null)

  const { data: result, isPending, isFetching } = useAdminUsers(search, page)
  const updateAdmin = useUpdateAdminUser()
  const resetPassword = useResetPassword()
  const removeMembership = useRemoveMembership()

  const users: AdminUser[] = result?.data ?? []
  const total = result?.total ?? 0
  const totalPages = result?.totalPages ?? 1

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      if (key !== 'page') params.set('page', '1')
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [searchParams, router],
  )

  const handleResetPassword = async (userId: string) => {
    try {
      await resetPassword.mutateAsync({ id: userId })
      toast.success('Link de redefinição de senha enviado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao resetar senha')
    }
  }

  const handleToggleAdmin = async (userId: string, isPlatformAdmin: boolean) => {
    try {
      await updateAdmin.mutateAsync({ id: userId, isPlatformAdmin })
      toast.success(isPlatformAdmin ? 'Usuário promovido a administrador' : 'Permissão de administrador removida')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar usuário')
    }
  }

  const handleRemoveMembership = async (userId: string, tenantId: string) => {
    try {
      await removeMembership.mutateAsync({ id: userId, tenantId })
      toast.success('Vínculo removido')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover vínculo')
    }
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative max-w-xs flex-1">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-mid pointer-events-none" />
            <Input
              placeholder="Buscar por nome ou email..."
              className="pl-8 border-sage/20 h-8 text-sm"
              value={search}
              onChange={(e) => updateParam('search', (e.target as HTMLInputElement).value)}
            />
          </div>
          <span className="text-xs text-mid tabular-nums ml-1 shrink-0">
            {total} {total === 1 ? 'usuário' : 'usuários'}
          </span>
        </div>

        <Button
          className="bg-forest text-cream hover:bg-sage transition-colors shadow-sm"
          onClick={() => setShowCreateDialog(true)}
          data-testid="admin-new-user"
        >
          <PlusIcon className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      {/* User cards */}
      <div className={cn('space-y-2 transition-opacity duration-200', isFetching && !isPending && 'opacity-60')}>
        {/* Loading */}
        {isPending && users.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <span className="flex items-center gap-2 text-sm text-mid">
              <span className="size-2 animate-pulse rounded-full bg-sage" />
              Carregando usuários...
            </span>
          </div>
        )}

        {/* Empty state */}
        {!isPending && users.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-sage/10 p-4 mb-4">
              <UserIcon className="h-6 w-6 text-sage" />
            </div>
            <p className="text-sm font-medium text-charcoal">Nenhum usuário encontrado</p>
            <p className="text-xs text-mid mt-1">Crie um novo usuário para começar</p>
          </div>
        )}

        {/* Cards */}
        {users.map((user) => {
          const isExpanded = expandedId === user.id

          return (
            <div
              key={user.id}
              data-testid={`admin-user-${user.id}`}
              className={cn(
                'group rounded-lg border bg-white transition-all duration-200',
                isExpanded
                  ? 'shadow-md border-sage/30 ring-1 ring-sage/20'
                  : 'border-[#E8ECEF] hover:border-sage/25 hover:shadow-sm',
              )}
            >
              {/* Main row */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : user.id)}
              >
                {/* Avatar placeholder */}
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sage/10 shrink-0">
                  <UserIcon className="h-3.5 w-3.5 text-sage" />
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-sm text-charcoal truncate">
                      {user.fullName}
                    </span>
                    <span className="text-xs text-mid shrink-0">
                      {formatDate(user.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-mid truncate">{user.email}</span>
                    {user.phone && (
                      <>
                        <span className="text-mid">·</span>
                        <span className="text-xs text-mid shrink-0">{user.phone}</span>
                      </>
                    )}
                  </div>
                  {/* Tenant badges */}
                  {user.memberships.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {user.memberships.map((m) => (
                        <span
                          key={m.tenantId}
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                            ROLE_BADGE_STYLES[m.role] ?? 'bg-neutral-100 text-neutral-600',
                          )}
                        >
                          {m.tenantName} · {ROLE_LABELS[m.role] ?? m.role}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Admin badge */}
                {user.isPlatformAdmin && (
                  <span className="inline-flex items-center rounded-full bg-forest/10 px-2 py-0.5 text-[10px] font-medium text-forest shrink-0">
                    Admin
                  </span>
                )}

                {/* Expand chevron */}
                <ChevronDownIcon
                  className={cn(
                    'h-4 w-4 text-mid transition-transform duration-200 shrink-0',
                    isExpanded && 'rotate-180',
                  )}
                />
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-sage/10 bg-[#FAFBFA] px-4 py-4 rounded-b-lg animate-in fade-in slide-in-from-top-1 duration-200 space-y-4">
                  {/* Memberships list */}
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-charcoal uppercase tracking-wider">
                      Vínculos com clínicas
                    </span>
                    {user.memberships.length === 0 && (
                      <p className="text-xs text-mid">Nenhum vínculo</p>
                    )}
                    {user.memberships.map((m) => (
                      <div
                        key={m.tenantId}
                        className="flex items-center gap-3 rounded-md border border-sage/10 bg-white px-3 py-2"
                      >
                        <span className="text-sm text-charcoal flex-1 min-w-0 truncate">
                          {m.tenantName}
                        </span>
                        <Select
                          items={ROLE_ITEMS}
                          value={m.role}
                          onValueChange={(v) => {
                            if (v && v !== m.role) {
                              // Role updates would go through a dedicated mutation if needed
                              toast.info('Alteração de role será implementada em breve')
                            }
                          }}
                        >
                          <SelectTrigger className="w-[140px] border-sage/20 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent />
                        </Select>
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={m.isActive}
                            onCheckedChange={() => {
                              toast.info('Toggle de ativo será implementado em breve')
                            }}
                            size="sm"
                          />
                          <Label className="text-[10px] text-mid">Ativo</Label>
                        </div>
                        <button
                          type="button"
                          className="p-1 text-mid hover:text-red-600 transition-colors"
                          onClick={() => handleRemoveMembership(user.id, m.tenantId)}
                          aria-label={`Remover vínculo com ${m.tenantName}`}
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-sage/20 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                      onClick={() => setMembershipDialogUserId(user.id)}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Adicionar a clínica
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-sage/20 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                      onClick={() => handleResetPassword(user.id)}
                      disabled={resetPassword.isPending}
                    >
                      <KeyIcon className="h-3.5 w-3.5" />
                      Resetar senha
                    </Button>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Switch
                        checked={user.isPlatformAdmin}
                        onCheckedChange={(checked) => handleToggleAdmin(user.id, !!checked)}
                        size="sm"
                      />
                      <Label className="text-xs text-mid cursor-pointer select-none">
                        Administrador
                      </Label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {users.length > 0 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="border-sage/20 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page <= 1}
            onClick={() => updateParam('page', String(page - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-mid tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-sage/20 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page >= totalPages}
            onClick={() => updateParam('page', String(page + 1))}
          >
            Próxima
          </Button>
        </div>
      )}

      {/* Create user dialog */}
      <AdminUserDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      {/* Add membership dialog */}
      <AdminMembershipDialog
        open={!!membershipDialogUserId}
        onOpenChange={(open) => {
          if (!open) setMembershipDialogUserId(null)
        }}
        userId={membershipDialogUserId ?? ''}
        onSuccess={() => setMembershipDialogUserId(null)}
      />
    </div>
  )
}

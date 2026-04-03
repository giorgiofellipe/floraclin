'use client'

import { Fragment, useCallback, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, formatDate } from '@/lib/utils'
import { useAdminTenants, useAdminTenantDetail } from '@/hooks/queries/use-admin-tenants'
import { useUpdateTenant } from '@/hooks/mutations/use-admin-tenant-mutations'
import { AdminTenantDialog } from './admin-tenant-dialog'
import { toast } from 'sonner'
import {
  ChevronDownIcon,
  PlusIcon,
  PencilIcon,
  BuildingIcon,
  UsersIcon,
  Loader2Icon,
} from 'lucide-react'

interface TenantUser {
  id: string
  fullName: string
  email: string
  role: string
  isActive: boolean
}

interface Tenant {
  id: string
  name: string
  slug: string
  isActive: boolean
  createdAt: string
  userCount: number
  patientCount?: number
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  doctor: 'Médico',
  receptionist: 'Recepcionista',
  owner: 'Proprietário',
}

export function AdminTenantList() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const search = searchParams.get('search') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)

  const { data: result, isPending, isFetching } = useAdminTenants(search, page)
  const updateTenant = useUpdateTenant()

  const tenants: Tenant[] = result?.data ?? []
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

  const handleToggleActive = useCallback(
    async (tenant: Tenant) => {
      try {
        await updateTenant.mutateAsync({
          id: tenant.id,
          isActive: !tenant.isActive,
        })
        toast.success(
          tenant.isActive ? 'Clínica desativada' : 'Clínica ativada',
        )
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Erro ao atualizar clínica',
        )
      }
    },
    [updateTenant],
  )

  const handleEdit = useCallback((tenant: Tenant) => {
    setEditingTenant(tenant)
    setDialogOpen(true)
  }, [])

  const handleCreate = useCallback(() => {
    setEditingTenant(null)
    setDialogOpen(true)
  }, [])

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <Input
            placeholder="Buscar clínicas..."
            value={search}
            onChange={(e) => updateParam('search', e.target.value)}
            className="max-w-xs border-sage/20"
          />
          <span className="text-xs text-mid tabular-nums shrink-0">
            {total} {total === 1 ? 'clínica' : 'clínicas'}
          </span>
        </div>

        <Button
          className="bg-forest text-cream hover:bg-sage transition-colors shadow-sm"
          onClick={handleCreate}
          data-testid="admin-new-tenant"
        >
          <PlusIcon className="h-4 w-4" />
          Nova Clínica
        </Button>
      </div>

      {/* Tenant list */}
      <div className={cn('space-y-2 transition-opacity duration-200', isFetching && !isPending && 'opacity-60')}>
        {/* Loading */}
        {isPending && tenants.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <span className="flex items-center gap-2 text-sm text-mid">
              <span className="size-2 animate-pulse rounded-full bg-sage" />
              Carregando clínicas...
            </span>
          </div>
        )}

        {/* Empty state */}
        {!isPending && tenants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-sage/10 p-4 mb-4">
              <BuildingIcon className="h-6 w-6 text-sage" />
            </div>
            <p className="text-sm font-medium text-charcoal">Nenhuma clínica encontrada</p>
            <p className="text-xs text-mid mt-1">Crie a primeira clínica para começar</p>
          </div>
        )}

        {/* Tenant cards */}
        {tenants.map((tenant) => {
          const isExpanded = expandedId === tenant.id

          return (
            <Fragment key={tenant.id}>
              <div
                data-testid={`admin-tenant-${tenant.id}`}
                className={cn(
                  'group rounded-lg border bg-white transition-all duration-200',
                  isExpanded
                    ? 'shadow-md border-sage/30'
                    : 'border-[#E8ECEF] hover:border-sage/25 hover:shadow-sm',
                )}
              >
                {/* Main row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Tenant icon */}
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sage/10 shrink-0">
                    <BuildingIcon className="h-3.5 w-3.5 text-sage" />
                  </div>

                  {/* Main content */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : tenant.id)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm text-charcoal truncate">
                        {tenant.name}
                      </span>
                      <span className="text-xs text-mid shrink-0">
                        {formatDate(tenant.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-mid truncate">{tenant.slug}</span>
                    </div>
                  </div>

                  {/* User count badge */}
                  <div className="hidden sm:flex items-center gap-1 shrink-0 rounded-full bg-sage/10 px-2 py-0.5">
                    <UsersIcon className="h-3 w-3 text-sage" />
                    <span className="text-[10px] font-medium text-sage tabular-nums">
                      {tenant.userCount}
                    </span>
                  </div>

                  {/* Status pill */}
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0',
                      tenant.isActive
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-neutral-100 text-neutral-500',
                    )}
                  >
                    {tenant.isActive ? 'Ativo' : 'Inativo'}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-mid hover:text-charcoal"
                      onClick={() => handleEdit(tenant)}
                      aria-label="Editar clínica"
                      data-testid="admin-tenant-edit"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={cn(
                        'text-xs',
                        tenant.isActive
                          ? 'text-mid hover:text-red-600'
                          : 'text-mid hover:text-emerald-600',
                      )}
                      onClick={() => handleToggleActive(tenant)}
                      disabled={updateTenant.isPending}
                      aria-label={tenant.isActive ? 'Desativar' : 'Ativar'}
                      data-testid="admin-tenant-toggle-active"
                    >
                      {updateTenant.isPending ? (
                        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <span className={cn(
                          'size-2 rounded-full',
                          tenant.isActive ? 'bg-emerald-400' : 'bg-neutral-400',
                        )} />
                      )}
                    </Button>
                  </div>

                  {/* Expand chevron */}
                  <button
                    type="button"
                    className="p-1 text-mid hover:text-charcoal transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : tenant.id)}
                    aria-label={isExpanded ? 'Recolher' : 'Expandir'}
                    data-testid="admin-tenant-expand"
                  >
                    <ChevronDownIcon className={cn(
                      'h-4 w-4 transition-transform duration-200',
                      isExpanded && 'rotate-180',
                    )} />
                  </button>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <TenantDetail tenantId={tenant.id} />
                )}
              </div>
            </Fragment>
          )
        })}
      </div>

      {/* Pagination */}
      {tenants.length > 0 && (
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

      {/* Create/Edit dialog */}
      <AdminTenantDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenant={editingTenant}
      />
    </div>
  )
}

/* ---------- Expanded detail sub-component ---------- */

function TenantDetail({ tenantId }: { tenantId: string }) {
  const { data, isPending } = useAdminTenantDetail(tenantId)

  if (isPending) {
    return (
      <div className="border-t border-sage/10 bg-[#FAFBFA] px-4 py-6 rounded-b-lg flex items-center justify-center">
        <span className="flex items-center gap-2 text-xs text-mid">
          <span className="size-2 animate-pulse rounded-full bg-sage" />
          Carregando detalhes...
        </span>
      </div>
    )
  }

  const users: TenantUser[] = data?.users ?? []
  const patientCount: number = data?.patientCount ?? 0
  const userCount: number = data?.userCount ?? users.length

  return (
    <div className="border-t border-sage/10 bg-[#FAFBFA] px-4 py-4 rounded-b-lg animate-in fade-in slide-in-from-top-1 duration-200">
      {/* Stats */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-mid">
          <UsersIcon className="h-3.5 w-3.5" />
          <span className="tabular-nums">{userCount}</span> usuário{userCount !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-mid">
          <span className="tabular-nums">{patientCount}</span> paciente{patientCount !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Users list */}
      {users.length > 0 ? (
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
            Usuários
          </span>
          <div className="space-y-1.5">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 rounded-md bg-white border border-sage/10 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-charcoal font-medium truncate block">
                    {user.fullName}
                  </span>
                  <span className="text-xs text-mid truncate block">
                    {user.email}
                  </span>
                </div>
                <span className="inline-flex items-center rounded-full bg-sage/10 px-1.5 py-px text-[10px] font-medium text-sage shrink-0">
                  {ROLE_LABELS[user.role] ?? user.role}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium shrink-0',
                    user.isActive
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-neutral-100 text-neutral-500',
                  )}
                >
                  {user.isActive ? 'Ativo' : 'Inativo'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-mid">Nenhum usuário cadastrado</p>
      )}
    </div>
  )
}

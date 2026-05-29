'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircle2Icon,
  MoreVerticalIcon,
  PlayIcon,
  XCircleIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { brToday } from '@/lib/dates'
import {
  useCancelPackage,
  type PatientPackageWithConsumption,
} from '@/hooks/queries/use-packages'
import { closeReasonLabels, type CloseReason } from '@/validations/encerrar-pacote'
import { ClosePackageDialog } from '@/components/packages/close-package-dialog'
import { SessionsTimeline } from '@/components/procedures/sessions-timeline'

interface PackageCardProps {
  patientId: string
  pkg: PatientPackageWithConsumption
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  expired: 'Expirado',
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-sage/10 text-sage border-sage/20',
  completed: 'bg-forest/10 text-forest border-forest/20',
  cancelled: 'bg-mid/10 text-mid border-mid/20',
  expired: 'bg-amber-light text-amber-dark border-amber-mid/20',
}

function formatBrDate(ymd: string): string {
  // ymd is YYYY-MM-DD; format as DD/MM/AAAA without UTC round-trip.
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return ymd
  return `${d}/${m}/${y}`
}

/**
 * Fetch the current auth context (incl. role) from `/api/auth/me`. Mirrors the
 * pattern in `use-tenant.ts` — a thin react-query wrapper around the server
 * endpoint. Inlined here because the only caller of PackageCard
 * (patient-packages-tab.tsx) does not currently pass role as a prop, and H1's
 * scope only allows touching this file.
 */
function useCurrentAuth() {
  return useQuery<{ role?: string }>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      if (!res.ok) throw new Error('Erro ao carregar usuário')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function PackageCard({ patientId, pkg }: PackageCardProps) {
  const cancelPackage = useCancelPackage(patientId)
  const { data: auth } = useCurrentAuth()
  const isOwner = auth?.role === 'owner'

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [closeOpen, setCloseOpen] = useState(false)

  const isActive = pkg.status === 'active'
  const today = brToday()
  const isExpiredByDate =
    pkg.status === 'expired' ||
    (pkg.expiresAt !== null && pkg.expiresAt < today)

  async function handleCancel() {
    if (!cancelReason.trim()) {
      toast.error('Informe o motivo do cancelamento')
      return
    }
    try {
      await cancelPackage.mutateAsync({ id: pkg.id, reason: cancelReason.trim() })
      toast.success('Pacote cancelado')
      setCancelOpen(false)
      setCancelReason('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cancelar')
    }
  }

  const statusLabel = STATUS_LABEL[pkg.status] ?? pkg.status
  const statusBadge = STATUS_BADGE[pkg.status] ?? STATUS_BADGE.active

  const totalAmount = parseFloat(pkg.totalAmount) || 0

  return (
    <div className="rounded-[3px] border border-[#E8ECEF] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-[#E8ECEF] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-medium text-charcoal">
              {pkg.name}
            </h3>
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider',
                statusBadge,
              )}
            >
              {statusLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mid">
            <span className="inline-flex items-center gap-1">
              <CalendarIcon className="size-3" />
              Comprado em {formatBrDate(pkg.purchasedAt)}
            </span>
            {pkg.expiresAt && (
              <span className="inline-flex items-center gap-1">
                Válido até {formatBrDate(pkg.expiresAt)}
              </span>
            )}
            <span className="font-medium text-charcoal tabular-nums">
              {formatCurrency(totalAmount)}
            </span>
          </div>
        </div>

        {isActive && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <MoreVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isOwner && (
                <DropdownMenuItem onClick={() => setCloseOpen(true)}>
                  <CheckCircle2Icon className="text-forest" />
                  Encerrar pacote
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setCancelOpen(true)}>
                <XCircleIcon className="text-destructive" />
                Cancelar pacote
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Expiry warning banner */}
      {isExpiredByDate && pkg.expiresAt && (
        <div className="border-b border-[#E8ECEF] bg-amber-light/40 px-5 py-2">
          <p className="flex items-center gap-1.5 text-[12px] text-amber-700">
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            Pacote vencido em {formatDate(pkg.expiresAt)} — sessões ainda podem
            ser realizadas até o encerramento.
          </p>
        </div>
      )}

      {/* Closed-package summary */}
      {pkg.closedAt && (
        <div className="border-b border-[#E8ECEF] bg-[#FAFBFC] px-5 py-2 text-[12px] text-mid">
          <p>
            Pacote encerrado em {formatDate(pkg.closedAt)}
            {pkg.closedReason && (
              <>
                {' '}— {closeReasonLabels[pkg.closedReason as CloseReason] ?? pkg.closedReason}
              </>
            )}
          </p>
          {pkg.closeNote && (
            <p className="mt-0.5 text-mid/80">{pkg.closeNote}</p>
          )}
        </div>
      )}

      {/* Cancellation reason (when cancelled) */}
      {pkg.status === 'cancelled' && pkg.cancelReason && (
        <div className="border-b border-[#E8ECEF] bg-[#FAFBFC] px-5 py-2 text-[12px] text-mid">
          <span className="font-medium text-charcoal">Motivo: </span>
          {pkg.cancelReason}
        </div>
      )}

      {/* Records */}
      <div className="divide-y divide-[#E8ECEF]">
        {pkg.records.map((record) => {
          const total = record.sessionsTotal
          const executed = record.sessionsExecuted
          const remaining = Math.max(0, total - executed)
          const allExecuted = executed >= total
          const canExecuteNext =
            executed < total &&
            (pkg.status === 'active' || pkg.status === 'expired') &&
            !pkg.closedAt

          return (
            <div key={record.procedureRecordId} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-charcoal">
                      {record.procedureTypeName}
                    </span>
                    {allExecuted && (
                      <CheckCircle2Icon className="size-3.5 text-forest" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-mid tabular-nums">
                    {record.procedureTypeName} · {executed}/{total}
                  </p>
                </div>

                {canExecuteNext && (
                  <Link
                    href={`/pacientes/${patientId}/atendimento?procedure=${record.procedureRecordId}&action=executeNext`}
                  >
                    <Button size="sm">
                      <PlayIcon data-icon="inline-start" />
                      Executar próxima sessão
                    </Button>
                  </Link>
                )}
              </div>

              <div className="mt-3">
                <SessionsTimeline
                  sessionsTotal={total}
                  sessionsExecuted={executed}
                  sessions={record.sessions ?? []}
                  procedureDetailHref={`/pacientes/${patientId}/procedimentos/${record.procedureRecordId}`}
                />
              </div>

              <p className="mt-2 text-[11px] text-mid">
                {remaining > 0
                  ? `${remaining} ${remaining === 1 ? 'sessão restante' : 'sessões restantes'}`
                  : 'Todas as sessões executadas'}
              </p>
            </div>
          )
        })}
      </div>

      {/* Close dialog (H5) */}
      <ClosePackageDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        packageId={pkg.id}
      />

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar pacote</DialogTitle>
            <DialogDescription>
              Esta ação é irreversível. Sessões já executadas serão mantidas no
              histórico, mas o pacote será marcado como cancelado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motivo *</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Descreva o motivo do cancelamento"
              rows={3}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCancelOpen(false)
                setCancelReason('')
              }}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelPackage.isPending || !cancelReason.trim()}
            >
              {cancelPackage.isPending ? 'Cancelando...' : 'Cancelar pacote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { cn, formatCurrency } from '@/lib/utils'
import {
  useCancelPackage,
  useStartPackageSession,
  type PatientPackageWithConsumption,
} from '@/hooks/queries/use-packages'

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

export function PackageCard({ patientId, pkg }: PackageCardProps) {
  const router = useRouter()
  const startSession = useStartPackageSession(patientId)
  const cancelPackage = useCancelPackage(patientId)

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const isActive = pkg.status === 'active'

  async function handleStartSession(lineId: string, allowExpiredOverride = false) {
    try {
      const result = await startSession.mutateAsync({
        patientPackageId: pkg.id,
        patientPackageLineId: lineId,
        allowExpiredOverride,
      })
      toast.success('Sessão iniciada')
      router.push(
        `/pacientes/${patientId}/procedimentos/${result.data.procedureRecordId}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao iniciar sessão')
    }
  }

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
              <DropdownMenuItem onClick={() => setCancelOpen(true)}>
                <XCircleIcon className="text-destructive" />
                Cancelar pacote
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Cancellation reason (when cancelled) */}
      {pkg.status === 'cancelled' && pkg.cancelReason && (
        <div className="border-b border-[#E8ECEF] bg-[#FAFBFC] px-5 py-2 text-[12px] text-mid">
          <span className="font-medium text-charcoal">Motivo: </span>
          {pkg.cancelReason}
        </div>
      )}

      {/* Lines */}
      <div className="divide-y divide-[#E8ECEF]">
        {pkg.lines.map((line) => {
          const consumed = line.consumedCount
          const total = line.sessionsTotal
          const executed = line.executedCount
          const remaining = Math.max(0, total - consumed)
          const pct = total > 0 ? Math.min(100, (consumed / total) * 100) : 0
          const allConsumed = consumed >= total
          const allExecuted = executed >= total

          return (
            <div key={line.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-charcoal">
                      {line.procedureTypeName}
                    </span>
                    {allExecuted && (
                      <CheckCircle2Icon className="size-3.5 text-forest" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-mid tabular-nums">
                    {executed}/{total} sessões executadas
                    {consumed > executed && (
                      <span className="ml-1 text-mid/70">
                        ({consumed - executed} em andamento)
                      </span>
                    )}
                  </p>
                </div>

                {isActive && !allConsumed && (
                  <Button
                    size="sm"
                    onClick={() => handleStartSession(line.id)}
                    disabled={startSession.isPending}
                  >
                    <PlayIcon data-icon="inline-start" />
                    Iniciar próxima sessão
                  </Button>
                )}

                {pkg.status === 'expired' && !allConsumed && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStartSession(line.id, true)}
                    disabled={startSession.isPending}
                  >
                    <AlertTriangleIcon data-icon="inline-start" />
                    Iniciar (expirado)
                  </Button>
                )}
              </div>

              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E8ECEF]">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    allExecuted ? 'bg-forest' : 'bg-sage',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="mt-1.5 text-[11px] text-mid">
                {remaining > 0
                  ? `${remaining} ${remaining === 1 ? 'sessão restante' : 'sessões restantes'}`
                  : 'Todas as sessões consumidas'}
              </p>
            </div>
          )
        })}
      </div>

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

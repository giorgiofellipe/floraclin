'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ChevronRight,
  User,
  CheckCircle2,
  Play,
  Pencil,
  XCircle,
  Eye,
  Calendar,
  Ban,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { PROCEDURE_STATUS_COLORS, PROCEDURE_STATUS_LABELS } from '@/lib/constants'
import { cancelProcedureAction } from '@/actions/procedures'
import type { ProcedureListItem } from '@/db/queries/procedures'

// ─── Category Icons ────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  toxina_botulinica: 'TB',
  botox: 'TB',
  preenchimento: 'AH',
  filler: 'AH',
  bioestimulador: 'BE',
  biostimulator: 'BE',
}

// ─── Component ──────────────────────────────────────────────────────

interface ProcedureCardProps {
  procedure: ProcedureListItem
  patientId: string
  onClick?: () => void
  onStatusChange?: () => void
}

export function ProcedureCard({
  procedure,
  patientId,
  onClick,
  onStatusChange,
}: ProcedureCardProps) {
  const router = useRouter()
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const statusColor =
    PROCEDURE_STATUS_COLORS[procedure.status] ?? PROCEDURE_STATUS_COLORS.planned
  const statusLabel =
    PROCEDURE_STATUS_LABELS[procedure.status] ?? procedure.status
  const categoryCode =
    CATEGORY_ICONS[procedure.procedureTypeCategory.toLowerCase()] ?? 'PR'

  const basePath = `/pacientes/${patientId}/procedimentos/${procedure.id}`

  // ─── Handlers ──────────────────────────────────────────────────

  const handleApprove = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(`${basePath}?action=approve`)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(basePath)
  }

  const handleExecute = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(`${basePath}?action=execute`)
  }

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(basePath)
  }

  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCancelDialogOpen(true)
  }

  const handleCancelConfirm = async () => {
    if (!cancelReason.trim()) return
    setCancelling(true)
    try {
      const result = await cancelProcedureAction(procedure.id, cancelReason.trim())
      if (result.success) {
        setCancelDialogOpen(false)
        setCancelReason('')
        onStatusChange?.()
      } else {
        toast.error(result.error ?? 'Erro ao cancelar procedimento')
      }
    } finally {
      setCancelling(false)
    }
  }

  // ─── Financial plan summary ────────────────────────────────────

  const financialPlan = procedure.financialPlan as {
    totalAmount?: number
    installmentCount?: number
    paymentMethod?: string
    notes?: string
  } | null

  // ─── Border color by status ────────────────────────────────────

  const borderColorByStatus: Record<string, string> = {
    planned: 'border-l-amber',
    approved: 'border-l-sage',
    executed: 'border-l-forest',
    cancelled: 'border-l-mid/30',
  }

  const borderColor =
    borderColorByStatus[procedure.status] ?? 'border-l-sage'

  return (
    <>
      <Card
        className={cn(
          'cursor-pointer transition-colors duration-200',
          `border-l-[3px] ${borderColor} bg-white border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]`
        )}
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Category icon */}
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[3px] bg-sage/10">
              <span className="text-xs font-bold text-forest tracking-wide">
                {categoryCode}
              </span>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              {/* Title row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-[14px] font-medium text-[#2A2A2A]">
                    {procedure.procedureTypeName}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-mid">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      {format(
                        new Date(procedure.performedAt),
                        "dd/MM/yyyy",
                        { locale: ptBR }
                      )}
                    </span>
                    <span className="text-sage/30">|</span>
                    <span className="flex items-center gap-1">
                      <User className="size-3 text-sage" />
                      {procedure.practitionerName}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  <Badge
                    className={cn(
                      statusColor,
                      'px-2.5 py-0.5 text-[11px] font-medium border-0'
                    )}
                  >
                    {statusLabel}
                  </Badge>
                  <ChevronRight className="size-4 text-mid/50 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>

              {/* Status-specific content */}
              <div className="mt-2">
                {(procedure.status === 'planned' ||
                  procedure.status === 'approved') && (
                  <>
                    {financialPlan && financialPlan.totalAmount && (
                      <p className="text-xs text-mid">
                        Valor:{' '}
                        <span className="font-medium text-charcoal">
                          {new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(financialPlan.totalAmount)}
                        </span>
                        {financialPlan.installmentCount &&
                          financialPlan.installmentCount > 1 && (
                            <span className="ml-1">
                              em {financialPlan.installmentCount}x
                            </span>
                          )}
                      </p>
                    )}
                    {procedure.status === 'approved' &&
                      procedure.approvedAt && (
                        <p className="text-xs text-sage mt-1">
                          Aprovado em{' '}
                          {format(
                            new Date(procedure.approvedAt),
                            "dd/MM/yyyy",
                            { locale: ptBR }
                          )}
                        </p>
                      )}
                  </>
                )}

                {procedure.status === 'executed' && (
                  <>
                    {procedure.technique && (
                      <p className="text-xs text-mid/80 italic truncate">
                        {procedure.technique}
                      </p>
                    )}
                    <p className="text-xs text-mid mt-0.5">
                      Executado em{' '}
                      {format(
                        new Date(procedure.performedAt),
                        "dd/MM/yyyy 'as' HH:mm",
                        { locale: ptBR }
                      )}
                    </p>
                  </>
                )}

                {procedure.status === 'cancelled' && (
                  <>
                    {procedure.cancellationReason && (
                      <p className="text-xs text-mid truncate">
                        Motivo: {procedure.cancellationReason}
                      </p>
                    )}
                    {procedure.cancelledAt && (
                      <p className="text-xs text-mid/60 mt-0.5">
                        Cancelado em{' '}
                        {format(
                          new Date(procedure.cancelledAt),
                          "dd/MM/yyyy",
                          { locale: ptBR }
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="mt-3 flex items-center gap-2">
                {procedure.status === 'planned' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-sage text-sage hover:bg-sage/10"
                      onClick={handleApprove}
                    >
                      <CheckCircle2 className="mr-1 size-3" />
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-mid/30 text-mid hover:bg-petal"
                      onClick={handleEdit}
                    >
                      <Pencil className="mr-1 size-3" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-mid/30 text-mid hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                      onClick={handleCancelClick}
                    >
                      <XCircle className="mr-1 size-3" />
                      Cancelar
                    </Button>
                  </>
                )}

                {procedure.status === 'approved' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-forest text-forest hover:bg-sage/10"
                      onClick={handleExecute}
                    >
                      <Play className="mr-1 size-3" />
                      Registrar Execução
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-mid/30 text-mid hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                      onClick={handleCancelClick}
                    >
                      <XCircle className="mr-1 size-3" />
                      Cancelar
                    </Button>
                  </>
                )}

                {(procedure.status === 'executed' ||
                  procedure.status === 'cancelled') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-mid/30 text-mid hover:bg-petal"
                    onClick={handleViewDetails}
                  >
                    <Eye className="mr-1 size-3" />
                    Ver Detalhes
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent
          className="sm:max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-charcoal">
              <Ban className="size-5 text-red-500" />
              Cancelar Procedimento
            </DialogTitle>
            <DialogDescription className="text-mid text-sm">
              Informe o motivo do cancelamento. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Textarea
              placeholder="Motivo do cancelamento..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCancelDialogOpen(false)
                setCancelReason('')
              }}
              className="border-mid/30 text-mid"
            >
              Voltar
            </Button>
            <Button
              onClick={handleCancelConfirm}
              disabled={!cancelReason.trim() || cancelling}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {cancelling ? 'Cancelando...' : 'Confirmar Cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

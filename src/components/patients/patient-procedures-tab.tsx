'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Loader2,
  Plus,
  Syringe,
  Calendar,
  CheckCircle2,
  Pencil,
  XCircle,
  Play,
  Eye,
  Ban,
} from 'lucide-react'
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
import { cn, formatDateTime } from '@/lib/utils'
import { PROCEDURE_STATUS_COLORS, PROCEDURE_STATUS_LABELS } from '@/lib/constants'
import { cancelProcedureAction } from '@/actions/procedures'
import { useProcedures } from '@/hooks/queries/use-procedures'
import { useInvalidation } from '@/hooks/queries/use-invalidation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface ProcedureRecord {
  id: string
  procedureTypeName: string
  practitionerName: string
  performedAt: Date | string
  status: string
  technique: string | null
  clinicalResponse: string | null
  notes: string | null
  financialPlan: unknown
  approvedAt: Date | string | null
  cancelledAt: Date | string | null
  cancellationReason: string | null
}

interface PatientProceduresTabProps {
  patientId: string
}

export function PatientProceduresTab({ patientId }: PatientProceduresTabProps) {
  const router = useRouter()
  const { data: proceduresResult, isLoading } = useProcedures(patientId)
  const procedures = (proceduresResult?.data ?? []) as unknown as ProcedureRecord[]
  const { invalidateProcedures, invalidateFinancial } = useInvalidation()

  // Cancel dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const handleCancelClick = (procedureId: string) => {
    setCancelTarget(procedureId)
    setCancelDialogOpen(true)
  }

  const handleCancelConfirm = async () => {
    if (!cancelTarget || !cancelReason.trim()) return
    setCancelling(true)
    try {
      const result = await cancelProcedureAction(cancelTarget, cancelReason.trim())
      if (result.success) {
        setCancelDialogOpen(false)
        setCancelReason('')
        setCancelTarget(null)
        invalidateProcedures(patientId)
        invalidateFinancial()
      }
    } finally {
      setCancelling(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando procedimentos...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {procedures.length} {procedures.length === 1 ? 'atendimento' : 'atendimentos'}
        </p>
        <Link
          href={`/pacientes/${patientId}/atendimento`}
          className="inline-flex items-center justify-center rounded-md bg-forest px-4 py-2 text-sm font-medium text-cream hover:bg-sage transition-colors"
        >
          <Plus className="size-4 mr-1" />
          Novo Atendimento
        </Link>
      </div>

      {procedures.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-mid">
          <Syringe className="mb-2 size-8" />
          <p className="text-sm">Nenhum atendimento registrado</p>
          <p className="text-xs mt-1">
            Clique em &quot;Novo Atendimento&quot; para registrar o primeiro.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {procedures.map((proc) => {
            const statusColor =
              PROCEDURE_STATUS_COLORS[proc.status] ?? PROCEDURE_STATUS_COLORS.planned
            const statusLabel =
              PROCEDURE_STATUS_LABELS[proc.status] ?? proc.status

            const financialPlan = proc.financialPlan as {
              totalAmount?: number
              installmentCount?: number
            } | null

            const basePath = `/pacientes/${patientId}/procedimentos/${proc.id}`

            return (
              <div
                key={proc.id}
                className="rounded-[3px] border bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-charcoal truncate">
                        {proc.procedureTypeName}
                      </h3>
                      <Badge
                        className={cn(
                          statusColor,
                          'px-2.5 py-0.5 text-[11px] font-medium border-0'
                        )}
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mid">
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        {formatDateTime(proc.performedAt)}
                      </span>
                      <span>por {proc.practitionerName}</span>
                    </div>

                    {/* Status-specific content */}
                    {(proc.status === 'planned' || proc.status === 'approved') &&
                      financialPlan &&
                      financialPlan.totalAmount && (
                        <p className="mt-2 text-xs text-mid">
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

                    {proc.status === 'approved' && proc.approvedAt && (
                      <p className="mt-1 text-xs text-sage">
                        Aprovado em{' '}
                        {format(new Date(proc.approvedAt), 'dd/MM/yyyy', {
                          locale: ptBR,
                        })}
                      </p>
                    )}

                    {proc.status === 'executed' && (
                      <>
                        {proc.technique && (
                          <p className="mt-2 text-sm text-charcoal">
                            <span className="text-mid">Técnica:</span>{' '}
                            {proc.technique}
                          </p>
                        )}
                        {proc.clinicalResponse && (
                          <p className="text-sm text-charcoal">
                            <span className="text-mid">Resposta clínica:</span>{' '}
                            {proc.clinicalResponse}
                          </p>
                        )}
                        {proc.notes && (
                          <p className="mt-1 text-xs text-mid">{proc.notes}</p>
                        )}
                      </>
                    )}

                    {proc.status === 'cancelled' && (
                      <>
                        {proc.cancellationReason && (
                          <p className="mt-2 text-xs text-mid">
                            Motivo: {proc.cancellationReason}
                          </p>
                        )}
                        {proc.cancelledAt && (
                          <p className="text-xs text-mid/60 mt-0.5">
                            Cancelado em{' '}
                            {format(
                              new Date(proc.cancelledAt),
                              'dd/MM/yyyy',
                              { locale: ptBR }
                            )}
                          </p>
                        )}
                      </>
                    )}

                    {/* Action buttons */}
                    <div className="mt-3 flex items-center gap-2">
                      {proc.status === 'planned' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-sage text-sage hover:bg-sage/10"
                            onClick={() =>
                              router.push(`${basePath}?action=approve`)
                            }
                          >
                            <CheckCircle2 className="mr-1 size-3" />
                            Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-mid/30 text-mid hover:bg-petal"
                            onClick={() => router.push(basePath)}
                          >
                            <Pencil className="mr-1 size-3" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-mid/30 text-mid hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                            onClick={() => handleCancelClick(proc.id)}
                          >
                            <XCircle className="mr-1 size-3" />
                            Cancelar
                          </Button>
                        </>
                      )}

                      {proc.status === 'approved' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-forest text-forest hover:bg-sage/10"
                            onClick={() =>
                              router.push(`${basePath}?action=execute`)
                            }
                          >
                            <Play className="mr-1 size-3" />
                            Registrar Execução
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-mid/30 text-mid hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                            onClick={() => handleCancelClick(proc.id)}
                          >
                            <XCircle className="mr-1 size-3" />
                            Cancelar
                          </Button>
                        </>
                      )}

                      {(proc.status === 'executed' ||
                        proc.status === 'cancelled') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-mid/30 text-mid hover:bg-petal"
                          onClick={() => router.push(basePath)}
                        >
                          <Eye className="mr-1 size-3" />
                          Ver Detalhes
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-charcoal">
              <Ban className="size-5 text-red-500" />
              Cancelar Procedimento
            </DialogTitle>
            <DialogDescription className="text-mid text-sm">
              Informe o motivo do cancelamento. Esta acao nao pode ser desfeita.
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
                setCancelTarget(null)
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
    </div>
  )
}

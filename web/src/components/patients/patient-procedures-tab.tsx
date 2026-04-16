'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
  ArrowRight,
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
import { PROCEDURE_STATUS_LABELS } from '@/lib/constants'
import { useProcedures } from '@/hooks/queries/use-procedures'
import { useCancelProcedure } from '@/hooks/mutations/use-procedure-mutations'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ─── Types ──────────────────────────────────────────────────────────

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

// ─── Status config ──────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  planned: 'bg-amber border-amber-light',
  approved: 'bg-sage border-sage/30',
  executed: 'bg-forest border-forest/30',
  cancelled: 'bg-mid/40 border-mid/20',
}

const STATUS_LINE: Record<string, string> = {
  planned: 'bg-amber/20',
  approved: 'bg-sage/20',
  executed: 'bg-forest/20',
  cancelled: 'bg-mid/10',
}

const STATUS_ACCENT: Record<string, string> = {
  planned: 'border-l-amber',
  approved: 'border-l-sage',
  executed: 'border-l-forest',
  cancelled: 'border-l-mid/30',
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function formatShortDate(date: Date | string): string {
  return format(new Date(date), 'dd MMM', { locale: ptBR })
}

function formatYear(date: Date | string): string {
  return format(new Date(date), 'yyyy')
}

// ─── Component ──────────────────────────────────────────────────────

export function PatientProceduresTab({ patientId }: PatientProceduresTabProps) {
  const router = useRouter()
  const { data: proceduresResult, isLoading } = useProcedures(patientId)
  const procedures = (proceduresResult ?? []) as unknown as ProcedureRecord[]
  const cancelProcedure = useCancelProcedure()

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const cancelling = cancelProcedure.isPending

  // Whether the patient has an ongoing (non-terminal) procedure that the
  // user could resume instead of starting a new one.
  const hasActiveProcedure = procedures.some(
    (p) => p.status === 'draft' || p.status === 'planned' || p.status === 'approved',
  )
  const [newAtendimentoDialogOpen, setNewAtendimentoDialogOpen] = useState(false)
  const atendimentoHref = `/pacientes/${patientId}/atendimento`

  const handleNewAtendimentoClick = (e: React.MouseEvent) => {
    if (hasActiveProcedure) {
      e.preventDefault()
      setNewAtendimentoDialogOpen(true)
    }
  }

  const handleCancelClick = (procedureId: string) => {
    setCancelTarget(procedureId)
    setCancelDialogOpen(true)
  }

  const handleCancelConfirm = async () => {
    if (!cancelTarget || !cancelReason.trim()) return
    try {
      await cancelProcedure.mutateAsync({ id: cancelTarget, reason: cancelReason.trim() })
      setCancelDialogOpen(false)
      setCancelReason('')
      setCancelTarget(null)
    } catch {
      // error handled by mutation
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-sage" />
        <span className="ml-2.5 text-[13px] text-mid">Carregando atendimentos...</span>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] uppercase tracking-[0.15em] text-mid font-medium">
            Histórico
          </span>
          <span className="text-[12px] text-mid/50">
            {procedures.length} {procedures.length === 1 ? 'registro' : 'registros'}
          </span>
        </div>
        <Link
          href={atendimentoHref}
          onClick={handleNewAtendimentoClick}
          className="inline-flex items-center justify-center rounded-xl bg-forest px-4 py-2 text-[13px] font-medium text-cream hover:bg-sage transition-all duration-200 shadow-sm hover:shadow-md gap-1.5"
        >
          <Plus className="size-3.5" />
          Novo Atendimento
        </Link>
      </div>

      {procedures.length === 0 ? (
        /* ─── Empty state ─────────────────────────────────────────── */
        <div className="flex flex-col items-center justify-center py-20">
          <div className="relative mb-6">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[#F4F6F8]">
              <Syringe className="size-7 text-mid/40" />
            </div>
            <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-forest text-cream shadow-sm">
              <Plus className="size-3" />
            </div>
          </div>
          <p className="text-[15px] font-medium text-charcoal">
            Nenhum atendimento registrado
          </p>
          <p className="text-[13px] text-mid mt-1 mb-5">
            Inicie o primeiro atendimento deste paciente.
          </p>
          <Link
            href={`/pacientes/${patientId}/atendimento`}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-forest hover:text-sage transition-colors"
          >
            Iniciar Atendimento
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        /* ─── Timeline ────────────────────────────────────────────── */
        <div className="relative">
          {procedures.map((proc, i) => {
            const isLast = i === procedures.length - 1
            const statusLabel = PROCEDURE_STATUS_LABELS[proc.status] ?? proc.status
            const dotColor = STATUS_DOT[proc.status] ?? STATUS_DOT.planned
            const lineColor = STATUS_LINE[proc.status] ?? STATUS_LINE.planned
            const accentColor = STATUS_ACCENT[proc.status] ?? STATUS_ACCENT.planned

            const financialPlan = proc.financialPlan as {
              totalAmount?: number
              installmentCount?: number
            } | null

            const basePath = `/pacientes/${patientId}/procedimentos/${proc.id}`

            return (
              <div key={proc.id} className="group relative flex gap-5">
                {/* ─── Timeline spine ─────────────────────────────── */}
                <div className="flex flex-col items-center pt-1">
                  {/* Dot */}
                  <div className={cn(
                    'relative z-10 size-3 rounded-full border-2 shrink-0 transition-transform duration-200 group-hover:scale-125',
                    dotColor,
                  )} />
                  {/* Connecting line */}
                  {!isLast && (
                    <div className={cn('w-px flex-1 mt-1', lineColor)} />
                  )}
                </div>

                {/* ─── Card ───────────────────────────────────────── */}
                <div className={cn(
                  'flex-1 mb-5 rounded-[3px] border-l-[3px] bg-[#FAFBFC] px-5 py-4 transition-all duration-200',
                  'group-hover:bg-white group-hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]',
                  accentColor,
                )}>
                  {/* Top row: date + status */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[15px] font-semibold text-charcoal leading-none">
                        {formatShortDate(proc.performedAt)}
                      </span>
                      <span className="text-[11px] text-mid/50">
                        {formatYear(proc.performedAt)}
                      </span>
                    </div>
                    <span className={cn(
                      'text-[11px] font-medium uppercase tracking-wider',
                      proc.status === 'draft' && 'text-mid',
                      proc.status === 'planned' && 'text-amber',
                      proc.status === 'approved' && 'text-sage',
                      proc.status === 'executed' && 'text-forest',
                      proc.status === 'cancelled' && 'text-mid/50',
                    )}>
                      {statusLabel}
                    </span>
                  </div>

                  {/* Procedure name */}
                  <h3 className="text-[14px] font-medium text-charcoal">
                    {proc.procedureTypeName}
                  </h3>

                  {/* Practitioner */}
                  <p className="text-[12px] text-mid mt-0.5">
                    {proc.practitionerName}
                  </p>

                  {/* Financial (planned/approved) */}
                  {(proc.status === 'planned' || proc.status === 'approved') &&
                    financialPlan?.totalAmount && (
                      <div className="mt-3 inline-flex items-baseline gap-1.5 rounded-lg bg-white/80 border border-[#E8ECEF] px-3 py-1.5">
                        <span className="text-[14px] font-semibold text-charcoal tabular-nums">
                          {formatCurrency(financialPlan.totalAmount)}
                        </span>
                        {financialPlan.installmentCount &&
                          financialPlan.installmentCount > 1 && (
                            <span className="text-[11px] text-mid">
                              {financialPlan.installmentCount}x
                            </span>
                          )}
                      </div>
                    )}

                  {/* Approved date */}
                  {proc.status === 'approved' && proc.approvedAt && (
                    <p className="mt-2 text-[12px] text-sage">
                      Aprovado em{' '}
                      {format(new Date(proc.approvedAt), "dd 'de' MMMM", { locale: ptBR })}
                    </p>
                  )}

                  {/* Executed details */}
                  {proc.status === 'executed' && (proc.technique || proc.clinicalResponse) && (
                    <div className="mt-3 space-y-1 border-t border-[#E8ECEF] pt-3">
                      {proc.technique && (
                        <p className="text-[13px]">
                          <span className="text-mid">Técnica</span>{' '}
                          <span className="text-charcoal">{proc.technique}</span>
                        </p>
                      )}
                      {proc.clinicalResponse && (
                        <p className="text-[13px]">
                          <span className="text-mid">Resposta</span>{' '}
                          <span className="text-charcoal">{proc.clinicalResponse}</span>
                        </p>
                      )}
                      {proc.notes && (
                        <p className="text-[12px] text-mid italic mt-1">{proc.notes}</p>
                      )}
                    </div>
                  )}

                  {/* Cancelled details */}
                  {proc.status === 'cancelled' && (
                    <div className="mt-3 space-y-0.5 border-t border-[#E8ECEF] pt-3">
                      {proc.cancellationReason && (
                        <p className="text-[12px] text-mid">
                          {proc.cancellationReason}
                        </p>
                      )}
                      {proc.cancelledAt && (
                        <p className="text-[11px] text-mid/50">
                          {format(new Date(proc.cancelledAt), "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                      )}
                    </div>
                  )}

                  {/* ─── Actions (visible on hover) ───────────────── */}
                  <div className={cn(
                    'mt-3 flex items-center gap-1.5 transition-opacity duration-200',
                    'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
                  )}>
                    {proc.status === 'draft' && (
                      <Button
                        size="sm"
                        className="h-7 text-[12px] bg-forest/10 text-forest hover:bg-forest/20 border-0 rounded-lg shadow-none"
                        onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=3`)}
                      >
                        <Pencil className="mr-1 size-3" />
                        Continuar Planejamento
                      </Button>
                    )}
                    {proc.status === 'planned' && (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-[12px] bg-sage/10 text-sage hover:bg-sage/20 border-0 rounded-lg shadow-none"
                          onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=4`)}
                        >
                          <CheckCircle2 className="mr-1 size-3" />
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[12px] text-mid hover:text-charcoal hover:bg-[#F4F6F8] rounded-lg"
                          onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=3`)}
                        >
                          <Pencil className="mr-1 size-3" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[12px] text-mid hover:text-red-600 hover:bg-red-50 rounded-lg"
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
                          className="h-7 text-[12px] bg-forest/10 text-forest hover:bg-forest/20 border-0 rounded-lg shadow-none"
                          onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=5`)}
                        >
                          <Play className="mr-1 size-3" />
                          Registrar Execução
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[12px] text-mid hover:text-red-600 hover:bg-red-50 rounded-lg"
                          onClick={() => handleCancelClick(proc.id)}
                        >
                          <XCircle className="mr-1 size-3" />
                          Cancelar
                        </Button>
                      </>
                    )}

                    {(proc.status === 'executed' || proc.status === 'cancelled') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[12px] text-mid hover:text-charcoal hover:bg-[#F4F6F8] rounded-lg"
                        onClick={() => router.push(basePath)}
                      >
                        <Eye className="mr-1 size-3" />
                        Ver Detalhes
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Cancel Dialog ────────────────────────────────────────── */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
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

      {/* ─── New atendimento confirmation (when one is already active) ── */}
      <Dialog open={newAtendimentoDialogOpen} onOpenChange={setNewAtendimentoDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Atendimento em andamento</DialogTitle>
            <DialogDescription>
              Este paciente já tem um atendimento em andamento. Você quer continuar de onde parou ou começar um novo?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewAtendimentoDialogOpen(false)}
              className="sm:order-1"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNewAtendimentoDialogOpen(false)
                router.push(`${atendimentoHref}?new=1`)
              }}
              className="sm:order-2"
            >
              Começar novo
            </Button>
            <Button
              type="button"
              onClick={() => {
                setNewAtendimentoDialogOpen(false)
                router.push(atendimentoHref)
              }}
              className="bg-forest text-cream hover:bg-sage sm:order-3"
            >
              Continuar em andamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

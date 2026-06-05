'use client'

import { useMemo, useState } from 'react'
import { usePatientPackages } from '@/hooks/queries/use-packages'
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
import { SessionsTimeline } from '@/components/procedures/sessions-timeline'
import { useCancelProcedure } from '@/hooks/mutations/use-procedure-mutations'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ─── Types ──────────────────────────────────────────────────────────

interface SessionSummary {
  sessionOrdinal: number
  performedAt: string
  executedByName: string
}

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
  encounterId: string | null
  patientPackageId: string | null
  sessionsTotal: number
  sessionsExecuted: number
  sessions: SessionSummary[]
}

interface PatientProceduresTabProps {
  patientId: string
}

// ─── Status visual config ──────────────────────────────────────────
//
// Each status gets a color-token suffix used to compose dot, label, and
// background. We avoid switch-cases scattered through the JSX by keeping
// these as small helpers consumed by <StatusPill /> and the card-tint
// classes below.
type StatusKey = 'draft' | 'planned' | 'approved' | 'in_progress' | 'completed' | 'cancelled'

const STATUS_DOT_BG: Record<string, string> = {
  draft: 'bg-mid/40',
  planned: 'bg-amber',
  approved: 'bg-sage',
  in_progress: 'bg-forest/70',
  completed: 'bg-forest',
  cancelled: 'bg-mid/30',
}

const STATUS_LABEL_COLOR: Record<string, string> = {
  draft: 'text-mid',
  planned: 'text-amber',
  approved: 'text-sage',
  in_progress: 'text-forest',
  completed: 'text-forest',
  cancelled: 'text-mid/60',
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
  const { data: packages } = usePatientPackages(patientId)
  const cancelProcedure = useCancelProcedure()

  // ─── Group by encounter ─────────────────────────────────────────────
  //
  // The atendimento (encounter) is the unit of work — a patient visit. A
  // single encounter can contain multiple procedure_records (one per cart
  // line) all sharing the same encounter_id. We collapse them so the user
  // sees ONE row per atendimento instead of N. For records without a
  // shared encounter (single-procedure atendimentos), each row is its own
  // group of size 1 — visually identical to today.
  const encounters = useMemo(() => {
    const byEncounter = new Map<string, ProcedureRecord[]>()
    for (const p of procedures) {
      // Records that have no encounter id (legacy or partially-migrated
      // data) are surfaced as singletons keyed by their own id.
      const key = p.encounterId ?? `record:${p.id}`
      const group = byEncounter.get(key) ?? []
      group.push(p)
      byEncounter.set(key, group)
    }

    // Build a representative row per encounter, preserving sort order from
    // the original list (which is already ordered by date desc).
    const seen = new Set<string>()
    const groups: Array<{
      key: string
      primary: ProcedureRecord
      lines: ProcedureRecord[]
      packageName: string | null
      isBundle: boolean
    }> = []
    for (const p of procedures) {
      const key = p.encounterId ?? `record:${p.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const lines = byEncounter.get(key) ?? [p]
      // The "primary" record is the first one in the group. For bundles
      // (a patient_package or >1 line), the bundle's labels supersede the
      // primary's per-line labels.
      const primary = lines[0]
      const isBundle = lines.length > 1 || !!primary.patientPackageId
      const pkg = primary.patientPackageId
        ? (packages ?? []).find((p) => p.id === primary.patientPackageId)
        : null
      const packageName = pkg?.name ?? null
      groups.push({ key, primary, lines, packageName, isBundle })
    }
    return groups
  }, [procedures, packages])

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
            {encounters.length} {encounters.length === 1 ? 'atendimento' : 'atendimentos'}
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
        /* ─── Encounter feed ──────────────────────────────────────── */
        <div className="relative">
          {encounters.map((enc, idx) => {
            const isLast = idx === encounters.length - 1
            const proc = enc.primary
            const isCancelled = proc.status === 'cancelled'

            const financialPlan = proc.financialPlan as {
              totalAmount?: number
              installmentCount?: number
            } | null

            const basePath = `/pacientes/${patientId}/procedimentos/${proc.id}`
            const procedureLabel = enc.packageName
              ? enc.packageName
              : enc.lines.length > 1
                ? `Atendimento — ${enc.lines.length} procedimentos`
                : proc.procedureTypeName

            const sessionsDone = enc.lines.reduce((s, l) => s + l.sessionsExecuted, 0)
            const sessionsTotal = enc.lines.reduce((s, l) => s + l.sessionsTotal, 0)
            const sessionsMissing = sessionsTotal - sessionsDone
            const hasSessionStrip =
              enc.lines.length > 1 || enc.lines.some((l) => l.sessionsTotal > 1)

            const date = new Date(proc.performedAt)
            const spineDot = STATUS_DOT_BG[proc.status] ?? 'bg-mid/30'

            return (
              <div key={enc.key} className="relative flex gap-3 sm:gap-5">
                {/* ── Timeline spine (status-tinted dot + connecting line) ── */}
                <div className="flex flex-col items-center pt-5">
                  <span
                    className={cn(
                      'relative z-10 size-2.5 shrink-0 rounded-full ring-2 ring-white',
                      spineDot,
                      isCancelled && 'opacity-60',
                    )}
                    aria-hidden
                  />
                  {!isLast && (
                    <span className="mt-1 w-px flex-1 bg-sage/15" aria-hidden />
                  )}
                </div>

                {/* ── Card ── */}
                <article
                  className={cn(
                    'group relative mb-4 flex-1 rounded-[3px] border bg-white px-3 sm:px-5 py-3 sm:py-4 transition-colors duration-200',
                    'border-sage/15 hover:border-sage/30',
                    isCancelled && 'opacity-65',
                  )}
                >
                {/* ── Top meta row: date anchor (left) + financial (right) ── */}
                <header className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2 leading-none">
                    <span className="font-heading text-[18px] font-medium text-charcoal tabular-nums">
                      {format(date, 'dd', { locale: ptBR })}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-mid">
                      {format(date, "MMM ''yy", { locale: ptBR })}
                    </span>
                  </div>

                  {(proc.status === 'planned' || proc.status === 'approved') &&
                    financialPlan?.totalAmount && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[13px] font-medium text-charcoal tabular-nums">
                          {formatCurrency(financialPlan.totalAmount)}
                        </span>
                        {financialPlan.installmentCount &&
                          financialPlan.installmentCount > 1 && (
                            <span className="text-[10px] uppercase tracking-wider text-mid tabular-nums">
                              {financialPlan.installmentCount}×
                            </span>
                          )}
                      </div>
                    )}
                </header>

                {/* ── Title row: heading | hairline connector | status pill ── */}
                <div className="mt-3 flex items-center gap-3">
                  <h3
                    className={cn(
                      'shrink-0 font-heading text-[15px] leading-snug text-charcoal',
                      isCancelled && 'line-through decoration-mid/40 decoration-1',
                    )}
                  >
                    {procedureLabel}
                  </h3>
                  <span className="h-px flex-1 bg-sage/15" aria-hidden />
                  <StatusPill status={proc.status} />
                </div>
                {enc.lines.length > 1 && !enc.packageName && (
                  <p className="mt-0.5 text-[11px] text-mid">
                    {enc.lines.length} procedimentos
                  </p>
                )}

                {/* ── Sessions timeline ── */}
                {hasSessionStrip && (
                  <ul className="mt-4 space-y-4 border-t border-dashed border-sage/15 pt-3">
                    {enc.lines.map((l) => (
                      <li key={l.id} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[12px] text-charcoal">
                            {l.procedureTypeName}
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wider text-mid tabular-nums">
                            <span className="text-charcoal">
                              {l.sessionsExecuted}
                            </span>
                            <span className="text-mid/60">/{l.sessionsTotal}</span>
                          </span>
                        </div>
                        <SessionsTimeline
                          sessionsTotal={l.sessionsTotal}
                          sessionsExecuted={l.sessionsExecuted}
                          sessions={(l.sessions ?? []).map((s) => ({
                            sessionOrdinal: s.sessionOrdinal,
                            performedAt: s.performedAt,
                            executedByName: s.executedByName,
                          }))}
                          procedureDetailHref={`/pacientes/${patientId}/procedimentos/${l.id}`}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {/* ── Status-specific detail bands ── */}
                {proc.status === 'approved' && proc.approvedAt && (
                  <p className="mt-3 text-[11px] uppercase tracking-wider text-sage">
                    Aprovado em{' '}
                    {format(new Date(proc.approvedAt), "dd 'de' MMMM", { locale: ptBR })}
                  </p>
                )}

                {(proc.status === 'in_progress' || proc.status === 'completed') &&
                  (proc.technique || proc.clinicalResponse) && (
                    <div className="mt-3 space-y-1 border-t border-dashed border-sage/15 pt-3">
                      {proc.technique && (
                        <p className="text-[13px]">
                          <span className="text-[10px] uppercase tracking-wider text-mid">
                            Técnica{' '}
                          </span>
                          <span className="text-charcoal">{proc.technique}</span>
                        </p>
                      )}
                      {proc.clinicalResponse && (
                        <p className="text-[13px]">
                          <span className="text-[10px] uppercase tracking-wider text-mid">
                            Resposta{' '}
                          </span>
                          <span className="text-charcoal">{proc.clinicalResponse}</span>
                        </p>
                      )}
                      {proc.notes && (
                        <p className="mt-1 text-[12px] italic text-mid">{proc.notes}</p>
                      )}
                    </div>
                  )}

                {proc.status === 'cancelled' && (proc.cancellationReason || proc.cancelledAt) && (
                  <div className="mt-3 space-y-0.5 border-t border-dashed border-sage/15 pt-3">
                    {proc.cancellationReason && (
                      <p className="text-[12px] text-mid">{proc.cancellationReason}</p>
                    )}
                    {proc.cancelledAt && (
                      <p className="text-[11px] text-mid/50 tabular-nums">
                        {format(new Date(proc.cancelledAt), 'dd/MM/yyyy', { locale: ptBR })}
                      </p>
                    )}
                  </div>
                )}

                {/* ── Footer: practitioner + summary + hover-actions ── */}
                <footer className="mt-4 flex items-center justify-between border-t border-sage/10 pt-3">
                  <PractitionerChip name={proc.practitionerName} />
                  <div className="flex items-center gap-4">
                    {sessionsTotal > 1 && (
                      <span className="text-[11px] uppercase tracking-wider text-mid tabular-nums">
                        <span className="text-charcoal">{sessionsDone}</span>
                        <span className="text-mid/60"> / {sessionsTotal} sessões</span>
                        {sessionsMissing > 0 && (
                          <span className="ml-1.5 text-mid/70">· {sessionsMissing} pendente{sessionsMissing === 1 ? '' : 's'}</span>
                        )}
                      </span>
                    )}
                  </div>
                </footer>

                {/* ── Actions (always visible — tablets don't hover) ── */}
                <div className="mt-3 flex items-center gap-1.5">
                  {proc.status === 'draft' && (
                    <Button
                      size="sm"
                      className="h-7 rounded-[3px] border-0 bg-forest/10 text-[11px] uppercase tracking-wider text-forest shadow-none hover:bg-forest/20"
                      onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=3`)}
                    >
                      <Pencil className="mr-1 size-3" />
                      Continuar
                    </Button>
                  )}
                  {proc.status === 'planned' && (
                    <>
                      <Button
                        size="sm"
                        className="h-7 rounded-[3px] border-0 bg-sage/10 text-[11px] uppercase tracking-wider text-sage shadow-none hover:bg-sage/20"
                        onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=4`)}
                      >
                        <CheckCircle2 className="mr-1 size-3" />
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-[3px] text-[11px] uppercase tracking-wider text-mid hover:bg-cream/40 hover:text-charcoal"
                        onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=3`)}
                      >
                        <Pencil className="mr-1 size-3" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-[3px] text-[11px] uppercase tracking-wider text-mid hover:bg-red-50 hover:text-red-600"
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
                        className="h-7 rounded-[3px] border-0 bg-forest/10 text-[11px] uppercase tracking-wider text-forest shadow-none hover:bg-forest/20"
                        onClick={() => router.push(`/pacientes/${patientId}/atendimento?step=5`)}
                      >
                        <Play className="mr-1 size-3" />
                        Registrar execução
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-[3px] text-[11px] uppercase tracking-wider text-mid hover:bg-red-50 hover:text-red-600"
                        onClick={() => handleCancelClick(proc.id)}
                      >
                        <XCircle className="mr-1 size-3" />
                        Cancelar
                      </Button>
                    </>
                  )}

                  {(proc.status === 'in_progress' ||
                    proc.status === 'completed' ||
                    proc.status === 'cancelled') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-[3px] text-[11px] uppercase tracking-wider text-mid hover:bg-cream/40 hover:text-charcoal"
                      onClick={() => router.push(basePath)}
                    >
                      <Eye className="mr-1 size-3" />
                      Ver detalhes
                    </Button>
                  )}
                </div>
                </article>
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

// ── Status pill ────────────────────────────────────────────────────
// Compact eyebrow showing the procedure's status with a leading dot and
// status-tinted label. The dot color tracks STATUS_DOT_BG; the label
// color tracks STATUS_LABEL_COLOR. Visually replaces the bare uppercase
// text the old row used in the top-right corner.
function StatusPill({ status }: { status: string }) {
  const label = PROCEDURE_STATUS_LABELS[status] ?? status
  const dot = STATUS_DOT_BG[status] ?? 'bg-mid/30'
  const color = STATUS_LABEL_COLOR[status] ?? 'text-mid'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em]',
        color,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  )
}

// ── Practitioner chip ──────────────────────────────────────────────
// Initials avatar (max 2 chars) plus the practitioner's name. Sized to
// align with the footer's tabular session-count counterpart on the
// right. Initials read from the full name's first two whitespace-split
// tokens — handles "Dra. Ana Oliveira" → "AO".
function PractitionerChip({ name }: { name: string }) {
  const initials = (() => {
    const parts = name
      .split(/\s+/)
      .filter((p) => p && !/^(Dra?|Sra?|Sr|Dr)\.?$/i.test(p))
    const first = parts[0]?.[0] ?? ''
    const second = parts[parts.length - 1]?.[0] ?? ''
    return (first + (parts.length > 1 ? second : '')).toUpperCase()
  })()
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-mid">
      <span
        className="flex size-6 items-center justify-center rounded-full bg-sage/15 text-[10px] font-medium tabular-nums text-forest"
        aria-hidden
      >
        {initials}
      </span>
      {name}
    </span>
  )
}


'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Stethoscope,
  ClipboardList,
  ChevronDown,
  AlertTriangle,
  CalendarClock,
  Package,
  MapPin,
  Banknote,
  Printer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import { cn } from '@/lib/utils'
import { PROCEDURE_STATUS_LABELS } from '@/lib/constants'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { DiagramPointData } from '@/components/face-diagram/types'
import type { PaymentMethod } from '@/types'
import type { EvaluationSection, EvaluationResponses, EvaluationQuestion } from '@/types/evaluation'

// ─── Types ──────────────────────────────────────────────────────────

interface ProcedureDetailViewProps {
  patientId: string
  patientName: string
  patientGender?: string | null
  procedure: ProcedureWithDetails
  diagrams: DiagramWithPoints[]
  applications: ProductApplicationRecord[]
}

interface FinancialPlan {
  totalAmount: number
  installmentCount: number
  paymentMethod?: PaymentMethod
  notes?: string
}

// ─── Helpers ────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência Bancária',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function formatLongDate(date: Date | string): string {
  return format(new Date(date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

function formatShortDate(date: Date | string): string {
  return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR })
}

function diagramsToPoints(diagrams: DiagramWithPoints[]): DiagramPointData[] {
  const points: DiagramPointData[] = []
  for (const d of diagrams) {
    for (const p of d.points) {
      points.push({
        id: p.id,
        x: parseFloat(p.x),
        y: parseFloat(p.y),
        productName: p.productName,
        activeIngredient: p.activeIngredient ?? undefined,
        quantity: parseFloat(p.quantity),
        quantityUnit: p.quantityUnit as DiagramPointData['quantityUnit'],
        technique: p.technique ?? undefined,
        depth: p.depth ?? undefined,
        notes: p.notes ?? undefined,
      })
    }
  }
  return points
}

// ─── Sub-components ─────────────────────────────────────────────────

function SectionTitle({ icon: Icon, title }: { icon: typeof Clock; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <Icon className="size-4 text-sage" />
      <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium text-mid">
        {title}
      </h3>
      <div className="flex-1 h-px bg-blush/60" />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-mid/70 mb-0.5">{label}</dt>
      <dd className="text-[14px] text-charcoal leading-relaxed">{children}</dd>
    </div>
  )
}

// ─── Lifecycle bar ──────────────────────────────────────────────────

function LifecycleBar({ procedure }: { procedure: ProcedureWithDetails }) {
  const isCancelled = procedure.status === 'cancelled'

  const steps = [
    {
      label: 'Criado',
      date: procedure.createdAt,
      reached: true,
      color: 'bg-mid/40',
    },
    {
      label: 'Aprovado',
      date: procedure.approvedAt,
      reached: !!procedure.approvedAt,
      color: 'bg-sage',
    },
    {
      label: isCancelled ? 'Cancelado' : 'Executado',
      date: isCancelled ? procedure.cancelledAt : (procedure.status === 'executed' ? procedure.performedAt : null),
      reached: procedure.status === 'executed' || isCancelled,
      color: isCancelled ? 'bg-red-400' : 'bg-forest',
    },
  ]

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center flex-1 last:flex-none">
          {/* Dot + label */}
          <div className="flex flex-col items-center">
            <div className={cn(
              'size-3 rounded-full border-2 transition-all',
              step.reached
                ? cn(step.color, 'border-transparent')
                : 'bg-white border-[#E8ECEF]'
            )} />
            <span className={cn(
              'text-[10px] mt-1.5 whitespace-nowrap',
              step.reached ? 'text-charcoal font-medium' : 'text-mid/40'
            )}>
              {step.label}
            </span>
            {step.date && step.reached && (
              <span className="text-[10px] text-mid/50">
                {formatShortDate(step.date)}
              </span>
            )}
          </div>
          {/* Connecting line */}
          {i < steps.length - 1 && (
            <div className={cn(
              'h-px flex-1 mx-2 mt-[-18px]',
              steps[i + 1].reached ? 'bg-sage/40' : 'bg-[#E8ECEF]'
            )} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureDetailView({
  patientId,
  patientName,
  patientGender,
  procedure,
  diagrams,
  applications,
}: ProcedureDetailViewProps) {
  const router = useRouter()
  const statusLabel = PROCEDURE_STATUS_LABELS[procedure.status] ?? procedure.status
  const financialPlan = procedure.financialPlan as FinancialPlan | null
  const diagramPoints = useMemo(() => diagramsToPoints(diagrams), [diagrams])

  const isCancelled = procedure.status === 'cancelled'
  const isExecuted = procedure.status === 'executed'

  // ─── Evaluation responses ─────────────────────────────────────────
  interface EvalResponseRecord {
    templateId: string
    templateName: string | null
    templateSnapshot: EvaluationSection[]
    responses: EvaluationResponses
  }
  const [evalResponses, setEvalResponses] = useState<EvalResponseRecord[]>([])
  const [expandedEvals, setExpandedEvals] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/evaluation/responses/${procedure.id}`)
        if (res.ok) {
          const data = await res.json()
          if (data && data.length > 0) {
            setEvalResponses(
              data.map((r: { templateId: string; templateName: string | null; templateSnapshot: unknown; responses: unknown }) => ({
                templateId: r.templateId,
                templateName: r.templateName,
                templateSnapshot: r.templateSnapshot as EvaluationSection[],
                responses: r.responses as EvaluationResponses,
              }))
            )
          }
        }
      } catch {
        // non-blocking
      }
    }
    load()
  }, [procedure.id])

  return (
    <div className="mx-auto max-w-3xl">
      {/* Navigation */}
      <div className="flex items-center justify-between mb-6" data-print-hide>
        <button
          onClick={() => router.push(`/pacientes/${patientId}?tab=procedimentos`)}
          className="inline-flex items-center gap-1.5 text-[13px] text-mid hover:text-forest transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.print()}
          className="text-mid hover:text-charcoal text-[12px] h-8"
        >
          <Printer className="size-3.5 mr-1.5" />
          Imprimir
        </Button>
      </div>

      {/* ─── Document ─────────────────────────────────────────────── */}
      <div
        data-print-area
        className={cn(
          'rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden',
          isCancelled && 'ring-1 ring-red-200/50',
        )}
      >
        {/* Status accent */}
        <div className={cn(
          'h-[3px]',
          isExecuted && 'bg-gradient-to-r from-forest via-sage to-mint',
          isCancelled && 'bg-gradient-to-r from-red-300 to-red-400',
          procedure.status === 'approved' && 'bg-gradient-to-r from-sage to-mint',
          procedure.status === 'planned' && 'bg-amber/50',
          procedure.status === 'draft' && 'bg-mid/20',
        )} />

        {/* ─── Header ──────────────────────────────────────────── */}
        <div className="px-8 pt-8 pb-6">
          <div className="flex items-start justify-between gap-6">
            {/* Left: procedure identity */}
            <div className="min-w-0">
              <h1 className="font-display text-[26px] font-semibold text-forest leading-tight">
                {procedure.procedureTypeName}
              </h1>
              <p className="text-[14px] text-mid mt-1">
                {patientName}
              </p>
            </div>

            {/* Right: status stamp */}
            <div className={cn(
              'shrink-0 text-right px-4 py-2 rounded-lg border',
              isExecuted && 'border-forest/20 bg-forest/5',
              isCancelled && 'border-red-200 bg-red-50',
              procedure.status === 'approved' && 'border-sage/20 bg-sage/5',
              procedure.status === 'planned' && 'border-amber/30 bg-amber-light/50',
              procedure.status === 'draft' && 'border-mid/20 bg-[#F4F6F8]',
            )}>
              <p className={cn(
                'text-[13px] font-semibold uppercase tracking-wider',
                isExecuted && 'text-forest',
                isCancelled && 'text-red-600',
                procedure.status === 'approved' && 'text-sage',
                procedure.status === 'planned' && 'text-amber-dark',
                procedure.status === 'draft' && 'text-mid',
              )}>
                {statusLabel}
              </p>
              <p className="text-[11px] text-mid mt-0.5">
                {formatLongDate(procedure.performedAt)}
              </p>
            </div>
          </div>

          {/* Practitioner */}
          <p className="text-[12px] text-mid/60 mt-3">
            Responsável: {procedure.practitionerName}
          </p>

          {/* Lifecycle bar */}
          <div className="mt-6 pt-5 border-t border-[#F4F6F8]">
            <LifecycleBar procedure={procedure} />
          </div>
        </div>

        {/* ─── Cancelled reason ────────────────────────────────── */}
        {isCancelled && procedure.cancellationReason && (
          <div className="mx-8 mb-6 rounded-lg border border-red-200/60 bg-red-50/60 px-5 py-4">
            <div className="flex items-start gap-3">
              <XCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] font-medium text-red-800 mb-0.5">
                  Motivo do cancelamento
                </p>
                <p className="text-[13px] text-red-700 leading-relaxed">
                  {procedure.cancellationReason}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── Body ────────────────────────────────────────────── */}
        <div className="px-8 pb-8 space-y-8">

          {/* Clinical data */}
          {(procedure.technique || procedure.clinicalResponse || procedure.adverseEffects || procedure.notes) && (
            <div>
              <SectionTitle icon={Stethoscope} title="Dados Clínicos" />
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <Field label="Técnica">{procedure.technique}</Field>
                <Field label="Resposta clínica">{procedure.clinicalResponse}</Field>
                {procedure.adverseEffects && (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] uppercase tracking-wider text-amber-dark/70 mb-0.5 flex items-center gap-1">
                      <AlertTriangle className="size-3" />
                      Efeitos adversos
                    </dt>
                    <dd className="text-[14px] text-amber-dark leading-relaxed">
                      {procedure.adverseEffects}
                    </dd>
                  </div>
                )}
                {procedure.notes && (
                  <div className="sm:col-span-2">
                    <Field label="Observações">{procedure.notes}</Field>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Evaluation responses */}
          {evalResponses.length > 0 && (
            <div>
              <SectionTitle icon={ClipboardList} title="Fichas de Avaliação" />
              <div className="space-y-3">
                {evalResponses.map((evalResp) => {
                  const isOpen = expandedEvals.has(evalResp.templateId)
                  const toggleEval = () => {
                    setExpandedEvals((prev) => {
                      const next = new Set(prev)
                      if (next.has(evalResp.templateId)) {
                        next.delete(evalResp.templateId)
                      } else {
                        next.add(evalResp.templateId)
                      }
                      return next
                    })
                  }

                  return (
                    <div key={evalResp.templateId} className="rounded-lg border border-[#F4F6F8] overflow-hidden">
                      {/* Collapsible header */}
                      <button
                        onClick={toggleEval}
                        className="w-full flex items-center justify-between px-5 py-3.5 bg-[#FAFBFC] hover:bg-[#F4F6F8] transition-colors"
                      >
                        <span className="text-[13px] font-medium text-charcoal">
                          {evalResp.templateName ?? 'Ficha de Avaliação'}
                        </span>
                        <ChevronDown className={cn(
                          'size-4 text-mid/40 transition-transform duration-200',
                          isOpen && 'rotate-180'
                        )} />
                      </button>

                      {/* Collapsible content */}
                      <div className={cn(
                        'grid transition-all duration-300 ease-in-out',
                        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      )}>
                        <div className="overflow-hidden">
                          <div className="px-5 py-4 space-y-5 border-t border-[#F4F6F8]">
                            {evalResp.templateSnapshot.map((section) => (
                              <div key={section.id}>
                                <p className="text-[11px] uppercase tracking-wider text-mid/60 font-medium mb-2.5">
                                  {section.title}
                                </p>
                                <dl className="space-y-2">
                                  {section.questions
                                    .sort((a, b) => a.order - b.order)
                                    .map((q) => {
                                      const answer = evalResp.responses[q.id]
                                      if (answer === undefined || answer === null || answer === '') return null
                                      return (
                                        <div key={q.id} className="flex items-baseline gap-3 py-1.5 border-b border-[#F4F6F8] last:border-0">
                                          <dt className="text-[12px] text-mid shrink-0 max-w-[50%]">
                                            {q.label}
                                          </dt>
                                          <dd className="text-[13px] text-charcoal">
                                            <EvalAnswerDisplay question={q} answer={answer} />
                                          </dd>
                                        </div>
                                      )
                                    })}
                                </dl>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Face diagram */}
          {diagramPoints.length > 0 && (
            <div>
              <SectionTitle icon={MapPin} title="Diagrama Facial" />
              <div className="rounded-lg border border-[#F4F6F8] p-4 bg-[#FAFBFC]">
                <FaceDiagramEditor
                  points={diagramPoints}
                  onChange={() => {}}
                  readOnly
                  gender={patientGender}
                />
              </div>
            </div>
          )}

          {/* Products */}
          {applications.length > 0 && (
            <div>
              <SectionTitle icon={Package} title="Produtos Utilizados" />
              <div className="rounded-lg border border-[#F4F6F8] overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#FAFBFC]">
                      <th className="text-[11px] uppercase tracking-wider text-mid/60 font-medium px-4 py-2.5">Produto</th>
                      <th className="text-[11px] uppercase tracking-wider text-mid/60 font-medium px-4 py-2.5">Princípio ativo</th>
                      <th className="text-[11px] uppercase tracking-wider text-mid/60 font-medium px-4 py-2.5 text-right">Quantidade</th>
                      <th className="text-[11px] uppercase tracking-wider text-mid/60 font-medium px-4 py-2.5">Lote</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F4F6F8]">
                    {applications.map((app) => (
                      <tr key={app.id} className="group">
                        <td className="px-4 py-3">
                          <span className="text-[13px] font-medium text-charcoal">
                            {app.productName}
                          </span>
                          {app.applicationAreas && (
                            <p className="text-[11px] text-mid mt-0.5">{app.applicationAreas}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-mid">
                          {app.activeIngredient ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-[13px] font-semibold text-forest tabular-nums">
                            {app.totalQuantity} {app.quantityUnit}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] text-mid font-mono">
                            {app.batchNumber ?? '—'}
                          </span>
                          {app.expirationDate && (
                            <p className="text-[11px] text-mid/50 mt-0.5">
                              Val: {formatShortDate(app.expirationDate)}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Financial */}
          {financialPlan && financialPlan.totalAmount > 0 && (
            <div>
              <SectionTitle icon={Banknote} title="Financeiro" />
              <div className="rounded-lg border border-[#F4F6F8] bg-[#FAFBFC] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    {financialPlan.paymentMethod && (
                      <p className="text-[12px] text-mid">
                        {PAYMENT_LABELS[financialPlan.paymentMethod] ?? financialPlan.paymentMethod}
                      </p>
                    )}
                    <p className="text-[13px] text-mid">
                      {financialPlan.installmentCount === 1
                        ? 'Pagamento à vista'
                        : `${financialPlan.installmentCount}x de ${formatCurrency(financialPlan.totalAmount / financialPlan.installmentCount)}`}
                    </p>
                    {financialPlan.notes && (
                      <p className="text-[12px] text-mid/60 italic">{financialPlan.notes}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wider text-mid/50 mb-0.5">Total</p>
                    <p className="text-[22px] font-semibold text-charcoal tabular-nums leading-none">
                      {formatCurrency(financialPlan.totalAmount)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Follow-up */}
          {(procedure.followUpDate || procedure.nextSessionObjectives) && (
            <div>
              <SectionTitle icon={CalendarClock} title="Retorno" />
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                {procedure.followUpDate && (
                  <Field label="Data prevista">{formatLongDate(procedure.followUpDate)}</Field>
                )}
                {procedure.nextSessionObjectives && (
                  <Field label="Objetivos da próxima sessão">{procedure.nextSessionObjectives}</Field>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Evaluation answer renderer ─────────────────────────────────────

function EvalAnswerDisplay({ question, answer }: { question: EvaluationQuestion; answer: unknown }) {
  if (answer === undefined || answer === null) return <span className="text-mid/40">—</span>

  switch (question.type) {
    case 'radio':
      return <span>{String(answer)}</span>
    case 'checkbox':
      if (Array.isArray(answer)) return <span>{answer.join(', ')}</span>
      return <span>{String(answer)}</span>
    case 'scale':
      return (
        <span className="tabular-nums">
          {String(answer)}
          {question.scaleMax && <span className="text-mid/50">/{question.scaleMax}</span>}
        </span>
      )
    case 'text':
      return <span>{String(answer)}</span>
    case 'checkbox_with_other': {
      const val = answer as { selected?: string[]; other?: string }
      const parts: string[] = [...(val.selected ?? [])]
      if (val.other) parts.push(val.other)
      return <span>{parts.join(', ')}</span>
    }
    case 'radio_with_other': {
      const val = answer as { selected?: string; other?: string }
      return <span>{val.other || val.selected || '—'}</span>
    }
    case 'face_diagram':
      return <span className="text-sage">Diagrama preenchido</span>
    default:
      return <span>{JSON.stringify(answer)}</span>
  }
}

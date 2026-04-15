'use client'

import * as React from 'react'
import { ClipboardCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { DiagramPointData } from '@/components/face-diagram/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { PaymentMethod } from '@/types'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência Bancária',
}

interface ProcedureType {
  id: string
  name: string
  category: string
}

interface ProductTotal {
  name: string
  quantity: number
  unit: string
}

interface FinancialPlan {
  totalAmount: number
  installmentCount: number
  paymentMethod?: PaymentMethod
  notes?: string
}

interface ApprovalSummaryCardProps {
  procedure: ProcedureWithDetails
  selectedTypes: ProcedureType[]
  diagramPoints: DiagramPointData[]
  productTotals: ProductTotal[]
  financialPlan: FinancialPlan | null
  patientGender?: string | null
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export function ApprovalSummaryCard({
  procedure,
  selectedTypes,
  diagramPoints,
  productTotals,
  financialPlan,
  patientGender,
}: ApprovalSummaryCardProps) {
  return (
    <Card className="border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
            <ClipboardCheck className="size-4 text-forest" />
          </div>
          <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
            Resumo do Planejamento
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {/* Procedure types */}
        <div>
          <p className="text-xs uppercase tracking-wider text-mid mb-2">
            Procedimentos
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedTypes.length > 0 ? (
              selectedTypes.map((t) => (
                <Badge
                  key={t.id}
                  variant="outline"
                  className="border-sage/30 bg-sage/5 text-sage text-xs"
                >
                  {t.name}
                </Badge>
              ))
            ) : (
              <Badge
                variant="outline"
                className="border-sage/30 bg-sage/5 text-sage text-xs"
              >
                {procedure.procedureTypeName}
              </Badge>
            )}
          </div>
        </div>

        {/* Face diagram (read-only) */}
        {diagramPoints.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-mid mb-2">
              Diagrama Facial
            </p>
            <FaceDiagramEditor
              points={diagramPoints}
              onChange={() => {}}
              readOnly
              gender={patientGender}
            />
          </div>
        )}

        {/* Product totals */}
        {productTotals.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-mid mb-2">
              Produtos Planejados
            </p>
            <div className="space-y-1.5">
              {productTotals.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between rounded-[3px] border border-[#E8ECEF] px-3 py-2"
                >
                  <span className="text-sm text-charcoal">{p.name}</span>
                  <span className="text-sm font-medium text-forest">
                    {p.quantity} {p.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Financial summary */}
        {financialPlan && (
          <div>
            <p className="text-xs uppercase tracking-wider text-mid mb-2">
              Resumo Financeiro
            </p>
            <div className="rounded-[3px] border border-[#E8ECEF] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mid">Valor total</span>
                <span className="text-sm font-semibold text-charcoal">
                  {formatCurrency(financialPlan.totalAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-mid">Parcelas</span>
                <span className="text-sm text-charcoal">
                  {financialPlan.installmentCount === 1
                    ? 'À vista'
                    : `${financialPlan.installmentCount}x de ${formatCurrency(
                        financialPlan.totalAmount / financialPlan.installmentCount
                      )}`}
                </span>
              </div>
              {financialPlan.paymentMethod && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-mid">Forma de pagamento</span>
                  <span className="text-sm text-charcoal">
                    {PAYMENT_METHOD_LABELS[financialPlan.paymentMethod] ??
                      financialPlan.paymentMethod}
                  </span>
                </div>
              )}
              {financialPlan.notes && (
                <div className="pt-1 border-t border-[#E8ECEF]">
                  <span className="text-xs text-mid">{financialPlan.notes}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

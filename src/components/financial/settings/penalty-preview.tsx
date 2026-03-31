'use client'

import { calculateFine, calculateInterest } from '@/lib/financial/penalties'
import { InfoIcon } from 'lucide-react'

interface PenaltyPreviewProps {
  fineType: string
  fineValue: number
  monthlyInterestPercent: number
  gracePeriodDays: number
}

const SAMPLE_AMOUNT = 1000
const SAMPLE_DAYS_OVERDUE = 30

export function PenaltyPreview({
  fineType,
  fineValue,
  monthlyInterestPercent,
  gracePeriodDays,
}: PenaltyPreviewProps) {
  const effectiveDaysOverdue = Math.max(0, SAMPLE_DAYS_OVERDUE - gracePeriodDays)
  const fine = effectiveDaysOverdue > 0 ? calculateFine(SAMPLE_AMOUNT, fineType, fineValue) : 0
  const interest = calculateInterest(SAMPLE_AMOUNT, effectiveDaysOverdue, monthlyInterestPercent)
  const total = SAMPLE_AMOUNT + fine + interest

  const formatBRL = (value: number) =>
    value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div
      data-testid="penalty-preview"
      className="bg-[#4A6B52]/5 border border-[#4A6B52]/20 rounded-lg p-4"
    >
      <div className="flex items-start gap-2.5">
        <InfoIcon className="h-4 w-4 text-[#4A6B52] mt-0.5 shrink-0" />
        <div className="text-sm text-[#2A2A2A]">
          <p className="font-medium mb-1">Simulacao de encargos</p>
          <p className="text-mid">
            Para uma parcela de R${formatBRL(SAMPLE_AMOUNT)} vencida ha {SAMPLE_DAYS_OVERDUE} dias
            {gracePeriodDays > 0 && ` (carencia de ${gracePeriodDays} dias)`}:
          </p>
          <p className="mt-1 font-medium">
            multa R${formatBRL(fine)} + juros R${formatBRL(interest)} = R${formatBRL(total)}
          </p>
        </div>
      </div>
    </div>
  )
}

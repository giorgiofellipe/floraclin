'use client'

import { useEffect, useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCardTerminals } from '@/hooks/queries/use-card-terminals'
import {
  buildCardSchedule,
  describeCardSchedule,
  type CardTerminalTerms,
} from '@/lib/financial/card-repasses'
import { formatCurrency } from '@/lib/utils'

export interface CardPaymentValue {
  terminalId: string | null
  installmentCount: number
}

interface CardPaymentFieldsProps {
  method: 'credit_card' | 'debit_card'
  gross: number
  paymentYmd: string
  value: CardPaymentValue
  onChange: (v: CardPaymentValue) => void
  lockInstallmentCount?: boolean
  disabled?: boolean
}

const INSTALLMENT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}x`]),
)

const LABEL_CLASS = 'uppercase tracking-wider text-xs font-medium text-mid'

function formatRate(rate: number): string {
  return rate.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function CardPaymentFields({
  method,
  gross,
  paymentYmd,
  value,
  onChange,
  lockInstallmentCount,
  disabled,
}: CardPaymentFieldsProps) {
  const { data } = useCardTerminals()
  const terminals = useMemo(() => data?.data ?? [], [data])
  const defaultTerminal = terminals.find((t) => t.isDefault)
  const terminal = terminals.find((t) => t.id === value.terminalId)

  useEffect(() => {
    if (value.terminalId === null && defaultTerminal) {
      onChange({ ...value, terminalId: defaultTerminal.id })
    }
  }, [value, defaultTerminal, onChange])

  const schedule = useMemo(() => {
    if (!terminal || !(gross > 0)) return null
    const terms: CardTerminalTerms = {
      debitRate: Number(terminal.debitRate),
      debitPayoutDays: terminal.debitPayoutDays,
      creditRates: terminal.creditRates.map(Number),
      creditPayoutMode: terminal.creditPayoutMode as CardTerminalTerms['creditPayoutMode'],
      creditLumpSumDays: terminal.creditLumpSumDays,
    }
    return buildCardSchedule({
      gross,
      method,
      installmentCount: value.installmentCount,
      terms,
      paymentYmd,
    })
  }, [terminal, gross, method, value.installmentCount, paymentYmd])

  if (terminals.length === 0) {
    return (
      <p className="text-sm text-mid">Cadastre uma maquininha em Configurações › Financeiro.</p>
    )
  }

  const terminalItems = Object.fromEntries(terminals.map((t) => [t.id, t.name]))
  const feeLabel =
    schedule?.payoutMode === 'lump_sum'
      ? `Taxa com antecipação (${formatRate(schedule.rate)}%)`
      : `Taxa (${schedule ? formatRate(schedule.rate) : ''}%)`

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className={LABEL_CLASS}>Maquininha</Label>
        <Select
          items={terminalItems}
          value={value.terminalId ?? ''}
          onValueChange={(v) => onChange({ ...value, terminalId: v || null })}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      {method === 'credit_card' && (
        <div className="space-y-2">
          <Label className={LABEL_CLASS}>Parcelas no cartão</Label>
          <Select
            items={INSTALLMENT_ITEMS}
            value={String(value.installmentCount)}
            onValueChange={(v) => onChange({ ...value, installmentCount: Number(v ?? 1) })}
            disabled={disabled || lockInstallmentCount}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
      )}

      {schedule && (
        <div className="rounded-lg bg-[#F4F6F8] border border-[#E8ECEF] p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Valor da venda</span>
            <span>{formatCurrency(schedule.grossAmount)}</span>
          </div>
          <div className="flex justify-between text-mid">
            <span>{feeLabel}</span>
            <span>− {formatCurrency(schedule.feeAmount)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Você recebe</span>
            <span>{formatCurrency(schedule.netAmount)}</span>
          </div>
          <p className="text-xs text-mid pt-1">{describeCardSchedule(schedule)}</p>
        </div>
      )}
    </div>
  )
}

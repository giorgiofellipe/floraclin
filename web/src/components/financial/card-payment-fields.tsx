'use client'

import { useEffect, useId, useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCardTerminals } from '@/hooks/queries/use-card-terminals'
import {
  buildCardSchedule,
  cardInstallmentCountFor,
  describeCardSchedule,
  isCardMethod,
  toCardTerminalTerms,
} from '@/lib/financial/card-repasses'
import { formatCurrency } from '@/lib/utils'

export interface CardPaymentValue {
  terminalId: string | null
  installmentCount: number
}

export function toCardPayload(
  method: string,
  value: CardPaymentValue,
): { terminalId: string; installmentCount: number } | undefined {
  if (!isCardMethod(method) || !value.terminalId) return undefined
  return {
    terminalId: value.terminalId,
    installmentCount: cardInstallmentCountFor(method, value.installmentCount),
  }
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
  const terminalId = useId()
  const installmentsId = useId()
  const { data, isLoading, isError } = useCardTerminals()
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
    const terms = toCardTerminalTerms(terminal)
    return buildCardSchedule({
      gross,
      method,
      installmentCount: value.installmentCount,
      terms,
      paymentYmd,
    })
  }, [terminal, gross, method, value.installmentCount, paymentYmd])

  if (isLoading) return <p className="text-sm text-mid">Carregando maquininhas...</p>
  if (isError) return <p className="text-sm text-mid">Não foi possível carregar as maquininhas.</p>
  if (terminals.length === 0) {
    return (
      <p className="text-sm text-mid">Cadastre uma maquininha em Configurações › Financeiro.</p>
    )
  }

  const terminalItems = Object.fromEntries(terminals.map((t) => [t.id, t.name]))

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={terminalId} className={LABEL_CLASS}>Maquininha</Label>
        <Select
          items={terminalItems}
          value={value.terminalId ?? ''}
          onValueChange={(v) => onChange({ ...value, terminalId: v || null })}
          disabled={disabled}
        >
          <SelectTrigger id={terminalId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      {method === 'credit_card' && (
        <div className="space-y-2">
          <Label htmlFor={installmentsId} className={LABEL_CLASS}>Parcelas no cartão</Label>
          <Select
            items={INSTALLMENT_ITEMS}
            value={String(value.installmentCount)}
            onValueChange={(v) => onChange({ ...value, installmentCount: Number(v ?? 1) })}
            disabled={disabled || lockInstallmentCount}
          >
            <SelectTrigger id={installmentsId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
      )}

      {schedule && (
        <div className="rounded-lg bg-content-bg border border-topbar-border p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Valor da venda</span>
            <span>{formatCurrency(schedule.grossAmount)}</span>
          </div>
          <div className="flex justify-between text-mid">
            <span>
              {schedule.payoutMode === 'lump_sum'
                ? `Taxa com antecipação (${formatRate(schedule.rate)}%)`
                : `Taxa (${formatRate(schedule.rate)}%)`}
            </span>
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

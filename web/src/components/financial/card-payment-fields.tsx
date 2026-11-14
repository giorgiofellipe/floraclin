'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CardTerminalDialog } from '@/components/financial/settings/card-terminal-dialog'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCardTerminals, useCreateCardTerminal, useUpdateCardTerminal } from '@/hooks/queries/use-card-terminals'
import { cardTerminalSchema, type CardTerminalInput } from '@/validations/card-terminals'
import type { CardTerminalRow } from '@/db/queries/card-terminals'
import {
  buildCardSchedule,
  cardInstallmentCountFor,
  cardRateFor,
  describeCardSchedule,
  isCardMethod,
  toCardTerminalTerms,
  type CardMethod,
} from '@/lib/financial/card-repasses'
import { cn, formatCurrency } from '@/lib/utils'

export interface CardPaymentValue {
  terminalId: string | null
  installmentCount: number
  expectedRate: number | null
}

export function toCardPayload(
  method: string,
  value: CardPaymentValue,
): { terminalId: string; installmentCount: number; expectedRate: number } | undefined {
  if (!isCardMethod(method) || !value.terminalId || value.expectedRate === null) return undefined
  return {
    terminalId: value.terminalId,
    installmentCount: cardInstallmentCountFor(method, value.installmentCount),
    expectedRate: value.expectedRate,
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
  const [creating, setCreating] = useState(false)
  const { data, isLoading, isError } = useCardTerminals()
  const terminals = useMemo(() => data?.data ?? [], [data])
  const defaultTerminal = terminals.find((t) => t.isDefault)
  const terminal = terminals.find((t) => t.id === value.terminalId)

  useEffect(() => {
    if (value.terminalId === null && defaultTerminal) {
      onChange({ ...value, terminalId: defaultTerminal.id })
    }
  }, [value, defaultTerminal, onChange])

  const terms = useMemo(() => (terminal ? toCardTerminalTerms(terminal) : null), [terminal])
  const saleRateUnknown = terms !== null && cardRateFor(terms, method, value.installmentCount) === null

  const schedule = useMemo(() => {
    if (!terms || saleRateUnknown || !(gross > 0)) return null
    return buildCardSchedule({
      gross,
      method,
      installmentCount: value.installmentCount,
      terms,
      paymentYmd,
    })
  }, [terms, saleRateUnknown, gross, method, value.installmentCount, paymentYmd])

  const displayedRate = schedule?.rate ?? null
  useEffect(() => {
    if (value.expectedRate !== displayedRate) onChange({ ...value, expectedRate: displayedRate })
  }, [value, displayedRate, onChange])

  if (isLoading) return <p className="text-sm text-mid">Carregando maquininhas...</p>
  if (isError) return <p className="text-sm text-mid">Não foi possível carregar as maquininhas.</p>
  if (terminals.length === 0) {
    if (!data?.canManage) {
      return (
        <p className="text-sm text-mid">Peça ao responsável da clínica para cadastrar uma maquininha.</p>
      )
    }
    return (
      <div className="space-y-2">
        <SaleRateForm
          method={method}
          installmentCount={value.installmentCount}
          disabled={disabled}
          onSaved={(id) => onChange({ ...value, terminalId: id })}
        />
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-mid"
          onClick={() => setCreating(true)}
          disabled={disabled}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Cadastrar maquininha
        </Button>
        <CardTerminalDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(created) => onChange({ ...value, terminalId: created.id })}
        />
      </div>
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

      {terminal && saleRateUnknown && (
        data?.canManage ? (
          <SaleRateForm
            key={`${terminal.id}-${method}-${value.installmentCount}`}
            method={method}
            installmentCount={value.installmentCount}
            terminal={terminal}
            disabled={disabled}
            onSaved={() => {}}
          />
        ) : (
          <p className="text-sm text-mid">
            Peça ao responsável da clínica para informar a {rateLabelFor(method, value.installmentCount).replace(' (%)', '').toLowerCase()} da {terminal.name}.
          </p>
        )
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

function rateLabelFor(method: CardMethod, installmentCount: number): string {
  return method === 'debit_card'
    ? 'Taxa no débito (%)'
    : `Taxa no crédito em ${cardInstallmentCountFor(method, installmentCount)}x (%)`
}

/** The terminal's terms with only this sale's slot set to `rate`. */
function withSaleRate(
  terms: Pick<CardTerminalInput, 'debitRate' | 'creditRates'>,
  method: CardMethod,
  installmentCount: number,
  rate: number,
): Pick<CardTerminalInput, 'debitRate' | 'creditRates'> {
  if (method === 'debit_card') return { debitRate: rate, creditRates: terms.creditRates }
  const slot = cardInstallmentCountFor(method, installmentCount) - 1
  return { debitRate: terms.debitRate, creditRates: terms.creditRates.map((r, i) => (i === slot ? rate : r)) }
}

const UNKNOWN_RATES: Pick<CardTerminalInput, 'debitRate' | 'creditRates'> = {
  debitRate: null,
  creditRates: Array.from({ length: 12 }, () => null),
}

/**
 * Asks for the one rate this sale needs: on the first card sale it also names
 * and saves the terminal; on a terminal that does not know this slot yet it
 * fills just that slot. The other rates stay unknown until a sale or
 * Configurações › Financeiro sets them, so no sale is priced at a guessed fee.
 */
function SaleRateForm({
  method,
  installmentCount,
  terminal,
  disabled,
  onSaved,
}: {
  method: CardMethod
  installmentCount: number
  terminal?: CardTerminalRow
  disabled?: boolean
  onSaved: (terminalId: string) => void
}) {
  const nameId = useId()
  const rateId = useId()
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const createTerminal = useCreateCardTerminal()
  const updateTerminal = useUpdateCardTerminal()
  const saving = createTerminal.isPending || updateTerminal.isPending

  async function save() {
    if (rate.trim() === '') {
      toast.error('Informe a taxa')
      return
    }
    const value = Number(rate.replace(',', '.'))
    const base = terminal
      ? {
          name: terminal.name,
          isDefault: terminal.isDefault,
          debitPayoutDays: terminal.debitPayoutDays,
          creditPayoutMode: terminal.creditPayoutMode,
          creditLumpSumDays: terminal.creditLumpSumDays,
          payoutAccountId: terminal.payoutAccountId,
          ...withSaleRate(
            {
              debitRate: terminal.debitRate === null ? null : Number(terminal.debitRate),
              creditRates: terminal.creditRates.map((r) => (r === null ? null : Number(r))),
            },
            method,
            installmentCount,
            value,
          ),
        }
      : {
          name,
          isDefault: true,
          debitPayoutDays: 1,
          creditPayoutMode: 'per_installment' as const,
          creditLumpSumDays: 1,
          payoutAccountId: null,
          ...withSaleRate(UNKNOWN_RATES, method, installmentCount, value),
        }
    const parsed = cardTerminalSchema.safeParse(base)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message)
      return
    }
    try {
      if (terminal) {
        await updateTerminal.mutateAsync({ id: terminal.id, ...parsed.data })
        onSaved(terminal.id)
      } else {
        const created = await createTerminal.mutateAsync(parsed.data)
        onSaved(created.data.id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar maquininha')
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-topbar-border bg-content-bg p-3" data-testid="sale-rate-form">
      <p className="text-sm text-mid">
        {terminal
          ? `${terminal.name} ainda não tem a taxa desta venda. Informe para registrar agora.`
          : 'Nenhuma maquininha cadastrada. Informe a taxa desta venda para registrar agora.'}
      </p>
      <div className={cn('grid gap-2', !terminal && 'grid-cols-2')}>
        {!terminal && (
          <div className="space-y-1">
            <Label htmlFor={nameId} className={LABEL_CLASS}>Maquininha</Label>
            <Input id={nameId} value={name} placeholder="Ex.: Stone" onChange={(e) => setName(e.target.value)} disabled={disabled} />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor={rateId} className={LABEL_CLASS}>{rateLabelFor(method, installmentCount)}</Label>
          <Input id={rateId} inputMode="decimal" value={rate} placeholder="0,00" onChange={(e) => setRate(e.target.value)} disabled={disabled} />
        </div>
      </div>
      <p className="text-xs text-mid">As outras taxas ficam em branco até uma venda pedir. Ajuste em Configurações › Financeiro.</p>
      <Button type="button" size="sm" onClick={save} disabled={disabled || saving}>
        {saving ? 'Salvando...' : terminal ? 'Salvar taxa' : 'Salvar maquininha'}
      </Button>
    </div>
  )
}

'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CardTerminalDialog } from '@/components/financial/settings/card-terminal-dialog'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCardTerminals, useCreateCardTerminal } from '@/hooks/queries/use-card-terminals'
import { cardTerminalSchema } from '@/validations/card-terminals'
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
        <QuickTerminalForm
          method={method}
          installmentCount={value.installmentCount}
          disabled={disabled}
          onCreated={(id) => onChange({ ...value, terminalId: id })}
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

/**
 * The first card sale without a terminal: a name and this sale's rate are
 * enough. Every other rate starts at the same value, which the summary of
 * each later sale shows until the owner adjusts it.
 */
function QuickTerminalForm({
  method,
  installmentCount,
  disabled,
  onCreated,
}: {
  method: 'credit_card' | 'debit_card'
  installmentCount: number
  disabled?: boolean
  onCreated: (terminalId: string) => void
}) {
  const nameId = useId()
  const rateId = useId()
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const createTerminal = useCreateCardTerminal()
  const rateLabel =
    method === 'debit_card' ? 'Taxa no débito (%)' : `Taxa no crédito em ${cardInstallmentCountFor(method, installmentCount)}x (%)`

  async function save() {
    if (rate.trim() === '') {
      toast.error('Informe a taxa')
      return
    }
    const value = Number(rate.replace(',', '.'))
    const parsed = cardTerminalSchema.safeParse({
      name,
      isDefault: true,
      debitRate: value,
      debitPayoutDays: 1,
      creditRates: Array.from({ length: 12 }, () => value),
      creditPayoutMode: 'per_installment',
      creditLumpSumDays: 1,
      payoutAccountId: null,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message)
      return
    }
    try {
      const created = await createTerminal.mutateAsync(parsed.data)
      onCreated(created.data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar maquininha')
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-topbar-border bg-content-bg p-3" data-testid="quick-terminal">
      <p className="text-sm text-mid">Nenhuma maquininha cadastrada. Informe a taxa desta venda para registrar agora.</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={nameId} className={LABEL_CLASS}>Maquininha</Label>
          <Input id={nameId} value={name} placeholder="Ex.: Stone" onChange={(e) => setName(e.target.value)} disabled={disabled} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={rateId} className={LABEL_CLASS}>{rateLabel}</Label>
          <Input id={rateId} inputMode="decimal" value={rate} placeholder="0,00" onChange={(e) => setRate(e.target.value)} disabled={disabled} />
        </div>
      </div>
      <p className="text-xs text-mid">As outras taxas começam com este valor. Ajuste em Configurações › Financeiro.</p>
      <Button type="button" size="sm" onClick={save} disabled={disabled || createTerminal.isPending}>
        {createTerminal.isPending ? 'Salvando...' : 'Salvar maquininha'}
      </Button>
    </div>
  )
}

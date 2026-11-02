'use client'

import { Trash2 } from 'lucide-react'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import { MaskedInput } from '@/components/ui/masked-input'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { quoteTotal } from '@/lib/diagram-quote'
import type { QuotationLine } from '@/validations/face-diagram-group'
import { formatCurrency } from '@/lib/utils'

interface ProcedureTypeOption {
  id: string
  name: string
  defaultPrice: string | null
  isActive: boolean
}


interface QuotationLinesEditorProps {
  value: QuotationLine[]
  onChange: (lines: QuotationLine[]) => void
  readOnly?: boolean
}

export function QuotationLinesEditor({ value, onChange, readOnly = false }: QuotationLinesEditorProps) {
  const { data } = useProcedureTypes()
  const types = (data ?? []) as ProcedureTypeOption[]
  const available = types.filter(
    (t) => t.isActive && !value.some((l) => l.procedureTypeId === t.id),
  )

  function update(index: number, patch: Partial<QuotationLine>) {
    onChange(value.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addType(typeId: string) {
    const type = types.find((t) => t.id === typeId)
    if (!type) return
    onChange([
      ...value,
      {
        procedureTypeId: type.id,
        procedureTypeName: type.name,
        sessions: 1,
        unitPrice: type.defaultPrice ? Number(type.defaultPrice) : 0,
      },
    ])
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-mid">Nenhum procedimento no orçamento.</p>
      )}

      <ul className="space-y-2">
        {value.map((line, index) => (
          <li
            key={line.procedureTypeId}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-[3px] border border-sage/15 p-3 sm:grid-cols-[1fr_72px_130px_auto]"
          >
            <span className="text-sm font-medium text-charcoal">{line.procedureTypeName}</span>
            <div className="col-span-2 grid grid-cols-2 gap-2 sm:contents">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                aria-label={`Sessões de ${line.procedureTypeName}`}
                value={line.sessions}
                disabled={readOnly}
                onChange={(e) =>
                  update(index, {
                    sessions: Math.min(50, Math.max(1, Math.trunc(Number(e.target.value)) || 1)),
                  })
                }
              />
              <MaskedInput
                mask={maskCurrency}
                inputMode="numeric"
                aria-label={`Valor unitário de ${line.procedureTypeName}`}
                value={String(Math.round(line.unitPrice * 100))}
                disabled={readOnly}
                onChange={(e) => {
                  const parsed = parseCurrency(e.target.value)
                  update(index, { unitPrice: Number.isFinite(parsed) ? parsed : 0 })
                }}
              />
            </div>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover ${line.procedureTypeName}`}
                className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <select
          aria-label="Adicionar procedimento"
          value=""
          disabled={available.length === 0}
          onChange={(e) => addType(e.target.value)}
          className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-charcoal disabled:opacity-50"
        >
          <option value="">Adicionar procedimento...</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center justify-between border-t border-sage/15 pt-3 text-sm">
        <span className="text-mid">Total</span>
        <span className="font-medium text-forest" data-testid="quote-total">
          {formatCurrency(quoteTotal(value))}
        </span>
      </div>
    </div>
  )
}

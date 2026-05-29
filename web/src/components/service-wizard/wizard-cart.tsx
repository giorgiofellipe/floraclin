'use client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { type AtendimentoCart, computeCartTotal } from '@/validations/atendimento-cart'
import { formatCurrency } from '@/lib/utils'

interface WizardCartProps {
  cart: AtendimentoCart
  onChange: (next: AtendimentoCart) => void
  onRemoveLine: (procedureTypeId: string) => void
  onClearTemplate: () => void
}

export function WizardCart({ cart, onChange, onRemoveLine, onClearTemplate }: WizardCartProps) {
  const total = computeCartTotal(cart)
  return (
    <Card className="sticky bottom-4 border-primary/20">
      <CardContent className="p-4 space-y-3">
        {cart.templateId && (
          <div className="flex items-center justify-between rounded-md bg-primary/5 px-3 py-2">
            <div>
              <div className="text-sm font-medium">{cart.templateName}</div>
              <div className="text-xs text-muted-foreground">Pacote · {formatCurrency(cart.templateDefaultPrice ?? 0)}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClearTemplate}>Remover</Button>
          </div>
        )}
        <ul className="space-y-2">
          {cart.lines.map((line) => (
            <li key={line.procedureTypeId} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{line.procedureTypeName}</span>
              <Input
                type="number"
                min={1}
                max={50}
                value={line.sessions}
                disabled={line.sourceTemplateLineId !== null}
                className="w-20"
                onChange={(e) => {
                  const sessions = Math.max(1, Number(e.target.value) || 1)
                  onChange({ ...cart, lines: cart.lines.map((l) => l.procedureTypeId === line.procedureTypeId ? { ...l, sessions } : l) })
                }}
              />
              <span className="w-24 text-right text-sm">{formatCurrency(line.defaultPrice * line.sessions)}</span>
              {line.sourceTemplateLineId === null && (
                <Button variant="ghost" size="icon" onClick={() => onRemoveLine(line.procedureTypeId)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <Input
            type="number"
            min={0}
            value={cart.totalOverride ?? total}
            className="w-32 text-right"
            onChange={(e) => {
              const v = e.target.value
              onChange({ ...cart, totalOverride: v === '' ? null : Math.max(0, Number(v)) })
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

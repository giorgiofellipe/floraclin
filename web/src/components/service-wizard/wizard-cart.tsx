'use client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type EncounterCart, computeCartTotal } from '@/validations/encounter-cart'
import { formatCurrency } from '@/lib/utils'
// Session count constraints — used by the +/- stepper and the bare input.
const MIN_SESSIONS = 1
const MAX_SESSIONS = 50
import { maskCurrency, parseCurrency } from '@/lib/masks'

interface WizardCartProps {
  cart: EncounterCart
  onChange: (next: EncounterCart) => void
  onRemoveLine: (procedureTypeId: string) => void
  onClearTemplate: () => void
  /**
   * Render as a read-only preview. Used in step 2 (Procedimentos) so the cart
   * is just a confirmation; editing happens in step 4 (Aprovação).
   */
  readOnly?: boolean
  /**
   * Optional hint shown inside the card (above the lines). Used in step 2 to
   * explain that the preview is editable later.
   */
  previewHint?: string
}

export function WizardCart({
  cart,
  onChange,
  onRemoveLine,
  onClearTemplate,
  readOnly = false,
  previewHint,
}: WizardCartProps) {
  const total = computeCartTotal(cart)
  // Natural sum = what the total WOULD be without an override. Used to decide
  // whether the user typed back the natural value (in which case we clear the
  // override) or a different one (in which case we keep it). `total` itself
  // already equals `totalOverride` when one is set, so it can't be the
  // comparison source.
  const naturalTotal =
    (cart.templateDefaultPrice ?? 0) +
    cart.lines
      .filter((l) => l.sourceTemplateLineId === null)
      .reduce((sum, l) => sum + l.defaultPrice * l.sessions, 0)

  return (
    <Card className="ring-0 border border-primary/20">
      <CardContent className="p-4 space-y-3">
        {previewHint && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {previewHint}
          </p>
        )}
        {cart.templateId && (
          <div className="flex items-center justify-between rounded-md bg-primary/5 px-3 py-2">
            <div>
              <div className="text-sm font-medium">{cart.templateName}</div>
              <div className="text-xs text-muted-foreground">
                Pacote · {formatCurrency(cart.templateDefaultPrice ?? 0)}
              </div>
            </div>
            {!readOnly && (
              <Button variant="ghost" size="sm" onClick={onClearTemplate}>
                Remover
              </Button>
            )}
          </div>
        )}

        {cart.lines.length > 0 && (
          <div className="flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">Procedimento</span>
            {/* Stepper column is wider than the bare input was so the
                -/+ buttons + tabular value sit comfortably under the
                "Sessões" header. */}
            <span className={cn(readOnly ? 'w-12' : 'w-24', 'text-center')}>
              Sessões
            </span>
            <span className="w-24 text-right">Valor</span>
            {!readOnly && <span className="w-9 shrink-0" aria-hidden />}
          </div>
        )}

        <ul className="space-y-2">
          {cart.lines.map((line) => {
            const isTemplateLine = line.sourceTemplateLineId !== null
            const lineTotal = line.defaultPrice * line.sessions
            return (
              <li key={line.procedureTypeId} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{line.procedureTypeName}</span>
                {readOnly ? (
                  <span className="w-12 text-center text-sm tabular-nums">{line.sessions}</span>
                ) : (
                  // Sessions are editable on every line — including
                  // template-driven ones — so the clinician can customize
                  // the package contents for this specific atendimento (e.g.
                  // sell a 4-session Skinbooster instead of the template's
                  // default 3). The trash icon stays locked on template
                  // lines so the line itself can't be removed.
                  <SessionsStepper
                    value={line.sessions}
                    onChange={(sessions) =>
                      onChange({
                        ...cart,
                        lines: cart.lines.map((l) =>
                          l.procedureTypeId === line.procedureTypeId
                            ? { ...l, sessions }
                            : l,
                        ),
                      })
                    }
                  />
                )}
                <span className="w-24 text-right text-sm tabular-nums">
                  {isTemplateLine ? (
                    <span className="text-[11px] uppercase tracking-wider text-sage">incluído</span>
                  ) : (
                    formatCurrency(lineTotal)
                  )}
                </span>
                {!readOnly && (
                  <div className="flex w-9 shrink-0 items-center justify-center">
                    {line.sourceTemplateLineId === null && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemoveLine(line.procedureTypeId)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">Total</span>
          {readOnly ? (
            <span className="text-sm font-medium tabular-nums">{formatCurrency(total)}</span>
          ) : (
            <Input
              type="text"
              inputMode="numeric"
              value={maskCurrency(
                String(Math.round((cart.totalOverride ?? total) * 100)),
              )}
              className="w-32 text-right tabular-nums"
              onChange={(e) => {
                const parsed = parseCurrency(e.target.value)
                // ±half-cent tolerance so float drift on per-line × sessions
                // doesn't stamp a spurious override when the user types back
                // the natural value.
                onChange({
                  ...cart,
                  totalOverride: Math.abs(parsed - naturalTotal) < 0.005 ? null : parsed,
                })
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Sessions stepper ─────────────────────────────────────────────────
// Compact -/+ control flanking the session count. Clamps to
// [MIN_SESSIONS, MAX_SESSIONS]. Input is narrow (12ch) because session
// counts are 1-2 digits in practice; the native spinner buttons are
// hidden via the spin-button removal classes (the explicit -/+ buttons
// take their place and are accessible on touch devices too).
function SessionsStepper({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  const clamp = (n: number) => Math.min(MAX_SESSIONS, Math.max(MIN_SESSIONS, n))
  const canDec = value > MIN_SESSIONS
  const canInc = value < MAX_SESSIONS
  return (
    <div className="inline-flex w-24 items-center overflow-hidden rounded-md border border-input bg-background">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={!canDec}
        aria-label="Diminuir sessões"
        className={cn(
          'flex h-8 w-7 shrink-0 items-center justify-center text-mid transition-colors',
          'hover:bg-cream/40 hover:text-charcoal',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mid',
        )}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        min={MIN_SESSIONS}
        max={MAX_SESSIONS}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value) || MIN_SESSIONS))}
        className={cn(
          'h-8 w-10 border-0 bg-transparent text-center text-sm tabular-nums outline-none',
          // Hide native spinner controls in favor of the explicit buttons.
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
        aria-label="Número de sessões"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={!canInc}
        aria-label="Aumentar sessões"
        className={cn(
          'flex h-8 w-7 shrink-0 items-center justify-center text-mid transition-colors',
          'hover:bg-cream/40 hover:text-charcoal',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mid',
        )}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

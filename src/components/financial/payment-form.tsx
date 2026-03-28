'use client'

import { useActionState, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createFinancialEntryAction, type FinancialActionState } from '@/actions/financial'
import { formatCurrency, formatDate } from '@/lib/utils'
import { addDays } from 'date-fns'
import { maskCurrency, parseCurrency } from '@/lib/masks'

interface Patient {
  id: string
  fullName: string
}

interface PaymentFormProps {
  patients: Patient[]
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function PaymentForm({ patients, open, onClose, onSuccess }: PaymentFormProps) {
  const [patientId, setPatientId] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [patientSearch, setPatientSearch] = useState('')

  const [state, formAction, isPending] = useActionState<FinancialActionState, FormData>(
    async (prevState, formData) => {
      const result = await createFinancialEntryAction(prevState, formData)
      if (result?.success) {
        onSuccess()
      }
      return result
    },
    null
  )

  const parsedAmount = totalAmount ? parseCurrency(totalAmount) : 0
  const parsedCount = parseInt(installmentCount, 10) || 1

  const installmentPreview = useMemo(() => {
    if (parsedAmount <= 0 || parsedCount < 1) return []

    const installmentAmount = Math.floor((parsedAmount * 100) / parsedCount) / 100
    const remainder = Math.round((parsedAmount - installmentAmount * parsedCount) * 100) / 100
    const today = new Date()

    return Array.from({ length: parsedCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      return {
        number: i + 1,
        amount,
        dueDate: addDays(today, i * 30),
      }
    })
  }, [parsedAmount, parsedCount])

  const filteredPatients = patients.filter((p) =>
    p.fullName.toLowerCase().includes(patientSearch.toLowerCase())
  )

  function handleAmountChange(value: string) {
    setTotalAmount(maskCurrency(value))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Cobrança</DialogTitle>
          <DialogDescription>
            Preencha os dados da cobrança e defina o parcelamento.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" data-testid="payment-form">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="totalAmount" value={parsedAmount} />
          <input type="hidden" name="installmentCount" value={parsedCount} />

          {/* Patient select */}
          <div className="space-y-1.5">
            <Label htmlFor="patientSelect">Paciente</Label>
            <Select value={patientId} onValueChange={(v) => setPatientId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o paciente" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state?.fieldErrors?.patientId && (
              <p className="text-sm text-destructive">{state.fieldErrors.patientId[0]}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Descrição</Label>
            <Input
              id="description"
              name="description"
              placeholder="Ex: Aplicação de toxina botulínica"
              required
            />
            {state?.fieldErrors?.description && (
              <p className="text-sm text-destructive">{state.fieldErrors.description[0]}</p>
            )}
          </div>

          {/* Total amount */}
          <div className="space-y-1.5">
            <Label htmlFor="totalAmountInput">Valor Total (R$)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <MaskedInput
                id="totalAmountInput"
                mask={maskCurrency}
                value={totalAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0,00"
                className="pl-9"
                inputMode="numeric"
                data-testid="payment-form-amount"
              />
            </div>
            {state?.fieldErrors?.totalAmount && (
              <p className="text-sm text-destructive">{state.fieldErrors.totalAmount[0]}</p>
            )}
          </div>

          {/* Installment count */}
          <div className="space-y-1.5">
            <Label htmlFor="installmentCountSelect">Parcelas</Label>
            <Select value={installmentCount} onValueChange={(v) => setInstallmentCount(v ?? '1')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state?.fieldErrors?.installmentCount && (
              <p className="text-sm text-destructive">{state.fieldErrors.installmentCount[0]}</p>
            )}
          </div>

          {/* Installment preview */}
          {installmentPreview.length > 0 && parsedAmount > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Prévia das parcelas</p>
              <div className="space-y-1">
                {installmentPreview.map((inst) => (
                  <div
                    key={inst.number}
                    className="flex items-center justify-between text-sm text-muted-foreground"
                  >
                    <span>
                      {inst.number}ª parcela — {formatDate(inst.dueDate)}
                    </span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(inst.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Observações opcionais..."
              rows={2}
            />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !patientId || parsedAmount <= 0} data-testid="payment-form-submit">
              {isPending ? 'Salvando...' : 'Criar Cobrança'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

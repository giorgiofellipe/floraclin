'use client'

import { useEffect, useMemo, useState } from 'react'

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
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateFinancialEntry } from '@/hooks/mutations/use-financial-mutations'
import { useFinancialSettings } from '@/hooks/queries/use-financial-settings'
import { formatCurrency, formatDate } from '@/lib/utils'
import { addDays } from 'date-fns'
import { toLocalYmd } from '@/lib/dates'
import { maskCurrency, parseCurrency } from '@/lib/masks'

const INSTALLMENT_COUNT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}x`])
)

interface PaymentFormProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  defaultPatient?: { id: string; fullName: string }
}

export function PaymentForm({ open, onClose, onSuccess, defaultPatient }: PaymentFormProps) {
  const [patientId, setPatientId] = useState(defaultPatient?.id ?? '')
  const [patientName, setPatientName] = useState(defaultPatient?.fullName ?? '')
  const [totalAmount, setTotalAmount] = useState('')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [customDueDates, setCustomDueDates] = useState<Record<number, string>>({})
  const [patientSearch, setPatientSearch] = useState('')
  const [patientOptions, setPatientOptions] = useState<{ id: string; fullName: string }[]>([])
  const [showPatientDropdown, setShowPatientDropdown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null)
  const createFinancialEntry = useCreateFinancialEntry()
  const isPending = createFinancialEntry.isPending
  const { data: settingsResponse } = useFinancialSettings()
  const settings = settingsResponse?.settings

  // Reset form on open
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync defaults on dialog open
      setPatientId(defaultPatient?.id ?? '')
      setPatientName(defaultPatient?.fullName ?? '')
      setTotalAmount('')
      setInstallmentCount('1')
      setCustomDueDates({})
      setPatientSearch('')
      setError(null)
      setFieldErrors(null)
    }
  }, [open, defaultPatient?.id, defaultPatient?.fullName])

  // Patient search
  useEffect(() => {
    if (patientSearch.length < 2 || defaultPatient?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale results when search is too short
      setPatientOptions([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: patientSearch, limit: '20' })
        const res = await fetch(`/api/patients?${params}`)
        if (res.ok) {
          const json = await res.json()
          const data = json.data ?? json
          setPatientOptions(
            (data as { id: string; fullName: string }[]).map((p) => ({
              id: p.id,
              fullName: p.fullName,
            }))
          )
        }
      } catch {
        // ignore
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [patientSearch, defaultPatient?.id])

  // Pre-fill defaults from financial settings
  useEffect(() => {
    if (settings) {
      if (settings.defaultInstallmentCount) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- settings arrive async; sync to form defaults on load
        setInstallmentCount(String(settings.defaultInstallmentCount))
      }
    }
  }, [settings])

  const parsedAmount = totalAmount ? parseCurrency(totalAmount) : 0
  const parsedCount = parseInt(installmentCount, 10) || 1

  const installmentPreview = useMemo(() => {
    if (parsedAmount <= 0 || parsedCount < 1) return []

    const installmentAmount = Math.floor((parsedAmount * 100) / parsedCount) / 100
    const remainder = Math.round((parsedAmount - installmentAmount * parsedCount) * 100) / 100
    const today = new Date()

    return Array.from({ length: parsedCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      const defaultDate = addDays(today, i * 30)
      const defaultDateStr = toLocalYmd(defaultDate)
      return {
        number: i + 1,
        amount,
        dueDate: customDueDates[i] ?? defaultDateStr,
      }
    })
  }, [parsedAmount, parsedCount, customDueDates])


  function handleAmountChange(value: string) {
    setTotalAmount(maskCurrency(value))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-charcoal">Nova Cobrança</DialogTitle>
          <DialogDescription className="text-mid">
            Preencha os dados da cobrança e defina o parcelamento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          setFieldErrors(null)
          const formData = new FormData(e.currentTarget)
          try {
            const dueDates = installmentPreview.map((inst) => inst.dueDate)
            await createFinancialEntry.mutateAsync({
              patientId,
              description: (formData.get('description') as string) || '',
              totalAmount: parsedAmount,
              installmentCount: parsedCount,
              customDueDates: dueDates,
              notes: (formData.get('notes') as string) || undefined,
            })
            onSuccess()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao criar cobrança')
          }
        }} className="space-y-5" data-testid="payment-form">

          {/* Patient search */}
          <div className="space-y-2">
            <Label htmlFor="patientSearch" className="uppercase tracking-wider text-xs font-medium text-mid">Paciente</Label>
            <div className="relative">
              <Input
                id="patientSearch"
                placeholder="Buscar paciente por nome..."
                value={patientName || patientSearch}
                disabled={!!defaultPatient?.id}
                onChange={(e) => {
                  const val = e.target.value
                  setPatientSearch(val)
                  setPatientId('')
                  setPatientName('')
                  setShowPatientDropdown(true)
                }}
                onFocus={() => setShowPatientDropdown(true)}
                onBlur={() => setTimeout(() => setShowPatientDropdown(false), 200)}
              />
              {showPatientDropdown && patientSearch.length >= 2 && (
                <div className="absolute top-full z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                  {patientOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setPatientId(p.id)
                        setPatientName(p.fullName)
                        setPatientSearch('')
                        setShowPatientDropdown(false)
                      }}
                    >
                      {p.fullName}
                    </button>
                  ))}
                  {patientOptions.length === 0 && (
                    <p className="px-3 py-2 text-sm text-mid">Nenhum paciente encontrado</p>
                  )}
                </div>
              )}
            </div>
            {fieldErrors?.patientId && (
              <p className="text-sm text-destructive">{fieldErrors.patientId[0]}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="uppercase tracking-wider text-xs font-medium text-mid">Descrição</Label>
            <Input
              id="description"
              name="description"
              placeholder="Ex: Aplicação de toxina botulínica"
              required
            />
            {fieldErrors?.description && (
              <p className="text-sm text-destructive">{fieldErrors.description[0]}</p>
            )}
          </div>

          {/* Total amount */}
          <div className="space-y-2">
            <Label htmlFor="totalAmountInput" className="uppercase tracking-wider text-xs font-medium text-mid">Valor Total (R$)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-charcoal">
                R$
              </span>
              <MaskedInput
                id="totalAmountInput"
                mask={maskCurrency}
                value={totalAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0,00"
                className="pl-10 text-lg font-medium"
                inputMode="numeric"
                data-testid="payment-form-amount"
              />
            </div>
            {fieldErrors?.totalAmount && (
              <p className="text-sm text-destructive">{fieldErrors.totalAmount[0]}</p>
            )}
          </div>

          {/* Installment count */}
          <div className="space-y-2">
            <Label htmlFor="installmentCountSelect" className="uppercase tracking-wider text-xs font-medium text-mid">Parcelas</Label>
            <Select items={INSTALLMENT_COUNT_ITEMS} value={installmentCount} onValueChange={(v) => { setInstallmentCount(v ?? '1'); setCustomDueDates({}) }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
            {fieldErrors?.installmentCount && (
              <p className="text-sm text-destructive">{fieldErrors.installmentCount[0]}</p>
            )}
          </div>

          {/* Installment preview */}
          {installmentPreview.length > 0 && parsedAmount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">Parcelas e vencimentos</p>
              <div className="space-y-2">
                {installmentPreview.map((inst) => (
                  <div
                    key={inst.number}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span className="text-mid w-20 shrink-0">
                      {inst.number}a parcela
                    </span>
                    <DatePicker
                      value={inst.dueDate}
                      onChange={(v) => {
                        setCustomDueDates((prev) => ({
                          ...prev,
                          [inst.number - 1]: v,
                        }))
                      }}
                      className="w-[150px]"
                    />
                    <span className="font-medium text-charcoal tabular-nums ml-auto">
                      {formatCurrency(inst.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="uppercase tracking-wider text-xs font-medium text-mid">Observações</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Observações opcionais..."
              rows={2}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter className="pt-2 border-t border-sage/10">
            <Button type="button" variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !patientId || parsedAmount <= 0} className="bg-forest text-cream hover:bg-sage transition-colors" data-testid="payment-form-submit">
              {isPending ? 'Salvando...' : 'Criar Cobrança'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

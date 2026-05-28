'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftIcon, CheckIcon, PackageIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatCurrency } from '@/lib/utils'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import {
  usePackageTemplates,
  useSellPackage,
  type PackageTemplate,
  type SellPackagePayload,
} from '@/hooks/queries/use-packages'

const PAYMENT_METHOD_LABELS: Record<SellPackagePayload['paymentMethod'], string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

const INSTALLMENT_COUNT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [
    String(i + 1),
    `${i + 1}x${i === 0 ? ' (à vista)' : ''}`,
  ]),
)

interface ProcedureTypeRecord {
  id: string
  name: string
  isActive: boolean
}

interface LineDraft {
  procedureTypeId: string
  procedureTypeName: string
  sessionsTotal: number
}

interface SellPackageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName?: string
  onSold?: (result: { packageId: string; financialEntryId: string }) => void
}

type WizardStep = 'template' | 'details' | 'payment'

export function SellPackageDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  onSold,
}: SellPackageDialogProps) {
  const { data: templates, isLoading: templatesLoading } = usePackageTemplates()
  const { data: procedureTypesRaw } = useProcedureTypes()
  const procedureTypes = (procedureTypesRaw ?? []) as ProcedureTypeRecord[]
  const activeProcedureTypes = procedureTypes.filter((pt) => pt.isActive)

  const sellPackage = useSellPackage()

  const [step, setStep] = useState<WizardStep>('template')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [validityMonths, setValidityMonths] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  const [paymentMethod, setPaymentMethod] =
    useState<SellPackagePayload['paymentMethod']>('pix')
  const [installmentCount, setInstallmentCount] = useState(1)

  // Reset state when the dialog opens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setStep('template')
      setSelectedTemplateId(null)
      setName('')
      setTotalAmount('')
      setValidityMonths('')
      setLines([])
      setPaymentMethod('pix')
      setInstallmentCount(1)
    }
  }, [open])

  const procedureTypeItems: Record<string, string> = useMemo(
    () =>
      activeProcedureTypes.reduce(
        (acc, pt) => {
          acc[pt.id] = pt.name
          return acc
        },
        {} as Record<string, string>,
      ),
    [activeProcedureTypes],
  )

  const totalAmountNumber = totalAmount ? parseCurrency(totalAmount) : 0

  function applyTemplate(template: PackageTemplate) {
    setSelectedTemplateId(template.id)
    setName(template.name)
    setTotalAmount(
      template.defaultPrice
        ? maskCurrency(
            String(Math.round(parseFloat(template.defaultPrice) * 100)),
          )
        : '',
    )
    setValidityMonths(
      template.validityMonths != null ? String(template.validityMonths) : '',
    )
    setLines(
      template.lines.map((l) => ({
        procedureTypeId: l.procedureTypeId,
        procedureTypeName: l.procedureTypeName,
        sessionsTotal: l.sessionsCount,
      })),
    )
    setStep('details')
  }

  function startCustom() {
    setSelectedTemplateId(null)
    setName('')
    setTotalAmount('')
    setValidityMonths('')
    setLines([{ procedureTypeId: '', procedureTypeName: '', sessionsTotal: 1 }])
    setStep('details')
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l
        const next = { ...l, ...patch }
        if (patch.procedureTypeId) {
          const found = activeProcedureTypes.find(
            (pt) => pt.id === patch.procedureTypeId,
          )
          if (found) next.procedureTypeName = found.name
        }
        return next
      }),
    )
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { procedureTypeId: '', procedureTypeName: '', sessionsTotal: 1 },
    ])
  }

  function removeLine(index: number) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    )
  }

  function goToPaymentStep() {
    if (!name.trim()) {
      toast.error('Informe o nome do pacote')
      return
    }
    if (totalAmountNumber <= 0) {
      toast.error('Informe o valor total do pacote')
      return
    }
    const cleanedLines = lines.filter(
      (l) => l.procedureTypeId && l.sessionsTotal > 0,
    )
    if (cleanedLines.length === 0) {
      toast.error('Adicione ao menos um procedimento ao pacote')
      return
    }
    setStep('payment')
  }

  async function handleConfirm() {
    const cleanedLines = lines.filter(
      (l) => l.procedureTypeId && l.sessionsTotal > 0,
    )

    const validityNumber = validityMonths ? parseInt(validityMonths, 10) : null
    if (
      validityNumber != null &&
      (isNaN(validityNumber) || validityNumber < 1)
    ) {
      toast.error('Validade inválida')
      return
    }

    const payload: SellPackagePayload = {
      patientId,
      templateId: selectedTemplateId,
      name: name.trim(),
      totalAmount: totalAmountNumber,
      validityMonths: validityNumber,
      lines: cleanedLines.map((l) => ({
        procedureTypeId: l.procedureTypeId,
        procedureTypeName: l.procedureTypeName,
        sessionsTotal: l.sessionsTotal,
      })),
      paymentMethod,
      installmentCount,
    }

    try {
      const res = await sellPackage.mutateAsync(payload)
      toast.success('Pacote vendido com sucesso')
      onSold?.(res.data)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao vender pacote')
    }
  }

  function renderStepIndicator() {
    const steps: Array<{ key: WizardStep; label: string }> = [
      { key: 'template', label: 'Modelo' },
      { key: 'details', label: 'Detalhes' },
      { key: 'payment', label: 'Pagamento' },
    ]
    const currentIdx = steps.findIndex((s) => s.key === step)
    return (
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-mid">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-[10px] font-medium',
                i <= currentIdx
                  ? 'border-sage bg-sage text-cream'
                  : 'border-[#E8ECEF] bg-white text-mid',
              )}
            >
              {i < currentIdx ? <CheckIcon className="size-3" /> : i + 1}
            </span>
            <span className={i === currentIdx ? 'text-charcoal' : ''}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span className="mx-1 h-px w-4 bg-[#E8ECEF]" />
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Vender pacote</DialogTitle>
          {patientName && (
            <DialogDescription>
              Paciente: <span className="font-medium">{patientName}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        {renderStepIndicator()}

        {/* Step 1: Template */}
        {step === 'template' && (
          <div className="space-y-3">
            {templatesLoading ? (
              <p className="text-sm text-mid">Carregando modelos...</p>
            ) : !templates || templates.length === 0 ? (
              <div className="rounded-[3px] border border-dashed border-[#E8ECEF] p-4 text-center text-sm text-mid">
                Nenhum modelo de pacote cadastrado. Inicie um pacote
                personalizado abaixo.
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {templates
                  .filter((t) => t.isActive)
                  .map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      className="w-full rounded-[3px] border border-[#E8ECEF] bg-white p-3 text-left transition-colors hover:border-sage hover:bg-sage/5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-charcoal">
                            {template.name}
                          </div>
                          {template.description && (
                            <p className="mt-0.5 truncate text-xs text-mid">
                              {template.description}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {template.lines.map((l) => (
                              <span
                                key={l.id}
                                className="inline-flex items-center rounded-full bg-sage/10 px-1.5 py-0.5 text-[11px] text-sage"
                              >
                                {l.procedureTypeName} · {l.sessionsCount}x
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium tabular-nums text-charcoal">
                            {template.defaultPrice
                              ? formatCurrency(parseFloat(template.defaultPrice))
                              : '—'}
                          </div>
                          {template.validityMonths != null && (
                            <div className="text-[11px] text-mid">
                              {template.validityMonths} meses
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={startCustom}
              className="w-full"
            >
              <PackageIcon data-icon="inline-start" />
              Pacote personalizado
            </Button>
          </div>
        )}

        {/* Step 2: Details */}
        {step === 'details' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sell-name">Nome do pacote *</Label>
              <Input
                id="sell-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Combo Skinbooster"
                maxLength={255}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sell-total">Valor total (R$) *</Label>
                <MaskedInput
                  id="sell-total"
                  mask={maskCurrency}
                  inputMode="numeric"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sell-validity">Validade (meses)</Label>
                <Input
                  id="sell-validity"
                  type="number"
                  min={1}
                  max={120}
                  value={validityMonths}
                  onChange={(e) => setValidityMonths(e.target.value)}
                  placeholder="Sem prazo"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Procedimentos *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={addLine}
                >
                  <PlusIcon data-icon="inline-start" />
                  Adicionar
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((line, index) => (
                  <div
                    key={index}
                    className="flex items-end gap-2 rounded-[3px] border border-[#E8ECEF] bg-[#FAFBFC] p-3"
                  >
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-mid">Procedimento</Label>
                      <Select
                        items={procedureTypeItems}
                        value={line.procedureTypeId}
                        onValueChange={(v) =>
                          updateLine(index, { procedureTypeId: v ?? '' })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent />
                      </Select>
                    </div>

                    <div className="w-24 space-y-1">
                      <Label className="text-xs text-mid">Sessões</Label>
                      <Input
                        type="number"
                        min={1}
                        max={99}
                        value={line.sessionsTotal}
                        onChange={(e) =>
                          updateLine(index, {
                            sessionsTotal: Math.max(
                              1,
                              parseInt(e.target.value, 10) || 1,
                            ),
                          })
                        }
                      />
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeLine(index)}
                      disabled={lines.length <= 1}
                      title="Remover linha"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Payment */}
        {step === 'payment' && (
          <div className="space-y-4">
            <div className="rounded-[3px] bg-[#F4F6F8] p-3">
              <p className="text-xs text-mid">
                {name}{' '}
                {validityMonths && `· ${validityMonths} meses de validade`}
              </p>
              <p className="text-lg font-semibold text-charcoal tabular-nums">
                {formatCurrency(totalAmountNumber)}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Forma de pagamento *</Label>
                <Select
                  items={PAYMENT_METHOD_LABELS}
                  value={paymentMethod}
                  onValueChange={(v) =>
                    setPaymentMethod(
                      (v as SellPackagePayload['paymentMethod']) ?? 'pix',
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Parcelas</Label>
                <Select
                  items={INSTALLMENT_COUNT_ITEMS}
                  value={String(installmentCount)}
                  onValueChange={(v) =>
                    setInstallmentCount(parseInt(v ?? '1', 10))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>
            </div>

            {installmentCount > 1 && totalAmountNumber > 0 && (
              <p className="text-xs text-mid">
                {installmentCount}x de{' '}
                <span className="font-medium text-charcoal">
                  {formatCurrency(totalAmountNumber / installmentCount)}
                </span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step !== 'template' && (
            <Button
              variant="outline"
              onClick={() =>
                setStep(step === 'payment' ? 'details' : 'template')
              }
              disabled={sellPackage.isPending}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Voltar
            </Button>
          )}

          {step === 'details' && (
            <Button onClick={goToPaymentStep}>Continuar</Button>
          )}

          {step === 'payment' && (
            <Button onClick={handleConfirm} disabled={sellPackage.isPending}>
              {sellPackage.isPending ? 'Vendendo...' : 'Confirmar venda'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

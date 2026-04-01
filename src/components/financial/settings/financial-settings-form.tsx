'use client'

import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { PenaltyPreview } from './penalty-preview'
import { useFinancialSettings } from '@/hooks/queries/use-financial-settings'
import { useUpdateFinancialSettings } from '@/hooks/mutations/use-financial-settings-mutations'
import {
  updateFinancialSettingsSchema,
  type UpdateFinancialSettingsInput,
} from '@/validations/financial-settings'
import { toast } from 'sonner'
import { SaveIcon, Loader2Icon } from 'lucide-react'

const PIX_KEY_TYPES = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefone' },
  { value: 'random', label: 'Aleatoria' },
] as const

const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'credit_card', label: 'Cartao de Credito' },
  { value: 'debit_card', label: 'Cartao de Debito' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'transfer', label: 'Transferencia' },
] as const

export function FinancialSettingsForm() {
  const { data: settingsResponse, isLoading } = useFinancialSettings()
  const settings = settingsResponse?.settings
  const updateSettings = useUpdateFinancialSettings()

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<UpdateFinancialSettingsInput>({
    resolver: zodResolver(updateFinancialSettingsSchema),
    defaultValues: {
      fineType: 'percentage',
      fineValue: 2,
      monthlyInterestPercent: 1,
      gracePeriodDays: 0,
      bankName: '',
      bankAgency: '',
      bankAccount: '',
      pixKeyType: null,
      pixKey: '',
      defaultInstallmentCount: 1,
      defaultPaymentMethod: null,
    },
  })

  useEffect(() => {
    if (settings) {
      reset({
        fineType: settings.fineType || 'percentage',
        fineValue: Number(settings.fineValue) || 2,
        monthlyInterestPercent: Number(settings.monthlyInterestPercent) || 1,
        gracePeriodDays: settings.gracePeriodDays ?? 0,
        bankName: settings.bankName || '',
        bankAgency: settings.bankAgency || '',
        bankAccount: settings.bankAccount || '',
        pixKeyType: settings.pixKeyType || null,
        pixKey: settings.pixKey || '',
        defaultInstallmentCount: settings.defaultInstallmentCount || 1,
        defaultPaymentMethod: settings.defaultPaymentMethod || null,
      })
    }
  }, [settings, reset])

  const fineType = watch('fineType') || 'percentage'
  const fineValue = watch('fineValue') || 0
  const monthlyInterestPercent = watch('monthlyInterestPercent') || 0
  const gracePeriodDays = watch('gracePeriodDays') || 0

  async function onSubmit(data: UpdateFinancialSettingsInput) {
    try {
      await updateSettings.mutateAsync(data as Record<string, unknown>)
      toast.success('Configuracoes financeiras atualizadas com sucesso')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao atualizar configuracoes financeiras'
      )
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-[#4A6B52]" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Penalties Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Multa e Juros
          </h3>
          <div className="flex-1 h-px bg-[#E8ECEF]" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Fine type toggle */}
          <div className="space-y-2 sm:col-span-2">
            <Label>Tipo de Multa</Label>
            <div className="flex items-center gap-3">
              <span
                className={`text-sm ${fineType === 'percentage' ? 'text-[#2A2A2A] font-medium' : 'text-mid'}`}
              >
                Percentual
              </span>
              <Controller
                control={control}
                name="fineType"
                render={({ field }) => (
                  <Switch
                    checked={field.value === 'fixed'}
                    onCheckedChange={(checked) =>
                      field.onChange(checked ? 'fixed' : 'percentage')
                    }
                  />
                )}
              />
              <span
                className={`text-sm ${fineType === 'fixed' ? 'text-[#2A2A2A] font-medium' : 'text-mid'}`}
              >
                Valor Fixo (R$)
              </span>
            </div>
          </div>

          {/* Fine value */}
          <div className="space-y-2">
            <Label htmlFor="fineValue">
              Valor da Multa {fineType === 'percentage' ? '(%)' : '(R$)'}
            </Label>
            <Input
              id="fineValue"
              type="number"
              step="0.01"
              min="0"
              max={fineType === 'percentage' ? 2 : undefined}
              {...register('fineValue', { valueAsNumber: true })}
            />
            {errors.fineValue && (
              <p className="text-xs text-red-500">{errors.fineValue.message}</p>
            )}
          </div>

          {/* Monthly interest */}
          <div className="space-y-2">
            <Label htmlFor="monthlyInterestPercent">Juros Mensais (%)</Label>
            <Input
              id="monthlyInterestPercent"
              type="number"
              step="0.01"
              min="0"
              max="1"
              {...register('monthlyInterestPercent', { valueAsNumber: true })}
            />
            {errors.monthlyInterestPercent && (
              <p className="text-xs text-red-500">{errors.monthlyInterestPercent.message}</p>
            )}
          </div>

          {/* Grace period */}
          <div className="space-y-2">
            <Label htmlFor="gracePeriodDays">Carencia (dias)</Label>
            <Input
              id="gracePeriodDays"
              type="number"
              step="1"
              min="0"
              max="30"
              {...register('gracePeriodDays', { valueAsNumber: true })}
            />
            {errors.gracePeriodDays && (
              <p className="text-xs text-red-500">{errors.gracePeriodDays.message}</p>
            )}
          </div>
        </div>

        {/* Live penalty preview */}
        <PenaltyPreview
          fineType={fineType}
          fineValue={fineValue}
          monthlyInterestPercent={monthlyInterestPercent}
          gracePeriodDays={gracePeriodDays}
        />
      </div>

      {/* Bank Account Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Conta Bancaria
          </h3>
          <div className="flex-1 h-px bg-[#E8ECEF]" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="bankName">Banco</Label>
            <Input id="bankName" {...register('bankName')} placeholder="Ex: Itau" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bankAgency">Agencia</Label>
            <Input id="bankAgency" {...register('bankAgency')} placeholder="0001" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bankAccount">Conta</Label>
            <Input id="bankAccount" {...register('bankAccount')} placeholder="12345-6" />
          </div>
        </div>
      </div>

      {/* PIX Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">PIX</h3>
          <div className="flex-1 h-px bg-[#E8ECEF]" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Tipo de Chave PIX</Label>
            <Controller
              control={control}
              name="pixKeyType"
              render={({ field }) => (
                <Select
                  value={field.value || ''}
                  onValueChange={(val: string | null) => field.onChange(val || null)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {PIX_KEY_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pixKey">Chave PIX</Label>
            <Input id="pixKey" {...register('pixKey')} placeholder="Sua chave PIX" />
          </div>
        </div>
      </div>

      {/* Defaults Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Padroes
          </h3>
          <div className="flex-1 h-px bg-[#E8ECEF]" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="defaultInstallmentCount">Parcelas Padrao</Label>
            <Input
              id="defaultInstallmentCount"
              type="number"
              step="1"
              min="1"
              max="12"
              {...register('defaultInstallmentCount', { valueAsNumber: true })}
            />
            {errors.defaultInstallmentCount && (
              <p className="text-xs text-red-500">{errors.defaultInstallmentCount.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Metodo de Pagamento Padrao</Label>
            <Controller
              control={control}
              name="defaultPaymentMethod"
              render={({ field }) => (
                <Select
                  value={field.value || ''}
                  onValueChange={(val: string | null) => field.onChange(val || null)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o metodo" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={updateSettings.isPending || !isDirty}>
          {updateSettings.isPending ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <SaveIcon className="h-4 w-4" />
          )}
          Salvar Configuracoes
        </Button>
      </div>
    </form>
  )
}

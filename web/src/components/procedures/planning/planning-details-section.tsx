'use client'

import { Controller, type Control, type UseFormReturn } from 'react-hook-form'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/ui/date-picker'
import { FormFieldError } from '@/components/forms/form-field-error'
import type { ProcedurePlanningFormData } from '@/validations/procedure'

interface Props {
  control: Control<ProcedurePlanningFormData>
  form: UseFormReturn<ProcedurePlanningFormData>
  disabled?: boolean
  showClinicalFields?: boolean
  showFollowUpFields?: boolean
}

export function PlanningDetailsSection({
  control,
  form,
  disabled,
  showClinicalFields = true,
  showFollowUpFields = true,
}: Props) {
  return (
    <div className="space-y-5">
      {showClinicalFields && (
        <>
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Técnica utilizada
            </Label>
            <Textarea
              {...form.register('technique')}
              placeholder="Descreva a técnica utilizada..."
              disabled={disabled}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
            <FormFieldError form={form} name="technique" />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Resposta clínica
            </Label>
            <Textarea
              {...form.register('clinicalResponse')}
              placeholder="Descreva a resposta clínica observada..."
              disabled={disabled}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
            <FormFieldError form={form} name="clinicalResponse" />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Efeitos adversos
            </Label>
            <Textarea
              {...form.register('adverseEffects')}
              placeholder="Registre quaisquer efeitos adversos observados..."
              disabled={disabled}
              className="mt-1.5 min-h-[60px] resize-none border-sage/20 focus:border-sage/40"
              rows={2}
            />
            <FormFieldError form={form} name="adverseEffects" />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Observações gerais
            </Label>
            <Textarea
              {...form.register('notes')}
              placeholder="Observações adicionais..."
              disabled={disabled}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
            <FormFieldError form={form} name="notes" />
          </div>
        </>
      )}

      {showFollowUpFields && (
        <>
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Data do retorno
            </Label>
            <Controller
              control={control}
              name="followUpDate"
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ''}
                  onChange={(v) => field.onChange(v)}
                  disabled={disabled}
                  className="mt-1.5 max-w-xs"
                />
              )}
            />
            <FormFieldError form={form} name="followUpDate" />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Objetivos da próxima sessão
            </Label>
            <Textarea
              {...form.register('nextSessionObjectives')}
              placeholder="Descreva os objetivos para a próxima sessão..."
              disabled={disabled}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
            <FormFieldError form={form} name="nextSessionObjectives" />
          </div>
        </>
      )}
    </div>
  )
}

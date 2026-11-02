'use client'

import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { maskPhone } from '@/lib/masks'
import type { OnboardingFieldInteraction, OnboardingTrackedField } from '@/lib/analytics/events'

export interface ClinicStepValues {
  name: string
  phone: string
}

interface ClinicStepProps {
  values: ClinicStepValues
  onChange: (values: ClinicStepValues) => void
  /** First focus / first input per field, for the funnel. Field names only. */
  onFieldInteraction?: (field: OnboardingTrackedField, interaction: OnboardingFieldInteraction) => void
  /** Which field the last "Próximo" found missing, to mark it invalid. */
  invalidField?: OnboardingTrackedField | null
  /** The name is prefilled from the Google account and not edited yet. */
  nameSuggested?: boolean
}

/**
 * Onboarding's first step: the clinic's name and phone, nothing else. The
 * e-mail, address, hours, logo, booking link and monthly goal are in
 * Settings, so the first screen asks for two things and gets out of the way.
 *
 * Deliberately not the Settings form: that one pulls the logo uploader and
 * the tenant mutation into the onboarding bundle. Inputs are 16px on phones
 * (the Input default below md) so iOS does not zoom into them, and nothing is
 * autofocused, which would throw the keyboard up over the page on load.
 */
export function ClinicStep({
  values,
  onChange,
  onFieldInteraction,
  invalidField = null,
  nameSuggested = false,
}: ClinicStepProps) {
  return (
    <div className="grid gap-5">
      <div className="space-y-2">
        <Label htmlFor="clinic-name">Nome da clínica *</Label>
        <Input
          id="clinic-name"
          name="organization"
          autoComplete="organization"
          enterKeyHint="next"
          value={values.name}
          onFocus={() => onFieldInteraction?.('name', 'focus')}
          onInput={() => onFieldInteraction?.('name', 'input')}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder="Ex.: Clínica Bella Estética"
          aria-invalid={invalidField === 'name' || undefined}
          aria-describedby={nameSuggested ? 'clinic-name-hint' : undefined}
          required
          // Room for the action bar above the keyboard when the browser scrolls the field into view.
          className="h-11 scroll-mb-32"
        />
        {nameSuggested && (
          <p id="clinic-name-hint" className="text-xs text-charcoal/70">
            Sugerido a partir da sua conta Google. Ajuste se quiser.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="clinic-phone">Telefone *</Label>
        <MaskedInput
          id="clinic-phone"
          name="tel"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          enterKeyHint="done"
          mask={maskPhone}
          value={values.phone}
          onFocus={() => onFieldInteraction?.('phone', 'focus')}
          onInput={() => onFieldInteraction?.('phone', 'input')}
          onChange={(e) => onChange({ ...values, phone: e.target.value })}
          placeholder="(11) 99999-9999"
          aria-invalid={invalidField === 'phone' || undefined}
          aria-describedby="clinic-phone-hint"
          required
          // Room for the action bar above the keyboard when the browser scrolls the field into view.
          className="h-11 scroll-mb-32"
        />
        <p id="clinic-phone-hint" className="text-xs text-mid">
          Você receberá dicas da FloraClin por WhatsApp e e-mail durante o teste.
        </p>
      </div>
      <p className="text-xs text-mid">
        Endereço, horário de funcionamento, logo e link de agendamento ficam em Configurações, quando você quiser.
      </p>
    </div>
  )
}

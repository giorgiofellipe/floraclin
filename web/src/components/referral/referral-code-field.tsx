'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { REFERRAL_CODE_MAX_LENGTH, REFERRAL_WELCOME_MONTHS, REFERRAL_WELCOME_PERCENT } from '@/lib/referral/rules'

const REFERRAL_CODE_HINT = `Tem um código de indicação? Garanta ${REFERRAL_WELCOME_PERCENT}% de desconto nos ${REFERRAL_WELCOME_MONTHS} primeiros meses da assinatura.`

/**
 * Optional referral code input for the signup forms. The hint states the program's welcome offer from rules.ts;
 * whether a given code is valid is only checked on submit, and the paywall and billing page show the applied offer.
 * Label and input classes come from the host form so the field matches its siblings.
 */
export function ReferralCodeField({
  defaultCode,
  labelClassName,
  inputClassName,
}: {
  defaultCode: string | null
  labelClassName?: string
  inputClassName?: string
}) {
  const [open, setOpen] = useState(defaultCode !== null)

  if (!open) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-forest hover:text-sage transition-colors duration-200"
        >
          Tem um código de indicação?
        </button>
        <p className="text-xs text-mid">
          Garanta {REFERRAL_WELCOME_PERCENT}% de desconto nos {REFERRAL_WELCOME_MONTHS} primeiros meses da assinatura.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="referralCode" className={labelClassName}>
        Código de indicação
      </Label>
      <Input
        id="referralCode"
        name="referralCode"
        maxLength={REFERRAL_CODE_MAX_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        defaultValue={defaultCode ?? ''}
        placeholder="Ex.: DRAMICAELA"
        aria-describedby="referralCodeHint"
        className={inputClassName}
      />
      <p id="referralCodeHint" className="text-xs text-mid mt-1">
        {REFERRAL_CODE_HINT}
      </p>
    </div>
  )
}

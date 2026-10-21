'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Optional referral code input for the signup forms. Promises no discount: the paywall and billing page do that after validation. */
export function ReferralCodeField({ defaultCode }: { defaultCode: string | null }) {
  const [open, setOpen] = useState(defaultCode !== null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-forest hover:text-sage transition-colors duration-200"
      >
        Tem um código de indicação?
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="referralCode">Código de indicação</Label>
      <Input
        id="referralCode"
        name="referralCode"
        maxLength={12}
        autoCapitalize="characters"
        autoComplete="off"
        defaultValue={defaultCode ?? ''}
        placeholder="Ex.: MECA7K"
      />
    </div>
  )
}

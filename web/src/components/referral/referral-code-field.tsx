'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebounced } from '@/hooks/use-debounced'
import {
  REFERRAL_CODE_MAX_LENGTH,
  REFERRAL_CODE_MIN_LENGTH,
  REFERRAL_WELCOME_MONTHS,
  REFERRAL_WELCOME_PERCENT,
  normalizeReferralCode,
} from '@/lib/referral/rules'
import { shouldShowReferralFormatError } from '@/lib/referral/custom-code'

const OFFER = `${REFERRAL_WELCOME_PERCENT}% de desconto nos ${REFERRAL_WELCOME_MONTHS} primeiros meses da assinatura`
const CONTINUE = 'Você pode continuar o cadastro sem ele.'

export const REFERRAL_FIELD_COPY = {
  hint: `Tem um código de indicação? Garanta ${OFFER}.`,
  collapsedHint: `Garanta ${OFFER}.`,
  checking: 'Verificando código…',
  valid: `Código válido: ${OFFER}.`,
  notFound: `Código não encontrado. ${CONTINUE}`,
  badFormat: `Código inválido: use de ${REFERRAL_CODE_MIN_LENGTH} a ${REFERRAL_CODE_MAX_LENGTH} letras ou números. ${CONTINUE}`,
  unavailable: `Não foi possível verificar o código agora. ${CONTINUE}`,
} as const

/** Wait this long after the last keystroke before asking the server about the code. */
const LOOKUP_DEBOUNCE_MS = 400
/** Matches the endpoint's CDN cache closely enough; retyping a code within a minute does not refetch. */
const LOOKUP_STALE_MS = 60_000

type Lookup = { active: boolean }

type Status =
  | { kind: 'hint' }
  | { kind: 'checking' }
  | { kind: 'valid' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable' }

const STATUS_CLASS: Record<Status['kind'], string> = {
  hint: 'text-mid',
  checking: 'text-mid',
  valid: 'text-forest',
  invalid: 'text-red-600',
  unavailable: 'text-mid',
}

function statusText(status: Status): string {
  switch (status.kind) {
    case 'checking':
      return REFERRAL_FIELD_COPY.checking
    case 'valid':
      return REFERRAL_FIELD_COPY.valid
    case 'invalid':
      return status.message
    case 'unavailable':
      return REFERRAL_FIELD_COPY.unavailable
    default:
      return REFERRAL_FIELD_COPY.hint
  }
}

/**
 * Optional referral code input for the signup forms. Checks the code as the user types (public lookup, debounced)
 * and says inline whether it is valid. A bad code never blocks the form: the server ignores it and the account is
 * created without a referral. Label and input classes come from the host form so the field matches its siblings.
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
  const [value, setValue] = useState(defaultCode ?? '')
  const [blurred, setBlurred] = useState(false)
  // Focus the input when it appears because the user asked for it, not when it is open from the start.
  const [openedByUser, setOpenedByUser] = useState(false)

  const typed = value.trim()
  const code = normalizeReferralCode(typed)
  const debouncedCode = useDebounced(code, LOOKUP_DEBOUNCE_MS)
  const settled = code !== null && debouncedCode === code

  const lookup = useQuery<Lookup>({
    queryKey: ['referral-code-lookup', debouncedCode],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/referral/codes/${encodeURIComponent(debouncedCode!)}?fields=active`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: open && settled,
    retry: false,
    staleTime: LOOKUP_STALE_MS,
  })

  let status: Status = { kind: 'hint' }
  if (shouldShowReferralFormatError(typed, blurred)) status = { kind: 'invalid', message: REFERRAL_FIELD_COPY.badFormat }
  else if (code && (!settled || lookup.isFetching)) status = { kind: 'checking' }
  else if (code && lookup.isError) status = { kind: 'unavailable' }
  else if (code && lookup.data?.active) status = { kind: 'valid' }
  else if (code && lookup.data) status = { kind: 'invalid', message: REFERRAL_FIELD_COPY.notFound }

  if (!open) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setOpenedByUser(true)
          }}
          className="text-sm font-medium text-forest hover:text-sage transition-colors duration-200"
        >
          Tem um código de indicação?
        </button>
        <p className="text-xs text-mid">{REFERRAL_FIELD_COPY.collapsedHint}</p>
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
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setBlurred(true)}
        maxLength={REFERRAL_CODE_MAX_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="Ex.: DRAMICAELA"
        aria-describedby="referralCodeHint"
        aria-invalid={status.kind === 'invalid' || undefined}
        autoFocus={openedByUser}
        // Shown uppercase as typed (CSS keeps the caret and mobile keyboards intact); the server normalises it.
        className={`${inputClassName ?? ''} uppercase placeholder:normal-case`}
      />
      <p
        id="referralCodeHint"
        // Announce the outcome, not every "Verificando…" between keystrokes.
        aria-live={status.kind === 'checking' ? 'off' : 'polite'}
        className={`text-xs mt-1 ${STATUS_CLASS[status.kind]}`}
      >
        {statusText(status)}
      </p>
    </div>
  )
}

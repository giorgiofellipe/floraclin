'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { throwIfNotOk } from '@/hooks/throw-if-not-ok'
import { useDebounced } from '@/hooks/use-debounced'
import { CUSTOM_CODE_MESSAGES, MAX_PREVIOUS_REFERRAL_CODES, validateCustomReferralCode } from '@/lib/referral/custom-code'
import { REFERRAL_CODE_MAX_LENGTH, REFERRAL_CODE_MIN_LENGTH, shouldShowReferralFormatError } from '@/lib/referral/rules'

/** Wait this long after the last keystroke before asking the server whether the code is free. */
const AVAILABILITY_DEBOUNCE_MS = 400
// Shown uppercase as typed (CSS, so the caret and mobile keyboards behave); the value is normalised before use.
const UPPERCASE_INPUT = 'uppercase placeholder:normal-case'
const HINT = `De ${REFERRAL_CODE_MIN_LENGTH} a ${REFERRAL_CODE_MAX_LENGTH} letras ou números.`

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; message: string }
  | { state: 'error' }

type AvailabilityResponse = { available: boolean; message?: string }

/**
 * Lets the clinic replace its code with one it can say out loud (DRAMICAELA). Old codes keep working and stay the
 * clinic's; after MAX_PREVIOUS_REFERRAL_CODES of them it can only switch back to one (the server enforces it too).
 */
export function ReferralCodeEditor({ currentCode, previousCodes = [] }: { currentCode: string; previousCodes?: string[] }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const validation = validateCustomReferralCode(value)
  const normalized = validation.ok ? validation.code : null
  const isCurrent = normalized === currentCode
  const atAliasLimit =
    previousCodes.length >= MAX_PREVIOUS_REFERRAL_CODES && normalized !== null && !previousCodes.includes(normalized)
  const toCheck = editing && normalized && !isCurrent && !atAliasLimit ? normalized : null
  const debouncedToCheck = useDebounced(toCheck, AVAILABILITY_DEBOUNCE_MS)

  const check = useQuery<AvailabilityResponse>({
    queryKey: ['referral-code-availability', debouncedToCheck],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/referral/code?code=${encodeURIComponent(debouncedToCheck!)}`, { signal })
      await throwIfNotOk(res)
      return res.json()
    },
    enabled: debouncedToCheck !== null && debouncedToCheck === toCheck,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

  const availability = useMemo<Availability>(() => {
    if (!toCheck) return { state: 'idle' }
    if (debouncedToCheck !== toCheck || check.isFetching) return { state: 'checking' }
    if (check.isError) return { state: 'error' }
    if (!check.data) return { state: 'checking' }
    return check.data.available
      ? { state: 'available' }
      : { state: 'unavailable', message: check.data.message ?? '' }
  }, [toCheck, debouncedToCheck, check.isFetching, check.isError, check.data])

  const save = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch('/api/referral/code', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      await throwIfNotOk(res)
      return (await res.json()) as { code: string }
    },
    onSuccess: async ({ code }) => {
      toast.success(`Código alterado para ${code}`)
      setEditing(false)
      setValue('')
      await queryClient.invalidateQueries({ queryKey: ['referral'] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
      // A 409 usually means someone else took it since the check: re-check so the status and Save button reflect
      // that, and reload the dashboard in case the old-code list (alias limit) changed in another tab.
      if (toCheck) void check.refetch()
      void queryClient.invalidateQueries({ queryKey: ['referral'] })
    },
  })

  if (!editing) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-charcoal">
            Seu código: <span className="font-medium tracking-wide">{currentCode}</span>
          </p>
          <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => setEditing(true)}>
            Personalizar código
          </Button>
        </div>
        {previousCodes.length > 0 && (
          <p className="text-xs text-mid">
            Códigos anteriores, que continuam funcionando:{' '}
            <span className="font-medium tracking-wide">{previousCodes.join(', ')}</span>
          </p>
        )}
      </div>
    )
  }

  let formatMessage: string | null = null
  if (!validation.ok && (shouldShowReferralFormatError(value) || validation.reason === 'reserved')) {
    formatMessage = validation.message
  } else if (atAliasLimit) formatMessage = CUSTOM_CODE_MESSAGES.aliasLimit
  const canSave = availability.state === 'available' && !save.isPending

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave && normalized) save.mutate(normalized)
      }}
    >
      <Label htmlFor="customReferralCode">Novo código</Label>
      <Input
        id="customReferralCode"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={REFERRAL_CODE_MAX_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="Ex.: DRAMICAELA"
        aria-describedby="customReferralCodeStatus"
        className={UPPERCASE_INPUT}
      />
      <p id="customReferralCodeStatus" aria-live="polite" className="text-xs text-mid">
        <AvailabilityText formatMessage={formatMessage} isCurrent={isCurrent} availability={availability} />
      </p>
      <p className="rounded-[3px] bg-sage/10 px-3 py-2 text-xs text-charcoal">
        O link e o código atuais ({currentCode}) continuam funcionando e indicando para você, inclusive em posts já
        publicados. Divulgue o novo daqui para a frente. Nenhuma outra clínica poderá usar o código antigo.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSave}>
          {save.isPending ? 'Salvando…' : 'Salvar novo código'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setEditing(false)
            setValue('')
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function AvailabilityText({
  formatMessage,
  isCurrent,
  availability,
}: {
  formatMessage: string | null
  isCurrent: boolean
  availability: Availability
}) {
  if (formatMessage) return <>{formatMessage}</>
  if (isCurrent) return <>Esse já é o seu código.</>
  switch (availability.state) {
    case 'checking':
      return <>Verificando…</>
    case 'available':
      return <span className="text-forest">Disponível</span>
    case 'unavailable':
      return <>{availability.message}</>
    case 'error':
      return <>Não foi possível verificar agora. Tente de novo.</>
    default:
      return <>{HINT}</>
  }
}

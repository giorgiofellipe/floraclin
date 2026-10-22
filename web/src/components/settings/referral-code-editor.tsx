'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { throwIfNotOk } from '@/hooks/throw-if-not-ok'
import { validateCustomReferralCode } from '@/lib/referral/custom-code'
import { REFERRAL_CODE_MAX_LENGTH, REFERRAL_CODE_MIN_LENGTH } from '@/lib/referral/rules'

/** Wait this long after the last keystroke before asking the server whether the code is free. */
const AVAILABILITY_DEBOUNCE_MS = 400
const HINT = `De ${REFERRAL_CODE_MIN_LENGTH} a ${REFERRAL_CODE_MAX_LENGTH} letras ou números.`

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; message: string }
  | { state: 'error' }

type AvailabilityResponse = { available: boolean; message?: string }

/** `value` once it has stopped changing for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/** Lets the clinic replace its code with one it can say out loud (DRAMICAELA). The old code stops working on save. */
export function ReferralCodeEditor({ currentCode }: { currentCode: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const validation = validateCustomReferralCode(value)
  const normalized = validation.ok ? validation.code : null
  const isCurrent = normalized === currentCode
  const toCheck = editing && normalized && !isCurrent ? normalized : null
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
      // A 409 means someone else took it since the check: re-check so the status and Save button reflect that.
      void check.refetch()
    },
  })

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-charcoal">
          Seu código: <span className="font-medium tracking-wide">{currentCode}</span>
        </p>
        <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => setEditing(true)}>
          Personalizar código
        </Button>
      </div>
    )
  }

  // Not while the clinic is still typing a short code: only once it is long enough, or has a character we refuse.
  const typed = value.trim()
  const showFormat = typed.length >= REFERRAL_CODE_MIN_LENGTH || /[^A-Za-z0-9]/.test(typed)
  const formatMessage = showFormat && !validation.ok ? validation.message : null
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
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        maxLength={REFERRAL_CODE_MAX_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="Ex.: DRAMICAELA"
        aria-describedby="customReferralCodeStatus"
      />
      <p id="customReferralCodeStatus" aria-live="polite" className="text-xs text-mid">
        <AvailabilityText formatMessage={formatMessage} isCurrent={isCurrent} availability={availability} />
      </p>
      <p className="rounded-[3px] bg-amber-light px-3 py-2 text-xs text-amber-dark">
        Ao salvar, o link e o código atuais ({currentCode}) param de funcionar na hora, inclusive em posts já
        publicados. As clínicas que já se cadastraram com eles continuam contando para você.
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

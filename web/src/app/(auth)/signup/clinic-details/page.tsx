'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { createClinicForOAuthUser, type ClinicDetailsState } from '@/actions/signup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { maskPhone } from '@/lib/masks'

export default function ClinicDetailsPage() {
  const [state, formAction, isPending] = useActionState<ClinicDetailsState, FormData>(createClinicForOAuthUser, null)
  const router = useRouter()
  const { update } = useSession()

  // The action deliberately does not redirect. This session's JWT was minted
  // at Google sign-in, before any membership existed, so it still says
  // tenantId: null, and middleware sends anyone in that state straight back
  // here. Navigating without refreshing the token first is an infinite loop
  // between this page and itself.
  useEffect(() => {
    if (!state?.success) return
    void (async () => {
      await update()
      router.replace('/dashboard')
    })()
  }, [state?.success, update, router])

  return (
    <div>
      <div className="flex items-center gap-2 mb-8 lg:hidden">
        <img src="/brand/logo-mint.svg" alt="" className="size-8" />
        <span className="font-display text-xl font-semibold text-charcoal">
          Flora<span className="text-sage">Clin</span>
        </span>
      </div>

      <h2 className="text-2xl font-semibold text-charcoal">Dados da clínica</h2>
      <p className="text-sm text-mid mt-1 mb-6">Preencha os dados da sua clínica para continuar.</p>

      {state?.error?.general && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error.general[0]}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div>
          <Label htmlFor="clinicName">Nome da clínica</Label>
          <Input id="clinicName" name="clinicName" required />
          {state?.error?.clinicName && <p className="text-xs text-red-600 mt-1">{state.error.clinicName[0]}</p>}
        </div>

        <div>
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            onChange={(e) => { e.target.value = maskPhone(e.target.value) }}
          />
          {state?.error?.phone && <p className="text-xs text-red-600 mt-1">{state.error.phone[0]}</p>}
        </div>

        <Button type="submit" disabled={isPending} className="w-full bg-forest text-cream hover:bg-sage">
          {isPending ? 'Criando clínica...' : 'Continuar'}
        </Button>
      </form>
    </div>
  )
}

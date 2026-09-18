'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Asks for the address when we do not already know it.
 *
 * Signup no longer creates a session, so the address exists only in the
 * confirmation link. Anyone who closed that tab, or opened the app on another
 * device, arrives here with neither a session nor a query parameter. Before
 * this they were redirected to /login, where the password they had just
 * chosen was refused for being unconfirmed and the error said only that the
 * credentials were invalid: a dead end with no route back.
 *
 * Safe to expose. The resend endpoint answers identically for an unknown
 * address, an already-confirmed one and a throttled one, so this form cannot
 * be used to discover which addresses have accounts.
 */
export function RequestConfirmationForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    startTransition(async () => {
      try {
        await fetch('/api/auth/confirm/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        })
      } catch {
        // Deliberately ignored. Telling the user whether this succeeded would
        // reveal whether the address has an account, which is the one thing
        // the endpoint is careful not to say.
      }
      setSent(true)
    })
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-charcoal">
          Se houver uma conta aguardando confirmação para esse e-mail, enviamos um novo link.
        </p>
        <p className="text-sm text-mid">
          Verifique também a caixa de spam. O link vale por 24 horas.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="confirm-email-address">
          Informe seu e-mail para reenviar o link de confirmação
        </Label>
        <Input
          id="confirm-email-address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@clinica.com.br"
          data-testid="request-confirmation-email"
        />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? 'Enviando...' : 'Reenviar link de confirmação'}
      </Button>
    </form>
  )
}

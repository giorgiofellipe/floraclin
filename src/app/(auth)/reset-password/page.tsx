'use client'

import { useActionState } from 'react'
import { resetPassword, type ResetPasswordState } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const [state, formAction, isPending] = useActionState<ResetPasswordState, FormData>(resetPassword, null)

  return (
    <Card>
      <CardHeader className="text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          <span className="text-forest">Flora</span>
          <span className="text-sage">Clin</span>
        </h1>
        <CardTitle className="text-xl">Redefinir Senha</CardTitle>
        <CardDescription>Informe seu e-mail para receber o link de recuperação</CardDescription>
      </CardHeader>
      <CardContent>
        {state?.success ? (
          <div className="space-y-4">
            <p className="text-sm text-sage text-center">
              E-mail de recuperação enviado! Verifique sua caixa de entrada.
            </p>
            <div className="text-center">
              <Link href="/login" className="text-sm text-muted-foreground hover:underline">
                Voltar ao login
              </Link>
            </div>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            {state?.error && (
              <p className="text-sm text-red-600">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Enviando...' : 'Enviar link de recuperação'}
            </Button>
            <div className="text-center">
              <Link href="/login" className="text-sm text-muted-foreground hover:underline">
                Voltar ao login
              </Link>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

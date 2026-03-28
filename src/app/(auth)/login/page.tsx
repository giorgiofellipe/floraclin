'use client'

import { useActionState } from 'react'
import { login, type LoginState } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import Link from 'next/link'

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(login, null)

  return (
    <Card>
      <CardHeader className="text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          <span className="text-forest">Flora</span>
          <span className="text-sage">Clin</span>
        </h1>
        <CardDescription>Acesse sua conta</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="uppercase tracking-wider text-xs">E-mail</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="uppercase tracking-wider text-xs">Senha</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {state?.error?.general && (
            <p className="text-sm text-red-600">{state.error.general[0]}</p>
          )}
          <Button type="submit" className="w-full bg-forest text-cream hover:bg-sage uppercase tracking-wider" disabled={isPending}>
            {isPending ? 'Entrando...' : 'Entrar'}
          </Button>
          <div className="text-center">
            <Link href="/reset-password" className="text-sm text-sage hover:text-forest">
              Esqueci minha senha
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

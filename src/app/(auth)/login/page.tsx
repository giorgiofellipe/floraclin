'use client'

import { useActionState } from 'react'
import { login, type LoginState } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(login, null)

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">FloraClin</CardTitle>
        <CardDescription>Acesse sua conta</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {state?.error?.general && (
            <p className="text-sm text-red-600">{state.error.general[0]}</p>
          )}
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Entrando...' : 'Entrar'}
          </Button>
          <div className="text-center">
            <Link href="/reset-password" className="text-sm text-muted-foreground hover:underline">
              Esqueci minha senha
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { Loader2Icon } from 'lucide-react'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2Icon className="h-5 w-5 animate-spin text-sage" /></div>}>
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const email = searchParams.get('email')

  if (token && email) {
    return <SetNewPasswordForm token={token} email={email} />
  }

  return <RequestResetForm />
}

function RequestResetForm() {
  const [emailInput, setEmailInput] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsPending(true)
    setError(null)
    try {
      const res = await fetch('/api/profile/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao enviar')
      }
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="animate-fade-in-up">
      <MobileHeader />
      <div className="animate-fade-in-up-delay-1">
        <h2 className="text-2xl font-medium text-charcoal tracking-tight text-center lg:text-left">
          Recuperar senha
        </h2>
        <p className="text-mid text-sm mt-1 mb-8 text-center lg:text-left">
          Informe seu e-mail para receber um link de redefinição de senha
        </p>

        {success ? (
          <div className="animate-fade-in-up space-y-6">
            <div className="flex flex-col items-center py-6">
              <div className="w-16 h-16 rounded-full bg-sage/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-sage text-center font-medium">E-mail enviado!</p>
              <p className="text-sm text-mid text-center mt-1">
                Verifique sua caixa de entrada e clique no link para redefinir sua senha.
              </p>
            </div>
            <div className="text-center">
              <Link href="/login" className="text-sm text-mid/70 hover:text-sage transition-colors duration-200">
                Voltar ao login
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="uppercase tracking-wider text-xs text-mid">E-mail</Label>
              <Input
                id="email"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="h-11 border-blush/60 bg-white/80 rounded-lg focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
                placeholder="seu@email.com"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            <Button
              type="submit"
              className="w-full h-11 bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium rounded-lg transition-all duration-300"
              disabled={isPending}
            >
              {isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Enviar link'}
            </Button>
            <div className="text-center pt-2">
              <Link href="/login" className="text-sm text-mid/70 hover:text-sage transition-colors duration-200">
                Voltar ao login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function SetNewPasswordForm({ token, email }: { token: string; email: string }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem')
      return
    }
    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres')
      return
    }
    setIsPending(true)
    setError(null)
    try {
      const res = await fetch('/api/profile/reset-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email, newPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao redefinir senha')
      }
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao redefinir senha')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="animate-fade-in-up">
      <MobileHeader />
      <div className="animate-fade-in-up-delay-1">
        <h2 className="text-2xl font-medium text-charcoal tracking-tight text-center lg:text-left">
          Nova senha
        </h2>
        <p className="text-mid text-sm mt-1 mb-8 text-center lg:text-left">
          Defina sua nova senha para <strong>{email}</strong>
        </p>

        {success ? (
          <div className="animate-fade-in-up space-y-6">
            <div className="flex flex-col items-center py-6">
              <div className="w-16 h-16 rounded-full bg-sage/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-sage text-center font-medium">Senha redefinida!</p>
              <p className="text-sm text-mid text-center mt-1">
                Agora você pode acessar sua conta com a nova senha.
              </p>
            </div>
            <div className="text-center">
              <Link
                href="/login"
                className="inline-block w-full h-11 leading-[2.75rem] bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium rounded-lg transition-all duration-300 text-center"
              >
                Ir para o login
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="newPassword" className="uppercase tracking-wider text-xs text-mid">Nova senha</Label>
              <Input
                id="newPassword"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11 border-blush/60 bg-white/80 rounded-lg focus:border-sage focus:ring-2 focus:ring-mint/20"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="uppercase tracking-wider text-xs text-mid">Confirmar nova senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-11 border-blush/60 bg-white/80 rounded-lg focus:border-sage focus:ring-2 focus:ring-mint/20"
                placeholder="Repita a nova senha"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            <Button
              type="submit"
              className="w-full h-11 bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium rounded-lg transition-all duration-300"
              disabled={isPending}
            >
              {isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Redefinir senha'}
            </Button>
            <div className="text-center pt-2">
              <Link href="/login" className="text-sm text-mid/70 hover:text-sage transition-colors duration-200">
                Voltar ao login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function MobileHeader() {
  return (
    <div className="lg:hidden flex flex-col items-center mb-10">
      <img src="/brand/logo-sage.svg" alt="" className="size-12 mb-3" />
      <h1 className="font-display text-4xl font-semibold tracking-tight">
        <span className="text-forest">Flora</span>
        <span className="text-sage">Clin</span>
      </h1>
      <p className="mt-1.5 text-mid text-xs tracking-[0.2em] uppercase">
        Gestão · HOF & Estética
      </p>
    </div>
  )
}

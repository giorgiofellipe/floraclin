'use client'

import { useActionState } from 'react'
import { resetPassword, type ResetPasswordState } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const [state, formAction, isPending] = useActionState<ResetPasswordState, FormData>(resetPassword, null)

  return (
    <div className="animate-fade-in-up">
      {/* Mobile-only branded header */}
      <div className="lg:hidden text-center mb-10">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          <span className="text-forest">Flora</span>
          <span className="text-sage">Clin</span>
        </h1>
        <p className="mt-1.5 text-mid text-xs tracking-[0.2em] uppercase">
          Gestao &middot; HOF &amp; Estetica
        </p>
      </div>

      {/* Form section */}
      <div className="animate-fade-in-up-delay-1">
        <h2 className="text-2xl font-medium text-forest tracking-tight text-center lg:text-left">
          Redefinir Senha
        </h2>
        <p className="text-mid text-sm mt-1 mb-8 text-center lg:text-left">
          Informe seu e-mail para receber o link de recuperacao
        </p>

        {state?.success ? (
          <div className="animate-fade-in-up space-y-6">
            {/* Success state with sage checkmark */}
            <div className="flex flex-col items-center py-6">
              <div className="w-16 h-16 rounded-full bg-sage/10 flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-sage"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-sage text-center font-medium">
                E-mail de recuperacao enviado!
              </p>
              <p className="text-sm text-mid text-center mt-1">
                Verifique sua caixa de entrada.
              </p>
            </div>
            <div className="text-center">
              <Link
                href="/login"
                className="text-sm text-mid/70 hover:text-sage transition-colors duration-200"
              >
                Voltar ao login
              </Link>
            </div>
          </div>
        ) : (
          <form action={formAction} className="space-y-5">
            <div className="space-y-1.5 animate-fade-in-up-delay-2">
              <Label htmlFor="email" className="uppercase tracking-wider text-xs text-mid">
                E-mail
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
                placeholder="seu@email.com"
              />
            </div>
            {state?.error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700">{state.error}</p>
              </div>
            )}
            <div className="animate-fade-in-up-delay-3 pt-1">
              <Button
                type="submit"
                className="w-full h-11 bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium rounded-lg transition-all duration-300 shadow-sm hover:shadow-md"
                disabled={isPending}
              >
                {isPending ? 'Enviando...' : 'Enviar link de recuperacao'}
              </Button>
            </div>
            <div className="text-center pt-2">
              <Link
                href="/login"
                className="text-sm text-mid/70 hover:text-sage transition-colors duration-200"
              >
                Voltar ao login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SessionProvider, useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { loginWithGoogle } from '@/actions/auth'

function GoogleIcon() {
  return (
    <svg className="size-4 mr-2" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

const RESEND_COOLDOWN_SECONDS = 60

interface ConfirmActionsProps {
  email: string
  token: string | null
}

/**
 * `useSession()` needs a `<SessionProvider>` ancestor and this app doesn't
 * have one at the root, so it's scoped locally to this one page instead of
 * added globally.
 */
export function ConfirmActions(props: ConfirmActionsProps) {
  return (
    <SessionProvider>
      <ConfirmActionsInner {...props} />
    </SessionProvider>
  )
}

function ConfirmActionsInner({ email, token }: ConfirmActionsProps) {
  const router = useRouter()
  const { status, update } = useSession()
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [isResending, startResend] = useTransition()

  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [resendCooldown])

  async function handleConfirm() {
    if (!token) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const res = await fetch('/api/auth/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token }),
      })
      const data = await res.json()

      if (!res.ok) {
        setConfirmError(data.error ?? 'Link inválido ou expirado.')
        return
      }

      // The session's JWT still says emailVerified: false here. update()
      // re-runs the jwt callback with trigger: 'update' so this browser's
      // session picks up the fresh value before navigating -- without it,
      // /dashboard would bounce straight back to /confirm-email. There is
      // nothing to update() if this browser never had a session to begin
      // with (the link was opened on a different device than the signup).
      if (status === 'authenticated') {
        await update()
        router.push('/dashboard')
      } else {
        router.push('/login?verified=1')
      }
    } catch {
      setConfirmError('Não foi possível confirmar agora. Tente novamente.')
    } finally {
      setConfirming(false)
    }
  }

  function handleResend() {
    startResend(async () => {
      try {
        const res = await fetch('/api/auth/confirm/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })

        if (res.status === 429) {
          toast.error('Aguarde um pouco antes de solicitar outro link.')
          setResendCooldown(RESEND_COOLDOWN_SECONDS)
          return
        }
        if (!res.ok) {
          toast.error('Não foi possível reenviar o link agora.')
          return
        }

        toast.success('Link de confirmação reenviado.')
        setResendCooldown(RESEND_COOLDOWN_SECONDS)
      } catch {
        toast.error('Não foi possível reenviar o link agora.')
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-mid leading-relaxed">
          Enviamos um link de confirmação para <strong className="text-charcoal">{email}</strong>.
          Verifique sua caixa de entrada e a pasta de spam.
        </p>
      </div>

      {token && (
        <div>
          <Button type="button" className="w-full h-11" disabled={confirming} onClick={handleConfirm}>
            {confirming ? 'Confirmando...' : 'Confirmar e-mail'}
          </Button>
          {confirmError && <p className="mt-2 text-sm text-red-600">{confirmError}</p>}
        </div>
      )}

      <div className="grid gap-3">
        <Button
          type="button"
          variant="outline"
          className="w-full h-11"
          disabled={isResending || resendCooldown > 0}
          onClick={handleResend}
        >
          {resendCooldown > 0 ? `Reenviar link (${resendCooldown}s)` : 'Reenviar link de confirmação'}
        </Button>

        {/* Google sign-in marks the address verified on its own and is the
            reliable escape when the confirmation e-mail never arrives, so it
            gets the same prominence as the resend button, not a smaller
            secondary link. */}
        <form action={loginWithGoogle}>
          <Button type="submit" variant="outline" className="w-full h-11">
            <GoogleIcon /> Entrar com Google
          </Button>
        </form>
      </div>
    </div>
  )
}

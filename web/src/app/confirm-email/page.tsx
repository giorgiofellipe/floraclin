import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { ConfirmActions } from './confirm-actions'

interface ConfirmEmailPageProps {
  searchParams: Promise<{ email?: string; token?: string }>
}

export default async function ConfirmEmailPage({ searchParams }: ConfirmEmailPageProps) {
  const { email: emailParam, token } = await searchParams
  const session = await auth()

  if ((session as any)?.emailVerified) redirect('/dashboard')

  // The address to show comes from the confirmation link's query string
  // (clicked from any device) or, failing that, from the session created at
  // signup (this browser, right after signing up, with no link clicked yet).
  const email = emailParam ?? session?.user?.email ?? null
  if (!email) redirect('/login')

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-6">
      <div className="w-full max-w-md text-center">
        <img src="/brand/logo-mint.svg" alt="" className="size-16 mx-auto mb-6" />
        <h1 className="font-display text-3xl font-semibold text-charcoal">
          Flora<span className="text-sage">Clin</span>
        </h1>
        <p className="mt-2 text-lg font-medium text-charcoal">Confirme seu e-mail</p>
        <div className="mt-8 rounded-lg bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-left">
          <ConfirmActions email={email} token={token ?? null} />
        </div>
      </div>
    </div>
  )
}

import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Relatórios | FloraClin',
}

/**
 * Guards the whole /relatorios section once, here, so no individual report
 * page needs its own role check. `requireRole` throws rather than returning
 * a flag (see web/src/lib/auth.ts), so a refused role is caught and rendered
 * as a plain forbidden state instead of reaching the error boundary.
 */
export default async function RelatoriosLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    await requireRole('owner', 'financial')
  } catch {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-sage/15 bg-white px-6 py-16 text-center">
        <h1 className="font-heading text-lg font-medium text-charcoal">Acesso restrito</h1>
        <p className="max-w-md text-sm text-mid">
          Seu perfil não tem permissão para acessar os relatórios. Fale com o
          proprietário da clínica caso precise de acesso.
        </p>
      </div>
    )
  }

  return <>{children}</>
}

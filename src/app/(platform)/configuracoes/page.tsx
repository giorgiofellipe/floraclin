import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'
import { ConfiguracoesPageClientWrapper } from './configuracoes-page-client'

export const metadata: Metadata = {
  title: 'Configuracoes | FloraClin',
}

export default async function ConfiguracoesPage() {
  const auth = await requireRole('owner')

  return <ConfiguracoesPageClientWrapper currentUserId={auth.userId} />
}

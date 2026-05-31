import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getAuthContext } from '@/lib/auth'
import { ConfiguracoesPageClientWrapper } from './configuracoes-page-client'
import ConfiguracoesLoading from './loading'

export const metadata: Metadata = {
  title: 'Configuracoes | FloraClin',
}

interface ConfiguracoesPageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function ConfiguracoesPage({ searchParams }: ConfiguracoesPageProps) {
  const auth = await getAuthContext()
  const { tab } = await searchParams

  return (
    <Suspense fallback={<ConfiguracoesLoading />}>
      <ConfiguracoesPageClientWrapper
        currentUserId={auth.userId}
        userRole={auth.role}
        initialTab={tab}
      />
    </Suspense>
  )
}

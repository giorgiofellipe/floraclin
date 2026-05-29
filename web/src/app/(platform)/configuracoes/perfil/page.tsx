import type { Metadata } from 'next'
import { getAuthContext } from '@/lib/auth'
import { PerfilPageClient } from './perfil-page-client'

export const metadata: Metadata = {
  title: 'Meu Perfil | FloraClin',
}

export default async function PerfilPage() {
  // Ensures auth and redirects to /login when unauthenticated.
  const ctx = await getAuthContext()

  return <PerfilPageClient userRole={ctx.role} />
}

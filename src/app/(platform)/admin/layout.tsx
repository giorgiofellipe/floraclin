import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext()

  if (!auth.isPlatformAdmin) {
    redirect('/dashboard')
  }

  return <>{children}</>
}

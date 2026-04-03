import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AdminUserList } from '@/components/admin/admin-user-list'

export const metadata: Metadata = { title: 'Usuários | FloraClin Admin' }

export default function AdminUsuariosPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><span className="size-2 animate-pulse rounded-full bg-sage" /></div>}>
      <AdminUserList />
    </Suspense>
  )
}

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AdminTenantList } from '@/components/admin/admin-tenant-list'

export const metadata: Metadata = { title: 'Clínicas | FloraClin Admin' }

export default function AdminClinicasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><span className="size-2 animate-pulse rounded-full bg-sage" /></div>}>
      <AdminTenantList />
    </Suspense>
  )
}

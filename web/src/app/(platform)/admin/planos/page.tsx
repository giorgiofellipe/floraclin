import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PlanManager } from '@/components/admin/plan-manager'

export const metadata: Metadata = { title: 'Planos | FloraClin Admin' }

export default function AdminPlanosPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><span className="size-2 animate-pulse rounded-full bg-sage" /></div>}>
      <PlanManager />
    </Suspense>
  )
}

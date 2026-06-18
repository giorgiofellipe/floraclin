import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SubscriptionList } from '@/components/admin/subscription-list'

export const metadata: Metadata = { title: 'Assinaturas | FloraClin Admin' }

export default function AdminAssinaturasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><span className="size-2 animate-pulse rounded-full bg-sage" /></div>}>
      <SubscriptionList />
    </Suspense>
  )
}

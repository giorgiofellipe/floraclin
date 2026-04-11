import type { Metadata } from 'next'
import { FinanceiroPageClient } from './financeiro-page-client'

export const metadata: Metadata = {
  title: 'Financeiro | FloraClin',
}

export default function FinanceiroPage() {
  return <FinanceiroPageClient />
}

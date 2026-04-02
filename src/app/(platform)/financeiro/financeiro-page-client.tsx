'use client'

import { lazy, Suspense, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useFinancialPatients } from '@/hooks/queries/use-financial'
import { FinancialList } from '@/components/financial/financial-list'
import { cn } from '@/lib/utils'
import FinancialLoading from './loading'
import {
  ReceiptIcon,
  ArrowDownCircleIcon,
  BookOpenIcon,
  UsersIcon,
  BarChart3Icon,
} from 'lucide-react'

const ExpenseList = lazy(() =>
  import('@/components/financial/expenses/expense-list').then((m) => ({ default: m.ExpenseList }))
)
const LedgerView = lazy(() =>
  import('@/components/financial/ledger/ledger-view').then((m) => ({ default: m.LedgerView }))
)
const PractitionerPLView = lazy(() =>
  import('@/components/financial/practitioner-pl/practitioner-pl-view').then((m) => ({
    default: m.PractitionerPLView,
  }))
)
const RevenueChart = lazy(() =>
  import('@/components/financial/revenue-chart').then((m) => ({ default: m.RevenueChart }))
)

const TABS = [
  { value: 'receivables', label: 'A Receber', icon: ReceiptIcon },
  { value: 'expenses', label: 'Despesas', icon: ArrowDownCircleIcon },
  { value: 'ledger', label: 'Extrato', icon: BookOpenIcon },
  { value: 'practitioner-pl', label: 'Por Profissional', icon: UsersIcon },
  { value: 'overview', label: 'Visão Geral', icon: BarChart3Icon },
] as const

type TabValue = (typeof TABS)[number]['value']

function isValidTab(value: string | null): value is TabValue {
  return TABS.some((t) => t.value === value)
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-16">
      <span className="size-2 animate-pulse rounded-full bg-sage" />
      <span className="text-sm text-mid">Carregando...</span>
    </div>
  )
}

export function FinanceiroPageClient() {
  const { data: patients, isLoading } = useFinancialPatients()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const tabParam = searchParams.get('tab')
  const activeTab: TabValue = isValidTab(tabParam) ? tabParam : 'receivables'

  const handleTabChange = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (tab === 'receivables') {
        params.delete('tab')
      } else {
        params.set('tab', tab)
      }
      // Clear tab-specific params when switching
      params.delete('page')
      params.delete('status')
      params.delete('patientId')
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [searchParams, router, pathname]
  )

  if (isLoading) {
    return <FinancialLoading />
  }

  return (
    <div className="space-y-4">
      {/* Tab navigation */}
      <div className="flex items-center gap-1 rounded-lg bg-white p-1 shadow-sm border border-[#E8ECEF]" data-testid="financial-tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.value
          return (
            <button
              key={tab.value}
              type="button"
              data-testid={`financial-tab-${tab.value}`}
              onClick={() => handleTabChange(tab.value)}
              className={cn(
                'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-forest text-cream shadow-sm'
                  : 'text-mid hover:text-charcoal hover:bg-[#F4F6F8]'
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'receivables' && (
          <FinancialList patients={patients ?? []} />
        )}

        {activeTab === 'expenses' && (
          <Suspense fallback={<TabFallback />}>
            <ExpenseList />
          </Suspense>
        )}

        {activeTab === 'ledger' && (
          <Suspense fallback={<TabFallback />}>
            <LedgerView />
          </Suspense>
        )}

        {activeTab === 'practitioner-pl' && (
          <Suspense fallback={<TabFallback />}>
            <PractitionerPLView />
          </Suspense>
        )}

        {activeTab === 'overview' && (
          <Suspense fallback={<TabFallback />}>
            <RevenueChart />
          </Suspense>
        )}
      </div>
    </div>
  )
}

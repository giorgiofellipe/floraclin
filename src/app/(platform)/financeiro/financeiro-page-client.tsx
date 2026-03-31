'use client'

import { lazy, Suspense, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useFinancialPatients } from '@/hooks/queries/use-financial'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FinancialList } from '@/components/financial/financial-list'
import FinanceiroLoading from './loading'

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

const TAB_VALUES = ['receivables', 'expenses', 'ledger', 'practitioner-pl', 'overview'] as const
type TabValue = (typeof TAB_VALUES)[number]

function isValidTab(value: string | null): value is TabValue {
  return TAB_VALUES.includes(value as TabValue)
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
    (value: string | number | null) => {
      if (!value) return
      const tab = String(value)
      const params = new URLSearchParams(searchParams.toString())
      if (tab === 'receivables') {
        params.delete('tab')
      } else {
        params.set('tab', tab)
      }
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [searchParams, router, pathname]
  )

  if (isLoading) {
    return <FinanceiroLoading />
  }

  const tabTriggerClass =
    'rounded-none border-b-2 border-transparent data-[state=active]:border-sage data-[state=active]:bg-transparent data-[state=active]:text-forest data-[state=active]:shadow-none text-mid px-5 py-2.5 font-medium transition-colors hover:text-forest'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#2A2A2A] tracking-tight">Financeiro</h1>
        <p className="text-sm text-mid mt-0.5">
          Gerencie cobrancas, despesas e visualize o desempenho financeiro.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="bg-transparent border-b border-sage/10 rounded-none p-0 h-auto gap-0">
          <TabsTrigger value="receivables" className={tabTriggerClass}>
            A Receber
          </TabsTrigger>
          <TabsTrigger value="expenses" className={tabTriggerClass}>
            Despesas
          </TabsTrigger>
          <TabsTrigger value="ledger" className={tabTriggerClass}>
            Extrato
          </TabsTrigger>
          <TabsTrigger value="practitioner-pl" className={tabTriggerClass}>
            Por Profissional
          </TabsTrigger>
          <TabsTrigger value="overview" className={tabTriggerClass}>
            Visao Geral
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receivables" className="mt-6">
          <FinancialList patients={patients ?? []} />
        </TabsContent>

        <TabsContent value="expenses" className="mt-6">
          <Suspense fallback={<TabFallback />}>
            <ExpenseList />
          </Suspense>
        </TabsContent>

        <TabsContent value="ledger" className="mt-6">
          <Suspense fallback={<TabFallback />}>
            <LedgerView />
          </Suspense>
        </TabsContent>

        <TabsContent value="practitioner-pl" className="mt-6">
          <Suspense fallback={<TabFallback />}>
            <PractitionerPLView />
          </Suspense>
        </TabsContent>

        <TabsContent value="overview" className="mt-6">
          <Suspense fallback={<TabFallback />}>
            <RevenueChart />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}

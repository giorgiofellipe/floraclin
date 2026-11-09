'use client'

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useFinancialPatients } from '@/hooks/queries/use-financial'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'
import { canManageAccounts } from '@/lib/financial/account-roles'
import { FinancialList } from '@/components/financial/financial-list'
import { cn } from '@/lib/utils'
import FinancialLoading from './loading'
import {
  ReceiptIcon,
  ArrowDownCircleIcon,
  BookOpenIcon,
  UsersIcon,
  BarChart3Icon,
  CreditCardIcon,
  ReceiptTextIcon,
  LandmarkIcon,
} from 'lucide-react'

const ExpenseList = lazy(() =>
  import('@/components/financial/expenses/expense-list').then((m) => ({ default: m.ExpenseList }))
)
const LedgerView = lazy(() =>
  import('@/components/financial/ledger/ledger-view').then((m) => ({ default: m.LedgerView }))
)
const CardRepassesView = lazy(() =>
  import('@/components/financial/card-repasses/card-repasses-view').then((m) => ({
    default: m.CardRepassesView,
  }))
)
const PractitionerPLView = lazy(() =>
  import('@/components/financial/practitioner-pl/practitioner-pl-view').then((m) => ({
    default: m.PractitionerPLView,
  }))
)
const NfseDocumentsList = lazy(() =>
  import('@/components/nfse/nfse-documents-list').then((m) => ({ default: m.NfseDocumentsList }))
)
const ReconciliationView = lazy(() =>
  import('@/components/financial/reconciliation/reconciliation-view').then((m) => ({
    default: m.ReconciliationView,
  }))
)
const RevenueChart = lazy(() =>
  import('@/components/financial/revenue-chart').then((m) => ({ default: m.RevenueChart }))
)

const TABS = [
  { value: 'receivables', label: 'A Receber', icon: ReceiptIcon },
  { value: 'expenses', label: 'Despesas', icon: ArrowDownCircleIcon },
  { value: 'ledger', label: 'Extrato', icon: BookOpenIcon },
  { value: 'card-repasses', label: 'Repasses', icon: CreditCardIcon },
  { value: 'reconciliation', label: 'Conciliação', icon: LandmarkIcon },
  { value: 'practitioner-pl', label: 'Por Profissional', icon: UsersIcon },
  { value: 'overview', label: 'Visão Geral', icon: BarChart3Icon },
  { value: 'notas-fiscais', label: 'Notas fiscais', icon: ReceiptTextIcon },
] as const

type TabValue = (typeof TABS)[number]['value']

const NFSE_ROLES = ['owner', 'receptionist', 'financial']

// Bank statements are for the owner and the Financeiro role only (decision on #88).
// The server enforces it; this only keeps the tab away from everyone else.
function visibleTabs(role: string) {
  return TABS.filter((tab) => {
    if (tab.value === 'notas-fiscais') return NFSE_ROLES.includes(role)
    if (tab.value === 'reconciliation') return canManageAccounts(role)
    return true
  })
}

// The labeled tabs are wider than a phone (and than a tablet next to the
// sidebar), so the row scrolls on its own instead of widening the page. A fade
// on the cut-off edge shows there is more to scroll.
function edgeMask(start: boolean, end: boolean) {
  if (start && end) return 'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)'
  if (end) return 'linear-gradient(to right, #000 calc(100% - 24px), transparent)'
  if (start) return 'linear-gradient(to right, transparent, #000 24px)'
  return undefined
}

function FinancialTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: ReturnType<typeof visibleTabs>
  activeTab: TabValue
  onChange: (tab: TabValue) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<TabValue, HTMLButtonElement>())
  const [hidden, setHidden] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const max = list.scrollWidth - list.clientWidth
    setHidden({ start: list.scrollLeft > 1, end: list.scrollLeft < max - 1 })
  }, [])

  // Keep the active tab in view, also when a link lands on one off-screen.
  // Only the row scrolls, never the page.
  useLayoutEffect(() => {
    const list = listRef.current
    const tab = tabRefs.current.get(activeTab)
    if (!list || !tab) return
    list.scrollLeft = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2
    measure()
  }, [activeTab, measure])

  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [measure])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((t) => t.value === activeTab)
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1
    if (next < 0) return
    event.preventDefault()
    const value = tabs[next].value
    onChange(value)
    tabRefs.current.get(value)?.focus()
  }

  const mask = edgeMask(hidden.start, hidden.end)

  return (
    <div className="min-w-0 rounded-lg border border-[#E8ECEF] bg-white shadow-sm">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Seções do financeiro"
        onScroll={measure}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="scrollbar-hide relative flex max-w-full gap-1 overflow-x-auto p-1"
        data-testid="financial-tabs"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.value
          return (
            <button
              key={tab.value}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.value, el)
                else tabRefs.current.delete(tab.value)
              }}
              type="button"
              role="tab"
              id={`financial-tab-${tab.value}`}
              aria-selected={isActive}
              aria-controls="financial-tab-panel"
              tabIndex={isActive ? 0 : -1}
              data-testid={`financial-tab-${tab.value}`}
              onClick={() => onChange(tab.value)}
              onKeyDown={handleKeyDown}
              className={cn(
                'flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-all duration-200 md:h-auto md:gap-2 md:py-2',
                'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage',
                isActive
                  ? 'bg-forest text-cream shadow-sm'
                  : 'text-mid hover:text-charcoal hover:bg-[#F4F6F8]'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
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
  const { role } = useSubscriptionAccess()
  const tabs = visibleTabs(role)

  const tabParam = searchParams.get('tab')
  const activeTab: TabValue = tabs.find((t) => t.value === tabParam)?.value ?? 'receivables'

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
    <div className="min-w-0 space-y-4">
      <FinancialTabs tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />

      {/* Tab content */}
      <div role="tabpanel" id="financial-tab-panel" aria-labelledby={`financial-tab-${activeTab}`}>
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

        {activeTab === 'card-repasses' && (
          <Suspense fallback={<TabFallback />}>
            <CardRepassesView />
          </Suspense>
        )}

        {activeTab === 'reconciliation' && (
          <Suspense fallback={<TabFallback />}>
            <ReconciliationView />
          </Suspense>
        )}

        {activeTab === 'practitioner-pl' && (
          <Suspense fallback={<TabFallback />}>
            <PractitionerPLView />
          </Suspense>
        )}

        {activeTab === 'notas-fiscais' && (
          <Suspense fallback={<TabFallback />}>
            <NfseDocumentsList />
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

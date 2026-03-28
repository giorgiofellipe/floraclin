'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'dados', label: 'Dados' },
  { key: 'anamnese', label: 'Anamnese' },
  { key: 'procedimentos', label: 'Procedimentos' },
  { key: 'fotos', label: 'Fotos' },
  { key: 'termos', label: 'Termos' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'timeline', label: 'Timeline' },
] as const

export type PatientTabKey = (typeof TABS)[number]['key']

interface PatientTabsProps {
  activeTab: PatientTabKey
}

export function PatientTabs({ activeTab }: PatientTabsProps) {
  const router = useRouter()
  const pathname = usePathname()

  function handleTabChange(tab: PatientTabKey) {
    const params = new URLSearchParams()
    params.set('tab', tab)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-1 overflow-x-auto px-1" aria-label="Abas do paciente">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            data-testid={`patient-tab-${tab.key}`}
            className={cn(
              'whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors rounded-t-lg',
              activeTab === tab.key
                ? 'border-b-2 border-sage text-forest bg-white'
                : 'text-mid hover:text-charcoal hover:bg-petal/50'
            )}
            aria-current={activeTab === tab.key ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

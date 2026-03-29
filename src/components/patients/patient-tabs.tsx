'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'dados', label: 'Dados' },
  { key: 'anamnese', label: 'Anamnese' },
  { key: 'procedimentos', label: 'Procedimentos' },
  { key: 'fotos', label: 'Fotos' },
  { key: 'termos', label: 'Contratos e Termos' },
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
    <div className="border-b border-blush/40">
      <nav className="-mb-px flex gap-0 overflow-x-auto" aria-label="Abas do paciente">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            data-testid={`patient-tab-${tab.key}`}
            className={cn(
              'relative whitespace-nowrap px-5 py-3 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'text-forest'
                : 'text-mid hover:text-charcoal'
            )}
            aria-current={activeTab === tab.key ? 'page' : undefined}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-forest rounded-full" />
            )}
          </button>
        ))}
      </nav>
    </div>
  )
}

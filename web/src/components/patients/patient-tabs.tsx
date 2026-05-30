'use client'

import { cn } from '@/lib/utils'
import {
  User,
  ClipboardList,
  Syringe,
  Camera,
  FileCheck,
  Banknote,
  Clock,
  Package,
  FileText,
  BookOpen,
} from 'lucide-react'
import type { Role } from '@/types'

interface TabConfig {
  key: string
  label: string
  icon: typeof User
  requiredRoles?: Role[]
}

const TABS: readonly TabConfig[] = [
  { key: 'dados', label: 'Dados', icon: User },
  { key: 'anamnese', label: 'Anamnese', icon: ClipboardList },
  { key: 'evolucoes', label: 'Evoluções', icon: BookOpen, requiredRoles: ['owner', 'practitioner'] },
  { key: 'procedimentos', label: 'Atendimentos', icon: Syringe },
  { key: 'pacotes', label: 'Pacotes', icon: Package },
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'fotos', label: 'Fotos', icon: Camera },
  { key: 'termos', label: 'Termos', icon: FileCheck },
  { key: 'financeiro', label: 'Financeiro', icon: Banknote },
  { key: 'timeline', label: 'Timeline', icon: Clock },
] as const

export type PatientTabKey = (typeof TABS)[number]['key']

interface PatientTabsProps {
  activeTab: PatientTabKey
  onTabChange: (tab: PatientTabKey) => void
  /** Caller-supplied role used to filter visible tabs. */
  role?: Role
}

export function PatientTabs({ activeTab, onTabChange, role }: PatientTabsProps) {
  const visibleTabs = TABS.filter(
    (t) => !t.requiredRoles || (role !== undefined && t.requiredRoles.includes(role)),
  )

  return (
    <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <nav className="flex overflow-x-auto" aria-label="Abas do paciente">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              data-testid={`patient-tab-${tab.key}`}
              className={cn(
                'group relative flex cursor-pointer items-center gap-2 whitespace-nowrap px-5 py-3.5 text-[13px] font-medium transition-all duration-200',
                isActive
                  ? 'text-forest'
                  : 'text-mid hover:text-charcoal'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className={cn(
                'size-3.5 transition-colors duration-200',
                isActive ? 'text-sage' : 'text-mid/50 group-hover:text-mid'
              )} />
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-2 bottom-0 h-[2px] bg-forest rounded-full" />
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { ClinicSettingsForm } from '@/components/settings/clinic-settings-form'
import { ProcedureTypeList } from '@/components/settings/procedure-type-list'
import { TeamList } from '@/components/settings/team-list'
import { ConsentTemplateList } from '@/components/settings/consent-template-list'
import { BookingSettings } from '@/components/settings/booking-settings'
import { AuditLogViewer } from '@/components/audit/audit-log-viewer'
import { cn } from '@/lib/utils'
import {
  BuildingIcon,
  SyringeIcon,
  UsersIcon,
  FileTextIcon,
  CalendarIcon,
  ShieldCheckIcon,
} from 'lucide-react'

interface Tenant {
  id: string
  name: string
  slug: string
  phone: string | null
  email: string | null
  address: unknown
  workingHours: unknown
  settings: unknown
}

interface ProcedureType {
  id: string
  name: string
  category: string
  description: string | null
  defaultPrice: string | null
  estimatedDurationMin: number | null
  isActive: boolean
}

interface TeamMember {
  id: string
  tenantId: string
  userId: string
  role: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  user: {
    id: string
    email: string
    fullName: string
    phone: string | null
    avatarUrl: string | null
  }
}

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

interface SettingsPageClientProps {
  tenant: Tenant
  procedureTypes: ProcedureType[]
  members: TeamMember[]
  consentTemplates: ConsentTemplate[]
  currentUserId: string
}

const TABS = [
  { key: 'clinica', label: 'Clinica', icon: BuildingIcon },
  { key: 'procedimentos', label: 'Procedimentos', icon: SyringeIcon },
  { key: 'equipe', label: 'Equipe', icon: UsersIcon },
  { key: 'termos', label: 'Termos', icon: FileTextIcon },
  { key: 'agendamento', label: 'Agendamento', icon: CalendarIcon },
  { key: 'auditoria', label: 'Auditoria', icon: ShieldCheckIcon },
] as const

type TabKey = (typeof TABS)[number]['key']

export function SettingsPageClient({
  tenant,
  procedureTypes,
  members,
  consentTemplates,
  currentUserId,
}: SettingsPageClientProps) {
  const settings = (tenant.settings || {}) as Record<string, unknown>
  const publicBookingEnabled = (settings.online_booking_enabled as boolean) ?? false
  const [activeTab, setActiveTab] = useState<TabKey>('clinica')

  const activeTabConfig = TABS.find((t) => t.key === activeTab)!

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#2A2A2A]">Configuracoes</h1>
        <p className="text-sm text-mid mt-0.5">
          Gerencie as configuracoes da sua clinica.
        </p>
      </div>

      {/* Mobile: horizontal scrollable tabs */}
      <div className="md:hidden mb-6 -mx-4 px-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1 min-w-max bg-gray-100 rounded-[3px] p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-[3px] text-sm font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-white text-[#2A2A2A] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
                    : 'text-mid hover:text-charcoal'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Desktop: sidebar + content layout */}
      <div className="flex gap-6">
        {/* Sidebar nav (desktop only) */}
        <nav className="hidden md:block w-56 shrink-0">
          <div className="sticky top-6 space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-2.5 rounded-[3px] text-sm font-medium transition-colors text-left',
                    isActive
                      ? 'bg-white text-[#2A2A2A] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
                      : 'text-mid hover:bg-gray-50 hover:text-charcoal'
                  )}
                >
                  <Icon className={cn('h-4 w-4', isActive ? 'text-sage' : 'text-mid')} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            {/* Section header */}
            <div className="px-5 sm:px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-[3px] bg-sage/10">
                  <activeTabConfig.icon className="h-4 w-4 text-sage" />
                </div>
                <h2 className="text-lg font-medium text-[#2A2A2A]">{activeTabConfig.label}</h2>
              </div>
            </div>

            {/* Section content */}
            <div className="p-5 sm:p-6">
              {activeTab === 'clinica' && (
                <ClinicSettingsForm
                  initialData={{
                    name: tenant.name,
                    phone: tenant.phone,
                    email: tenant.email,
                    address: tenant.address as Record<string, string> | null,
                    workingHours: tenant.workingHours as import('@/validations/tenant').WorkingHours | null,
                  }}
                />
              )}

              {activeTab === 'procedimentos' && (
                <ProcedureTypeList procedureTypes={procedureTypes} />
              )}

              {activeTab === 'equipe' && (
                <TeamList members={members} currentUserId={currentUserId} />
              )}

              {activeTab === 'termos' && (
                <ConsentTemplateList templates={consentTemplates} />
              )}

              {activeTab === 'agendamento' && (
                <BookingSettings
                  slug={tenant.slug}
                  publicBookingEnabled={publicBookingEnabled}
                />
              )}

              {activeTab === 'auditoria' && (
                <AuditLogViewer />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

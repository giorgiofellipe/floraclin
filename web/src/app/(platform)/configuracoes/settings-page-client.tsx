'use client'

import type { Role } from '@/types'
import { useCallback, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ClinicSettingsForm } from '@/components/settings/clinic-settings-form'
import { ProcedureTypeList } from '@/components/settings/procedure-type-list'
import { ProductList } from '@/components/settings/product-list'
import { TeamList } from '@/components/settings/team-list'
import { ConsentTemplateList } from '@/components/settings/consent-template-list'
import { BookingSettings } from '@/components/settings/booking-settings'
import { CalendarConnectionCard } from '@/components/settings/calendar-connection-card'
import { AuditLogViewer } from '@/components/audit/audit-log-viewer'
import { FinancialSettingsForm } from '@/components/financial/settings/financial-settings-form'
import { ExpenseCategoriesManager } from '@/components/financial/settings/expense-categories-manager'
import { WhatsAppSettingsForm } from '@/components/settings/whatsapp-settings-form'
import { PackageTemplateList } from '@/components/packages/package-template-list'
import { usePackageTemplates } from '@/hooks/queries/use-packages'
import { DocumentTemplateList } from '@/components/settings/document-template-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProfile } from '@/hooks/queries/use-profile'
import { AccountInfoForm } from '@/components/settings/account-info-form'
import { PasswordForm } from '@/components/settings/password-form'
import { ProfessionalSignatureForm } from '@/components/settings/professional-signature-form'
import { useCalendarConnections } from '@/hooks/queries/use-calendar'
import { cn } from '@/lib/utils'
import {
  BuildingIcon,
  SyringeIcon,
  PackageIcon,
  UsersIcon,
  FileTextIcon,
  CalendarIcon,
  ShieldCheckIcon,
  DollarSignIcon,
  MessageCircleIcon,
  Package2Icon,
  ClipboardSignatureIcon,
  UserCogIcon,
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
  logoUrl: string | null
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

interface Product {
  id: string
  name: string
  category: string
  activeIngredient: string | null
  defaultUnit: string
  isActive: boolean
  showInDiagram: boolean
}

interface SettingsPageClientProps {
  tenant: Tenant
  procedureTypes: ProcedureType[]
  products: Product[]
  members: TeamMember[]
  consentTemplates: ConsentTemplate[]
  currentUserId: string
  userRole: Role
  initialTab?: string
  templateStatusMap?: Record<string, boolean>
}

type TabKey =
  | 'clinica' | 'equipe' | 'perfil'
  | 'procedimentos' | 'produtos' | 'pacotes' | 'termos' | 'documentos'
  | 'agendamento' | 'financeiro' | 'whatsapp'
  | 'auditoria'

interface TabItem {
  key: TabKey
  label: string
  icon: typeof BuildingIcon
}

interface SidebarGroup {
  label: string
  items: TabItem[]
}

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    label: 'Geral',
    items: [
      { key: 'clinica', label: 'Clínica', icon: BuildingIcon },
      { key: 'equipe', label: 'Equipe', icon: UsersIcon },
      { key: 'perfil', label: 'Perfil', icon: UserCogIcon },
    ],
  },
  {
    label: 'Clínico',
    items: [
      { key: 'procedimentos', label: 'Procedimentos', icon: SyringeIcon },
      { key: 'produtos', label: 'Produtos', icon: PackageIcon },
      { key: 'pacotes', label: 'Pacotes', icon: Package2Icon },
      { key: 'termos', label: 'Contratos e Termos', icon: FileTextIcon },
      { key: 'documentos', label: 'Documentos', icon: ClipboardSignatureIcon },
    ],
  },
  {
    label: 'Operações',
    items: [
      { key: 'agendamento', label: 'Agendamento', icon: CalendarIcon },
      { key: 'financeiro', label: 'Financeiro', icon: DollarSignIcon },
      { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircleIcon },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { key: 'auditoria', label: 'Auditoria', icon: ShieldCheckIcon },
    ],
  },
]

const ALL_TABS: TabItem[] = SIDEBAR_GROUPS.flatMap((g) => g.items)

const VALID_TAB_KEYS = new Set<string>(ALL_TABS.map((t) => t.key))

const TAB_ROLES: Partial<Record<TabKey, Role[]>> = {
  perfil: [],
  documentos: ['owner', 'practitioner'],
}

const DEFAULT_OWNER_TAB: TabKey = 'clinica'
const DEFAULT_NON_OWNER_TAB: TabKey = 'perfil'

function PacotesTabContent() {
  const { data, isLoading } = usePackageTemplates()
  return <PackageTemplateList templates={data ?? []} isLoading={isLoading} />
}

function PerfilTabContent({ userRole }: { userRole: Role }) {
  const { data: profileData, isLoading, error } = useProfile()
  const { data: connections } = useCalendarConnections()
  const profile = profileData?.data ?? null
  const showCalendar = userRole === 'owner' || userRole === 'practitioner'
  const myConnection = connections?.find((c: { userId: string | null }) => c.userId === profile?.id) ?? null

  if (isLoading) return <div className="py-12 text-center text-sm text-mid">Carregando perfil...</div>
  if (error) return <div className="py-12 text-center text-sm text-mid">Erro ao carregar perfil.</div>
  if (!profile) return null

  return (
    <div className="space-y-5">
      <AccountInfoForm initial={profile} />
      <div className="h-px bg-[#E8ECEF]" />
      <PasswordForm />
      <div className="h-px bg-[#E8ECEF]" />
      <ProfessionalSignatureForm initialProfile={profile} />
      {showCalendar && (
        <>
          <div className="h-px bg-[#E8ECEF]" />
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-charcoal">Google Calendar</h3>
              <p className="text-xs text-mid mt-1">Sincronize seus agendamentos com o Google Calendar.</p>
            </div>
            <CalendarConnectionCard
              type="practitioner"
              connection={myConnection}
              helperText="Sincronize seus agendamentos com o Google Calendar."
            />
          </div>
        </>
      )}
    </div>
  )
}

export function SettingsPageClient({
  tenant,
  procedureTypes,
  products,
  members,
  consentTemplates,
  currentUserId,
  userRole,
  initialTab,
  templateStatusMap,
}: SettingsPageClientProps) {
  const settings = (tenant.settings || {}) as Record<string, unknown>
  const publicBookingEnabled = (settings.online_booking_enabled as boolean) ?? false
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const visibleTabs = ALL_TABS.filter((tab) => {
    const allowed = TAB_ROLES[tab.key as TabKey]
    if (allowed === undefined) return userRole === 'owner'
    if (allowed.length === 0) return true
    return allowed.includes(userRole)
  })

  const visibleKeys = new Set(visibleTabs.map((t) => t.key))
  const defaultTab = userRole === 'owner' ? DEFAULT_OWNER_TAB : DEFAULT_NON_OWNER_TAB

  const [activeTab, setActiveTabState] = useState<TabKey>(() => {
    const candidate = initialTab as TabKey
    if (candidate && VALID_TAB_KEYS.has(candidate) && visibleKeys.has(candidate)) {
      return candidate
    }
    return defaultTab
  })

  const setActiveTab = useCallback((newTab: TabKey) => {
    setActiveTabState(newTab)
    const params = new URLSearchParams(searchParams.toString())
    if (newTab === defaultTab) {
      params.delete('tab')
    } else {
      params.set('tab', newTab)
    }
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [router, pathname, searchParams, defaultTab])

  const { data: calendarConnections } = useCalendarConnections()
  const clinicConnection = calendarConnections?.find((c: { userId: string | null }) => c.userId === null) ?? null

  const activeTabConfig = visibleTabs.find((t) => t.key === activeTab) ?? visibleTabs[0]

  const visibleGroups = SIDEBAR_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => visibleKeys.has(item.key)),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#2A2A2A]">Configurações</h1>
        <p className="text-sm text-mid mt-0.5">
          Gerencie as configurações da sua clínica.
        </p>
      </div>

      {/* Mobile: horizontal scrollable tabs (flat, no group labels) */}
      <div className="md:hidden mb-6 -mx-4 px-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1 min-w-max bg-[#E8ECEF] rounded-[3px] p-1">
          {visibleTabs.map((tab) => {
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
          <div className="sticky top-6 space-y-0.5">
            {visibleGroups.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? 'pt-4' : ''}>
                <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-mid/60">
                  {group.label}
                </div>
                {group.items.map((tab) => {
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
                          : 'text-mid hover:bg-[#F4F6F8] hover:text-charcoal'
                      )}
                    >
                      <Icon className={cn('h-4 w-4', isActive ? 'text-sage' : 'text-mid')} />
                      {tab.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            {/* Section header */}
            <div className="px-5 sm:px-6 py-4 border-b border-[#E8ECEF]">
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
                    settings: tenant.settings as Record<string, unknown> | null,
                    logoUrl: (tenant.logoUrl as string | null) ?? null,
                  }}
                />
              )}

              {activeTab === 'procedimentos' && (
                <ProcedureTypeList procedureTypes={procedureTypes} templateStatusMap={templateStatusMap} />
              )}

              {activeTab === 'produtos' && (
                <ProductList products={products} />
              )}

              {activeTab === 'equipe' && (
                <TeamList members={members} currentUserId={currentUserId} />
              )}

              {activeTab === 'termos' && (
                <ConsentTemplateList templates={consentTemplates} />
              )}

              {activeTab === 'pacotes' && <PacotesTabContent />}

              {activeTab === 'documentos' && (
                <Tabs defaultValue="receita" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="receita">Receitas</TabsTrigger>
                    <TabsTrigger value="atestado">Atestados</TabsTrigger>
                  </TabsList>
                  <TabsContent value="receita" className="space-y-4">
                    <DocumentTemplateList kind="receita" />
                  </TabsContent>
                  <TabsContent value="atestado" className="space-y-4">
                    <DocumentTemplateList kind="atestado" />
                  </TabsContent>
                </Tabs>
              )}

              {activeTab === 'agendamento' && (
                <div className="space-y-8">
                  <BookingSettings
                    slug={tenant.slug}
                    publicBookingEnabled={publicBookingEnabled}
                  />
                  <div className="h-px bg-[#E8ECEF]" />
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium text-charcoal">Calendário da clínica</h3>
                      <p className="text-xs text-mid mt-1">
                        Todos os agendamentos de todos os profissionais serão sincronizados para este calendário.
                      </p>
                    </div>
                    <CalendarConnectionCard
                      type="clinic"
                      connection={clinicConnection}
                      helperText="Conecte o Google Calendar da clínica para sincronizar todos os agendamentos."
                    />
                  </div>
                </div>
              )}

              {activeTab === 'financeiro' && (
                <div className="space-y-8">
                  <FinancialSettingsForm />
                  <ExpenseCategoriesManager />
                </div>
              )}

              {activeTab === 'whatsapp' && (
                <WhatsAppSettingsForm
                  initialSettings={settings as Record<string, unknown>}
                />
              )}

              {activeTab === 'auditoria' && (
                <AuditLogViewer />
              )}

              {activeTab === 'perfil' && <PerfilTabContent userRole={userRole} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

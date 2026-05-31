# Settings Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `/configuracoes` with grouped sidebar, URL-based tab state, human-readable WhatsApp template labels, and inlined sub-route pages.

**Architecture:** Replace flat tab list with grouped `SIDEBAR_GROUPS` array. Add `useSearchParams`/`router.replace` for URL persistence (same pattern as patient detail page). Inline Pacotes/Documentos/Perfil content into the main settings component. Relax auth gate from `requireRole('owner')` to `getAuthContext()` with per-tab role filtering.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, Lucide icons, shadcn/ui

---

## File Ownership Map

| File | Task |
|------|------|
| `web/src/components/settings/whatsapp-template-list.tsx` | Task 1 |
| `web/src/app/(platform)/configuracoes/page.tsx` | Task 2 |
| `web/src/app/(platform)/configuracoes/configuracoes-page-client.tsx` | Task 3 |
| `web/src/app/(platform)/configuracoes/settings-page-client.tsx` | Task 4 |
| `web/src/app/(platform)/configuracoes/pacotes/` (delete) | Task 5 |
| `web/src/app/(platform)/configuracoes/documentos/` (delete) | Task 5 |
| `web/src/app/(platform)/configuracoes/perfil/` (delete) | Task 5 |

---

## Group A (parallel)

### Task 1: WhatsApp Template Label Swap

**Files:**
- Modify: `web/src/components/settings/whatsapp-template-list.tsx:380-422`

- [ ] **Step 1: Swap title and subtitle in template card**

In `whatsapp-template-list.tsx`, find the template card rendering (around line 380). Change the `<h4>` to show the purpose label as the primary title, and move the raw name to the subtitle line.

Replace:
```tsx
<h4 className="text-sm font-medium text-charcoal truncate">
  {t.name}
</h4>
```

With:
```tsx
<h4 className="text-sm font-medium text-charcoal truncate">
  {(t.purposeKey && PURPOSE_LABELS[t.purposeKey]) || t.name}
</h4>
```

Then update the subtitle section. Replace:
```tsx
<div className="flex items-center gap-3 text-xs text-mid">
  {t.purposeKey && PURPOSE_LABELS[t.purposeKey] && (
    <span>{PURPOSE_LABELS[t.purposeKey]}</span>
  )}
  <span>
    Sincronizado em{' '}
    {formatDateTime(t.syncedAt)}
  </span>
</div>
```

With:
```tsx
<div className="flex items-center gap-3 text-xs text-mid">
  {t.purposeKey && PURPOSE_LABELS[t.purposeKey] && (
    <span className="text-mid/60">{t.name}</span>
  )}
  <span>
    Sincronizado em{' '}
    {formatDateTime(t.syncedAt)}
  </span>
</div>
```

- [ ] **Step 2: Verify the template list renders correctly**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/settings/whatsapp-template-list.tsx
git commit -m "fix(settings): show human-readable labels for WhatsApp templates"
```

---

### Task 2: Relax Auth Gate in Server Component

**Files:**
- Modify: `web/src/app/(platform)/configuracoes/page.tsx`

- [ ] **Step 1: Change requireRole to getAuthContext and read searchParams**

Replace the entire `page.tsx` content with:

```tsx
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getAuthContext } from '@/lib/auth'
import { ConfiguracoesPageClientWrapper } from './configuracoes-page-client'
import ConfiguracoesLoading from './loading'

export const metadata: Metadata = {
  title: 'Configuracoes | FloraClin',
}

interface ConfiguracoesPageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function ConfiguracoesPage({ searchParams }: ConfiguracoesPageProps) {
  const auth = await getAuthContext()
  const { tab } = await searchParams

  return (
    <Suspense fallback={<ConfiguracoesLoading />}>
      <ConfiguracoesPageClientWrapper
        currentUserId={auth.userId}
        userRole={auth.role}
        initialTab={tab}
      />
    </Suspense>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: FAIL (configuracoes-page-client doesn't accept new props yet — that's Task 3)

- [ ] **Step 3: Commit**

```bash
git add web/src/app/(platform)/configuracoes/page.tsx
git commit -m "refactor(settings): relax auth to getAuthContext and pass tab+role"
```

---

## Group B (depends on A)

### Task 3: Update Data Wrapper to Pass New Props

**Files:**
- Modify: `web/src/app/(platform)/configuracoes/configuracoes-page-client.tsx`

- [ ] **Step 1: Add userRole and initialTab props**

Update the interface and component to accept and forward the new props:

```tsx
'use client'

import { useMemo } from 'react'
import { useTenant, useTenantUsers } from '@/hooks/queries/use-tenant'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import { useAllProducts } from '@/hooks/queries/use-products'
import { useConsentTemplates } from '@/hooks/queries/use-consent'
import { useEvaluationTemplates } from '@/hooks/queries/use-evaluation'
import { SettingsPageClient } from './settings-page-client'
import ConfiguracoesLoading from './loading'

interface ConfiguracoesPageClientProps {
  currentUserId: string
  userRole: string
  initialTab?: string
}

export function ConfiguracoesPageClientWrapper({ currentUserId, userRole, initialTab }: ConfiguracoesPageClientProps) {
  const isOwner = userRole === 'owner'
  const { data: tenant, isLoading: tenantLoading } = useTenant()
  const { data: procedureTypes, isLoading: ptLoading } = useProcedureTypes()
  const { data: products, isLoading: productsLoading } = useAllProducts()
  const { data: members, isLoading: membersLoading } = useTenantUsers()
  const { data: consentTemplates, isLoading: ctLoading } = useConsentTemplates()

  const procedureTypeIds = useMemo(
    () => (procedureTypes ?? []).map((pt: { id: string }) => pt.id),
    [procedureTypes]
  )

  const { data: evaluationTemplates } = useEvaluationTemplates(procedureTypeIds)

  const templateStatusMap = useMemo(() => {
    const map: Record<string, boolean> = {}
    if (evaluationTemplates) {
      for (const tmpl of evaluationTemplates) {
        map[tmpl.procedureTypeId] = true
      }
    }
    return map
  }, [evaluationTemplates])

  const isLoading = tenantLoading || (isOwner && (ptLoading || productsLoading || membersLoading || ctLoading))

  if (isLoading) {
    return <ConfiguracoesLoading />
  }

  if (!tenant) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Erro ao carregar configurações.</p>
      </div>
    )
  }

  return (
    <SettingsPageClient
      tenant={tenant}
      procedureTypes={procedureTypes ?? []}
      products={products ?? []}
      members={members ?? []}
      consentTemplates={consentTemplates ?? []}
      currentUserId={currentUserId}
      userRole={userRole}
      initialTab={initialTab}
      templateStatusMap={templateStatusMap}
    />
  )
}
```

Note: These hooks don't accept parameters to skip fetching. They always fire, but the API returns data filtered by the user's role anyway. The `isLoading` gate for non-owners only waits on `tenantLoading` since owner-only tabs won't render.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: FAIL (SettingsPageClient doesn't accept `userRole`/`initialTab` yet — that's Task 4)

- [ ] **Step 3: Commit**

```bash
git add web/src/app/(platform)/configuracoes/configuracoes-page-client.tsx
git commit -m "refactor(settings): forward userRole and initialTab to settings client"
```

---

## Group C (depends on B)

### Task 4: Rewrite Settings Page Client with Groups, URL Tabs, and Inlined Content

**Files:**
- Modify: `web/src/app/(platform)/configuracoes/settings-page-client.tsx`

- [ ] **Step 1: Replace TABS and LINK_ITEMS with grouped structure**

Replace the `TABS` and `LINK_ITEMS` constants (lines 104-125) with:

```tsx
const SIDEBAR_GROUPS = [
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
] as const

type TabKey = (typeof SIDEBAR_GROUPS)[number]['items'][number]['key']

const ALL_TABS = SIDEBAR_GROUPS.flatMap((g) => g.items)

const VALID_TAB_KEYS = new Set<string>(ALL_TABS.map((t) => t.key))

const TAB_ROLES: Partial<Record<TabKey, string[]>> = {
  perfil: [],
  documentos: ['owner', 'practitioner'],
}

const DEFAULT_OWNER_TAB: TabKey = 'clinica'
const DEFAULT_NON_OWNER_TAB: TabKey = 'perfil'
```

- [ ] **Step 2: Add new imports and update props interface**

Add to imports:
```tsx
import { useCallback, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
```

Add new imports for inlined sub-route content:
```tsx
import { PackageTemplateList } from '@/components/packages/package-template-list'
import { usePackageTemplates } from '@/hooks/queries/use-packages'
import { DocumentTemplateList } from '@/components/settings/document-template-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProfile } from '@/hooks/queries/use-profile'
import { AccountInfoForm } from '@/components/settings/account-info-form'
import { PasswordForm } from '@/components/settings/password-form'
import { ProfessionalSignatureForm } from '@/components/settings/professional-signature-form'
```

Remove `ChevronRightIcon` from lucide imports (no longer needed).

Update props:
```tsx
interface SettingsPageClientProps {
  tenant: Tenant
  procedureTypes: ProcedureType[]
  products: Product[]
  members: TeamMember[]
  consentTemplates: ConsentTemplate[]
  currentUserId: string
  userRole: string
  initialTab?: string
  templateStatusMap?: Record<string, boolean>
}
```

- [ ] **Step 3: Implement URL-based tab state with role filtering**

Replace the component function body (lines 129-335) with the new implementation:

```tsx
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

  // Build visible groups (filter out empty groups)
  const visibleGroups = SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => visibleKeys.has(item.key)),
  })).filter((group) => group.items.length > 0)
```

- [ ] **Step 4: Add helper components for Pacotes and Perfil tabs**

These encapsulate hook calls so they only fire when the tab is mounted:

```tsx
function PacotesTabContent() {
  const { data, isLoading } = usePackageTemplates()
  return <PackageTemplateList templates={data ?? []} isLoading={isLoading} />
}

function PerfilTabContent({ userRole }: { userRole: string }) {
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
```

Place these above the main `SettingsPageClient` function in the same file.

- [ ] **Step 5: Implement the JSX with grouped sidebar**

Replace the return JSX:

```tsx
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
                      onClick={() => setActiveTab(tab.key as TabKey)}
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
```

- [ ] **Step 6: Clean up unused imports**

Remove `Link` from imports (no longer used since LINK_ITEMS is gone). Remove `useState` from `'react'` import if the new import already covers it. Keep `{ useCallback, useState }` from `'react'`.

- [ ] **Step 7: Verify it compiles**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/src/app/(platform)/configuracoes/settings-page-client.tsx
git commit -m "feat(settings): grouped sidebar, URL tab params, inlined sub-routes"
```

---

## Group D (depends on C)

### Task 5: Delete Old Sub-Route Pages

**Files:**
- Delete: `web/src/app/(platform)/configuracoes/pacotes/page.tsx`
- Delete: `web/src/app/(platform)/configuracoes/pacotes/pacotes-page-client.tsx`
- Delete: `web/src/app/(platform)/configuracoes/documentos/page.tsx`
- Delete: `web/src/app/(platform)/configuracoes/documentos/documentos-page-client.tsx`
- Delete: `web/src/app/(platform)/configuracoes/perfil/page.tsx`
- Delete: `web/src/app/(platform)/configuracoes/perfil/perfil-page-client.tsx`

- [ ] **Step 1: Delete the sub-route directories**

```bash
rm -rf web/src/app/\(platform\)/configuracoes/pacotes
rm -rf web/src/app/\(platform\)/configuracoes/documentos
rm -rf web/src/app/\(platform\)/configuracoes/perfil
```

- [ ] **Step 2: Update stale links to deleted sub-routes**

Known references to update:

In `web/src/components/layout/user-menu.tsx` — find the "Meu Perfil" link (href `/configuracoes/perfil`) and change to `/configuracoes?tab=perfil`.

In `web/src/components/clinical-documents/issue-document-dialog.tsx` — find the "Ir para o perfil" link (href `/configuracoes/perfil`) and change to `/configuracoes?tab=perfil`.

Then search for any remaining references:

```bash
grep -r "configuracoes/pacotes\|configuracoes/documentos\|configuracoes/perfil\|PacotesPageClient\|DocumentosPageClient\|PerfilPageClient" web/src/ --include="*.ts" --include="*.tsx" -l
```

Update any remaining references to use the `?tab=` URL pattern.

- [ ] **Step 3: Verify it compiles and tests pass**

Run: `pnpm --filter @floraclin/web typecheck && pnpm --filter @floraclin/web test:run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A web/src/app/\(platform\)/configuracoes/
git commit -m "chore(settings): delete old pacotes/documentos/perfil sub-routes"
```

'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LogoSymbol } from '@/components/brand/logo-symbol'
import {
  LayoutDashboard,
  Calendar,
  Users,
  Banknote,
  Settings,
  TrendingUp,
  Building2,
  UsersRound,
  SearchIcon,
} from 'lucide-react'
import { useImpersonate } from '@/hooks/mutations/use-impersonation'
import { useAdminTenants } from '@/hooks/queries/use-admin-tenants'

export interface TenantOption {
  tenantId: string
  tenantName: string
}

interface SidebarProps {
  clinicName: string
  userName: string
  userRole?: string
  tenants?: TenantOption[]
  activeTenantId?: string
  isPlatformAdmin?: boolean
  impersonatingTenantName?: string
}

const principalItems = [
  { href: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { href: '/agenda', label: 'Agenda', icon: Calendar },
  { href: '/pacientes', label: 'Pacientes', icon: Users },
]

const gestaoItems = [
  { href: '/financeiro', label: 'Financeiro', icon: Banknote },
]

const bottomItems = [
  { href: '#', label: 'Relatórios', icon: TrendingUp, disabled: true },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
]

// ─── Logo ──────────────────────────────────────────────────────────

function SidebarLogo() {
  return (
    <div className="flex-shrink-0 px-5 pt-6 pb-4">
      <div className="flex items-center gap-2">
        <LogoSymbol className="size-6 text-sage" />
        <h1 className="font-display text-xl font-semibold leading-none tracking-wide">
          <span className="text-forest">Flora</span>
          <span className="text-sage">Clin</span>
        </h1>
      </div>
    </div>
  )
}

// ─── Section Label ────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-5 pb-1.5 pt-4 text-[10px] uppercase tracking-[0.15em] text-mid">
      {label}
    </p>
  )
}

// ─── Nav Item ─────────────────────────────────────────────────────

function NavItem({
  href,
  label,
  icon: Icon,
  isActive,
  disabled,
  onNavigate,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  isActive: boolean
  disabled?: boolean
  onNavigate?: () => void
}) {
  const content = (
    <>
      {/* Active left border */}
      {isActive && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-sm bg-sage" />
      )}
      <Icon
        className={cn(
          'size-[18px] transition-colors duration-150',
          isActive ? 'text-sage' : 'text-mid'
        )}
      />
      <span>{label}</span>
    </>
  )

  if (disabled) {
    return (
      <span
        className="relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium text-mid/50 cursor-not-allowed"
      >
        {content}
      </span>
    )
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-testid={`sidebar-nav-${href.replace('/', '')}`}
      className={cn(
        'relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-150',
        isActive
          ? 'bg-sage/10 text-forest'
          : 'text-mid hover:bg-sage/5 hover:text-charcoal'
      )}
    >
      {content}
    </Link>
  )
}

// ─── Tenant Switcher (Admin Impersonation) ────────────────────────

function TenantSwitcher({ currentTenantName, impersonatingTenantName }: { currentTenantName: string; impersonatingTenantName?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null) // 'switching:Name' or 'clearing'
  const impersonate = useImpersonate()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // React Query — cached, deduped, shows stale data while refetching
  const { data, isFetching } = useAdminTenants(debouncedSearch, 1)
  const results: Array<{ id: string; name: string }> = isOpen
    ? (data?.data ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))
    : []
  const isLoading = isFetching && results.length === 0
  const showDropdown = isOpen && (isLoading || results.length > 0 || (search.length >= 2 && results.length === 0))

  // no positioning hooks needed — dropdown uses CSS-only positioning

  const handleClear = async () => {
    setPendingAction('clearing')
    await fetch('/api/admin/impersonate/clear', { method: 'POST' })
    window.location.reload()
  }

  const handleSwitch = (tenant: { id: string; name: string }) => {
    setIsOpen(false)
    setPendingAction(`switching:${tenant.name}`)
    impersonate.mutate({ tenantId: tenant.id })
  }

  return (
    <div className="px-3 mt-2 relative" ref={containerRef}>
      {!isOpen ? (
        /* Collapsed — button showing current state */
        <button
          type="button"
          onClick={() => { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
          className={cn(
            'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all duration-200',
            impersonatingTenantName
              ? 'bg-gradient-to-r from-emerald-50 to-sage/10 border border-emerald-200/60'
              : 'border border-sage/15 hover:border-sage/30 hover:bg-sage/5'
          )}
        >
          {pendingAction === 'clearing' ? (
            <>
              <span className="size-2 animate-pulse rounded-full bg-sage/50 shrink-0" />
              <span className="flex-1 text-[11px] text-mid/50">Saindo...</span>
            </>
          ) : pendingAction?.startsWith('switching:') ? (
            <>
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="flex-1 text-[11px] font-medium text-forest truncate">{pendingAction.replace('switching:', '')}</span>
              <span className="size-2 animate-pulse rounded-full bg-sage/50 shrink-0" />
            </>
          ) : impersonatingTenantName ? (
            <>
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="flex-1 text-[11px] font-medium text-forest truncate">{impersonatingTenantName}</span>
              <span
                className="text-[10px] text-mid/70 hover:text-red-500 transition-colors shrink-0"
                onClick={(e) => { e.stopPropagation(); handleClear() }}
              >
                sair
              </span>
            </>
          ) : (
            <>
              <Building2 className="h-3 w-3 text-mid shrink-0" />
              <span className="flex-1 text-[11px] font-medium text-charcoal truncate">{currentTenantName}</span>
              <span className="text-[10px] text-mid/50 shrink-0">trocar</span>
            </>
          )}
        </button>
      ) : (
        /* Expanded — search input */
        <div className="flex items-center gap-2 rounded-lg border border-sage/30 bg-white px-2.5 py-2">
          <SearchIcon className="h-3 w-3 text-mid/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Trocar clínica..."
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setTimeout(() => { setIsOpen(false); setSearch(''); setDebouncedSearch('') }, 200)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setIsOpen(false); setSearch(''); setDebouncedSearch('') } }}
            className="flex-1 bg-transparent text-[11px] text-charcoal placeholder:text-mid/40 outline-none"
          />
          {isLoading && (
            <span className="size-2 animate-pulse rounded-full bg-sage/50 shrink-0" />
          )}
        </div>
      )}

      {/* Fixed dropdown — opens upward */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-lg border border-sage/20 bg-white shadow-lg overflow-hidden" style={{ maxHeight: 240 }}>
          {isLoading && results.length === 0 ? (
            <div className="flex items-center justify-center gap-1.5 px-2.5 py-3">
              <span className="size-1.5 animate-pulse rounded-full bg-sage/50" />
              <span className="text-[10px] text-mid/50">Carregando...</span>
            </div>
          ) : results.length > 0 ? (
            <div className="overflow-y-auto" style={{ maxHeight: 232 }}>
              {results.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-[11px] text-charcoal hover:bg-sage/8 transition-colors border-b border-sage/5 last:border-b-0"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSwitch(t)
                  }}
                  disabled={impersonate.isPending}
                >
                  <Building2 className="h-3 w-3 text-mid/40 shrink-0" />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-2.5 py-3 text-[10px] text-mid/50 text-center">
              Nenhuma clínica encontrada
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Admin Nav Items ──────────────────────────────────────────────

const adminItems = [
  { href: '/admin/clinicas', label: 'Clínicas', icon: Building2 },
  { href: '/admin/usuarios', label: 'Usuários', icon: UsersRound },
]

// ─── Navigation ────────────────────────────────────────────────────

function SidebarNav({
  onNavigate,
  isPlatformAdmin,
  impersonatingTenantName,
}: {
  onNavigate?: () => void
  isPlatformAdmin?: boolean
  impersonatingTenantName?: string
}) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 py-1 overflow-y-auto">
      <SectionLabel label="Principal" />
      <div className="space-y-0.5">
        {principalItems.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            isActive={pathname.startsWith(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <SectionLabel label="Gestão" />
      <div className="space-y-0.5">
        {gestaoItems.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            isActive={pathname.startsWith(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* Separator */}
      <div className="mx-2 my-3 h-px bg-sage/15" />

      <div className="space-y-0.5">
        {bottomItems.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            disabled={item.disabled}
            isActive={!item.disabled && pathname.startsWith(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {isPlatformAdmin && (
        <>
          <div className="mx-2 my-3 h-px bg-sage/15" />

          <SectionLabel label="Plataforma" />
          <div className="space-y-0.5">
            {adminItems.map((item) => (
              <NavItem
                key={item.href}
                {...item}
                isActive={pathname.startsWith(item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </>
      )}
    </nav>
  )
}

// ─── Desktop Sidebar ───────────────────────────────────────────────

export function Sidebar({ clinicName, userName, userRole, tenants, activeTenantId, isPlatformAdmin, impersonatingTenantName }: SidebarProps) {
  return (
    <aside
      className="hidden md:flex md:w-[200px] md:flex-col md:fixed md:inset-y-0 bg-white border-r border-[#E8ECEF]"
      data-testid="sidebar"
    >
      <div className="relative flex flex-1 flex-col min-h-0">
        <SidebarLogo />
        <SidebarNav isPlatformAdmin={isPlatformAdmin} impersonatingTenantName={impersonatingTenantName} />
        {isPlatformAdmin && (
          <div className="shrink-0 border-t border-[#E8ECEF] pb-3 pt-1 relative overflow-visible">
            <TenantSwitcher currentTenantName={clinicName} impersonatingTenantName={impersonatingTenantName} />
          </div>
        )}
        <div className="shrink-0 px-5 pb-3">
          <p className="text-[9px] text-mid/30 select-none" title={`Build: ${process.env.NEXT_PUBLIC_BUILD_DATE ?? 'dev'}`}>
            v{process.env.NEXT_PUBLIC_BUILD_DATE ?? 'dev'}
          </p>
        </div>
      </div>
    </aside>
  )
}

// ─── Mobile Sidebar Content ────────────────────────────────────────

export function MobileSidebarContent({
  onNavigate,
  clinicName = 'FloraClin',
  isPlatformAdmin,
  impersonatingTenantName,
}: {
  onNavigate?: () => void
  clinicName?: string
  userName?: string
  userRole?: string
  tenants?: TenantOption[]
  activeTenantId?: string
  isPlatformAdmin?: boolean
  impersonatingTenantName?: string
}) {
  return (
    <div className="relative flex h-full flex-1 flex-col min-h-0 bg-white overflow-hidden">
      <SidebarLogo />
      <SidebarNav onNavigate={onNavigate} isPlatformAdmin={isPlatformAdmin} impersonatingTenantName={impersonatingTenantName} />
      {isPlatformAdmin && (
        <div className="shrink-0 border-t border-[#E8ECEF] pb-3 pt-1">
          <TenantSwitcher currentTenantName={clinicName} impersonatingTenantName={impersonatingTenantName} />
        </div>
      )}
    </div>
  )
}

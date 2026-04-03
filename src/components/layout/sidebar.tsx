'use client'

import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import { useImpersonate } from '@/hooks/mutations/use-impersonation'

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

function TenantSwitcher() {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const impersonate = useImpersonate()

  // Debounced search
  useEffect(() => {
    if (search.length < 2) {
      setResults([])
      return
    }
    let ignore = false
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/admin/tenants?search=${encodeURIComponent(search)}&limit=5`
      )
      if (res.ok && !ignore) {
        const data = await res.json()
        setResults(
          (data.data ?? []).map((t: { id: string; name: string }) => ({
            id: t.id,
            name: t.name,
          }))
        )
      }
    }, 300)
    return () => { ignore = true; clearTimeout(timer) }
  }, [search])

  return (
    <div className="relative px-3 mt-2">
      <input
        type="text"
        placeholder="Trocar clínica..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        className="w-full rounded-md border border-sage/20 bg-transparent px-2.5 py-1.5 text-xs text-charcoal placeholder:text-mid/50 outline-none focus:border-sage/40"
      />
      {showDropdown && results.length > 0 && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-md border bg-white shadow-md">
          {results.map((t) => (
            <button
              key={t.id}
              type="button"
              className="flex w-full items-center px-2.5 py-1.5 text-xs text-charcoal hover:bg-sage/5"
              onMouseDown={(e) => {
                e.preventDefault()
                impersonate.mutate({ tenantId: t.id })
              }}
            >
              {t.name}
            </button>
          ))}
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

          {impersonatingTenantName && (
            <div className="mx-3 mt-2 flex items-center justify-between rounded-md bg-sage/10 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-forest truncate">{impersonatingTenantName}</span>
              </div>
              <button
                type="button"
                className="text-xs text-mid hover:text-charcoal"
                onClick={async () => {
                  await fetch('/api/admin/impersonate/clear', { method: 'POST' })
                  window.location.reload()
                }}
              >
                ✕
              </button>
            </div>
          )}

          <TenantSwitcher />
        </>
      )}
    </nav>
  )
}

// ─── Desktop Sidebar ───────────────────────────────────────────────

export function Sidebar({ clinicName, userName, userRole, tenants, activeTenantId, isPlatformAdmin, impersonatingTenantName }: SidebarProps) {
  return (
    <aside
      className="hidden md:flex md:w-[200px] md:flex-col md:fixed md:inset-y-0 bg-white border-r border-[#E8ECEF] overflow-hidden"
      data-testid="sidebar"
    >
      <div className="relative flex flex-1 flex-col min-h-0">
        <SidebarLogo />
        <SidebarNav isPlatformAdmin={isPlatformAdmin} impersonatingTenantName={impersonatingTenantName} />
      </div>
    </aside>
  )
}

// ─── Mobile Sidebar Content ────────────────────────────────────────

export function MobileSidebarContent({
  onNavigate,
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
    </div>
  )
}

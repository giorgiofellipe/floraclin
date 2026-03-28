'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Calendar,
  Users,
  Banknote,
  Settings,
  TrendingUp,
} from 'lucide-react'

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
      <h1 className="font-display text-xl font-semibold leading-none tracking-wide">
        <span className="text-cream">Flora</span>
        <span className="text-mint">Clin</span>
      </h1>
    </div>
  )
}

// ─── Section Label ────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-5 pb-1.5 pt-4 text-[10px] uppercase tracking-[0.15em] text-white/30">
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
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-sm bg-mint" />
      )}
      <Icon
        className={cn(
          'size-[18px] transition-colors duration-150',
          isActive ? 'text-mint' : 'text-white/45'
        )}
      />
      <span>{label}</span>
    </>
  )

  if (disabled) {
    return (
      <span
        className="relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium text-white/25 cursor-not-allowed"
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
          ? 'bg-[rgba(143,180,154,0.15)] text-white'
          : 'text-white/45 hover:bg-[rgba(255,255,255,0.08)] hover:text-white/70'
      )}
    >
      {content}
    </Link>
  )
}

// ─── Navigation ────────────────────────────────────────────────────

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
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
      <div className="mx-2 my-3 h-px bg-white/10" />

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
    </nav>
  )
}

// ─── User Profile Block ───────────────────────────────────────────

function SidebarUserProfile({ userName, userRole }: { userName: string; userRole?: string }) {
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2">
      <div className="h-px bg-white/10 mb-3" />
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-full bg-sage text-[11px] font-semibold text-cream">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-white/80">{userName}</p>
          {userRole && (
            <span className="inline-block rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {userRole}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Desktop Sidebar ───────────────────────────────────────────────

export function Sidebar({ clinicName, userName, userRole, tenants, activeTenantId }: SidebarProps) {
  return (
    <aside
      className="hidden md:flex md:w-[200px] md:flex-col md:fixed md:inset-y-0 bg-forest overflow-hidden"
      data-testid="sidebar"
    >
      <div className="relative flex flex-1 flex-col min-h-0">
        <SidebarLogo />
        <SidebarNav />
        <SidebarUserProfile userName={userName} userRole={userRole} />
      </div>
    </aside>
  )
}

// ─── Mobile Sidebar Content ────────────────────────────────────────

export function MobileSidebarContent({
  onNavigate,
  clinicName,
  userName,
  userRole,
  tenants,
  activeTenantId,
}: {
  onNavigate?: () => void
  clinicName?: string
  userName?: string
  userRole?: string
  tenants?: TenantOption[]
  activeTenantId?: string
}) {
  return (
    <div className="relative flex h-full flex-1 flex-col min-h-0 bg-forest overflow-hidden">
      <SidebarLogo />
      <SidebarNav onNavigate={onNavigate} />
      <SidebarUserProfile userName={userName ?? ''} userRole={userRole} />
    </div>
  )
}

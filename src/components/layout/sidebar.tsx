'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Calendar,
  Users,
  Banknote,
  Settings,
  ChevronsUpDown,
  Sparkles,
} from 'lucide-react'
import { switchTenantAction } from '@/actions/auth'

const navItems = [
  { href: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { href: '/agenda', label: 'Agenda', icon: Calendar },
  { href: '/pacientes', label: 'Pacientes', icon: Users },
  { href: '/financeiro', label: 'Financeiro', icon: Banknote },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
]

export interface TenantOption {
  tenantId: string
  tenantName: string
}

interface SidebarProps {
  clinicName: string
  tenants?: TenantOption[]
  activeTenantId?: string
}

// ─── Botanical Accent ──────────────────────────────────────────────
// A subtle decorative element at the bottom of the sidebar

function BotanicalAccent() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-48 overflow-hidden opacity-[0.04]">
      <svg
        viewBox="0 0 200 200"
        className="absolute -bottom-8 -right-8 h-48 w-48"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
      >
        {/* Stylized flower/leaf motif */}
        <circle cx="100" cy="100" r="30" />
        <circle cx="100" cy="100" r="50" />
        <circle cx="100" cy="100" r="70" />
        <ellipse cx="100" cy="50" rx="15" ry="30" />
        <ellipse cx="100" cy="150" rx="15" ry="30" />
        <ellipse cx="50" cy="100" rx="30" ry="15" />
        <ellipse cx="150" cy="100" rx="30" ry="15" />
        <ellipse cx="65" cy="65" rx="20" ry="10" transform="rotate(-45 65 65)" />
        <ellipse cx="135" cy="65" rx="20" ry="10" transform="rotate(45 135 65)" />
        <ellipse cx="65" cy="135" rx="20" ry="10" transform="rotate(45 65 135)" />
        <ellipse cx="135" cy="135" rx="20" ry="10" transform="rotate(-45 135 135)" />
      </svg>
    </div>
  )
}

// ─── Tenant Switcher ───────────────────────────────────────────────

function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: TenantOption[]
  activeTenantId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTenantId = e.target.value
    if (newTenantId === activeTenantId) return

    startTransition(async () => {
      await switchTenantAction(newTenantId)
      router.refresh()
    })
  }

  return (
    <div className="relative mt-2">
      <select
        value={activeTenantId}
        onChange={handleChange}
        disabled={isPending}
        className={cn(
          'w-full appearance-none rounded border border-gold/20 bg-gold/5 px-2.5 py-1.5 text-xs text-cream/60',
          'focus:border-gold/40 focus:outline-none focus:ring-1 focus:ring-gold/30',
          'disabled:opacity-50',
          'cursor-pointer transition-colors duration-200'
        )}
      >
        {tenants.map((t) => (
          <option key={t.tenantId} value={t.tenantId} className="bg-forest text-cream">
            {t.tenantName}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-gold/40" />
    </div>
  )
}

// ─── Logo ──────────────────────────────────────────────────────────

function SidebarLogo({
  clinicName,
  tenants,
  activeTenantId,
}: {
  clinicName: string
  tenants?: TenantOption[]
  activeTenantId?: string
}) {
  const showSwitcher = tenants && tenants.length > 1 && activeTenantId

  return (
    <div className="flex-shrink-0 px-5 pb-5 pt-7">
      {/* Logo mark */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-full border border-gold/20 bg-gold/5">
          <Sparkles className="size-3.5 text-gold/70" />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold leading-none tracking-wide">
            <span className="text-cream">Flora</span>
            <span className="text-mint">Clin</span>
          </h1>
        </div>
      </div>

      {/* Clinic name */}
      <div className="mt-4">
        <p
          className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-gold/50"
          data-testid="sidebar-clinic-name"
        >
          {clinicName}
        </p>
        {showSwitcher && (
          <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />
        )}
      </div>

      {/* Separator with gold accent */}
      <div className="mt-5 h-px bg-gradient-to-r from-gold/20 via-gold/10 to-transparent" />
    </div>
  )
}

// ─── Navigation ────────────────────────────────────────────────────

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-2">
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            data-testid={`sidebar-nav-${item.href.replace('/', '')}`}
            className={cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
              isActive
                ? 'text-cream'
                : 'text-cream/40 hover:text-cream/80'
            )}
          >
            {/* Active indicator — gold left bar */}
            {isActive && (
              <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-gold/60" />
            )}

            {/* Hover/active background with subtle gradient */}
            <span
              className={cn(
                'absolute inset-0 rounded-lg transition-opacity duration-200',
                isActive
                  ? 'bg-gradient-to-r from-sage/15 to-transparent opacity-100'
                  : 'bg-gradient-to-r from-cream/5 to-transparent opacity-0 group-hover:opacity-100'
              )}
            />

            <item.icon
              className={cn(
                'relative size-[18px] transition-colors duration-200',
                isActive ? 'text-mint' : 'text-cream/30 group-hover:text-cream/60'
              )}
            />
            <span className="relative">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

// ─── Footer ────────────────────────────────────────────────────────

function SidebarFooter() {
  return (
    <div className="flex-shrink-0 px-5 pb-5">
      <div className="h-px bg-gradient-to-r from-gold/20 via-gold/10 to-transparent" />
      <p className="mt-4 text-center text-[9px] font-medium uppercase tracking-[0.25em] text-cream/15">
        Gestão &middot; HOF &amp; Estética
      </p>
    </div>
  )
}

// ─── Desktop Sidebar ───────────────────────────────────────────────

export function Sidebar({ clinicName, tenants, activeTenantId }: SidebarProps) {
  return (
    <aside
      className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-forest overflow-hidden"
      data-testid="sidebar"
    >
      <div className="relative flex flex-1 flex-col min-h-0">
        <SidebarLogo
          clinicName={clinicName}
          tenants={tenants}
          activeTenantId={activeTenantId}
        />
        <SidebarNav />
        <SidebarFooter />
        <BotanicalAccent />
      </div>
    </aside>
  )
}

// ─── Mobile Sidebar Content ────────────────────────────────────────

export function MobileSidebarContent({
  onNavigate,
  clinicName,
  tenants,
  activeTenantId,
}: {
  onNavigate?: () => void
  clinicName?: string
  tenants?: TenantOption[]
  activeTenantId?: string
}) {
  return (
    <div className="relative flex h-full flex-1 flex-col min-h-0 bg-forest overflow-hidden">
      <SidebarLogo
        clinicName={clinicName ?? 'FloraClin'}
        tenants={tenants}
        activeTenantId={activeTenantId}
      />
      <SidebarNav onNavigate={onNavigate} />
      <SidebarFooter />
      <BotanicalAccent />
    </div>
  )
}

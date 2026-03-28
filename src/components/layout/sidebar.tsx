'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Calendar, Users, DollarSign, Settings, ChevronsUpDown } from 'lucide-react'
import { switchTenantAction } from '@/actions/auth'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agenda', label: 'Agenda', icon: Calendar },
  { href: '/pacientes', label: 'Pacientes', icon: Users },
  { href: '/financeiro', label: 'Financeiro', icon: DollarSign },
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

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-2 py-4 space-y-1">
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            data-testid={`sidebar-nav-${item.href.replace('/', '')}`}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-sage/20 text-cream'
                : 'text-cream/70 hover:bg-sage/10 hover:text-cream'
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

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
    <div className="relative mt-1">
      <select
        value={activeTenantId}
        onChange={handleChange}
        disabled={isPending}
        className={cn(
          'w-full appearance-none rounded-md border border-sage/30 bg-sage/10 px-2 py-1 pr-7 text-xs text-cream/70',
          'focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint',
          'disabled:opacity-50',
          'cursor-pointer'
        )}
      >
        {tenants.map((t) => (
          <option key={t.tenantId} value={t.tenantId} className="bg-forest text-cream">
            {t.tenantName}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-cream/50" />
    </div>
  )
}

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
    <div className="flex-shrink-0 px-4 py-3 border-b border-sage/20">
      <h1 className="font-display text-lg font-semibold">
        <span className="text-cream">Flora</span>
        <span className="text-mint">Clin</span>
      </h1>
      <p className="text-cream/50 text-xs mt-0.5 truncate" data-testid="sidebar-clinic-name">{clinicName}</p>
      {showSwitcher && (
        <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />
      )}
    </div>
  )
}

export function Sidebar({ clinicName, tenants, activeTenantId }: SidebarProps) {
  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-forest" data-testid="sidebar">
      <div className="flex flex-col flex-1 min-h-0">
        <SidebarLogo clinicName={clinicName} tenants={tenants} activeTenantId={activeTenantId} />
        <SidebarNav />
      </div>
    </aside>
  )
}

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
    <div className="flex flex-col flex-1 min-h-0 bg-forest h-full">
      <SidebarLogo
        clinicName={clinicName ?? 'FloraClin'}
        tenants={tenants}
        activeTenantId={activeTenantId}
      />
      <SidebarNav onNavigate={onNavigate} />
    </div>
  )
}

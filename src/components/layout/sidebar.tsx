'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Calendar, Users, DollarSign, Settings } from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agenda', label: 'Agenda', icon: Calendar },
  { href: '/pacientes', label: 'Pacientes', icon: Users },
  { href: '/financeiro', label: 'Financeiro', icon: DollarSign },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
]

interface SidebarProps {
  clinicName: string
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

function SidebarLogo() {
  return (
    <div className="flex items-center h-16 flex-shrink-0 px-4 border-b border-sage/20">
      <h1 className="font-display text-lg font-semibold">
        <span className="text-cream">Flora</span>
        <span className="text-mint">Clin</span>
      </h1>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Sidebar({ clinicName }: SidebarProps) {
  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-forest">
      <div className="flex flex-col flex-1 min-h-0">
        <SidebarLogo />
        <SidebarNav />
      </div>
    </aside>
  )
}

export function MobileSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-forest h-full">
      <SidebarLogo />
      <SidebarNav onNavigate={onNavigate} />
    </div>
  )
}

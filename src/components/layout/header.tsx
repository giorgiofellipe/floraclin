'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { UserMenu } from './user-menu'
import { MobileSidebarContent, type TenantOption } from './sidebar'

// ─── Page Title Mapping ───────────────────────────────────────────

function getPageTitle(pathname: string): { title: string; subtitle?: string } {
  const now = new Date()
  const weekdays = ['Domingo', 'Segunda-feira', 'Ter\u00e7a-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'S\u00e1bado']
  const months = ['janeiro', 'fevereiro', 'mar\u00e7o', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  const dateStr = `${weekdays[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`

  if (pathname === '/dashboard' || pathname === '/') {
    return { title: 'Painel', subtitle: dateStr }
  }
  if (pathname === '/agenda') {
    return { title: 'Agenda', subtitle: dateStr }
  }
  if (pathname === '/pacientes') {
    return { title: 'Pacientes' }
  }
  if (pathname.startsWith('/pacientes/')) {
    return { title: 'Pacientes', subtitle: 'Detalhes do paciente' }
  }
  if (pathname === '/financeiro') {
    return { title: 'Financeiro' }
  }
  if (pathname === '/configuracoes') {
    return { title: 'Configura\u00e7\u00f5es' }
  }
  if (pathname === '/admin/clinicas') {
    return { title: 'Cl\u00ednicas' }
  }
  if (pathname === '/admin/usuarios') {
    return { title: 'Usu\u00e1rios' }
  }
  return { title: '' }
}

interface HeaderProps {
  userName: string
  userEmail: string
  clinicName?: string
  tenants?: TenantOption[]
  activeTenantId?: string
  isPlatformAdmin?: boolean
  impersonatingTenantName?: string
}

export function Header({ userName, userEmail, clinicName, tenants, activeTenantId, isPlatformAdmin, impersonatingTenantName }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const { title, subtitle } = getPageTitle(pathname)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false) // eslint-disable-line react-hooks/set-state-in-effect
  }, [pathname])

  return (
    <>
      {impersonatingTenantName && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
          <span>
            Visualizando como <strong>{impersonatingTenantName}</strong>
          </span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs font-medium hover:bg-amber-100 transition-colors"
            onClick={async () => {
              await fetch('/api/admin/impersonate/clear', { method: 'POST' })
              window.location.reload()
            }}
          >
            Encerrar
          </button>
        </div>
      )}
      <header
        className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-[#E8ECEF] bg-white px-4 md:px-6"
        data-testid="header"
      >
        {/* Left: hamburger (mobile) + page title */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
            data-testid="header-mobile-menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="hidden md:block">
            <h2 className="text-[16px] font-medium leading-tight text-[#2A2A2A]" style={{ fontFamily: 'var(--font-sans)' }}>
              {title}
            </h2>
            {subtitle && (
              <p className="text-[12px] leading-tight text-[#7A7A7A]">{subtitle}</p>
            )}
          </div>
          {/* Mobile: centered title */}
          <div className="md:hidden">
            <h2 className="text-[15px] font-medium text-[#2A2A2A]">{title}</h2>
          </div>
        </div>

        {/* Right: notification bell + user avatar */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifica\u00e7\u00f5es">
            <Bell className="size-[18px] text-[#7A7A7A]" />
            {/* Amber notification dot */}
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-amber" />
          </Button>
          <UserMenu userName={userName} userEmail={userEmail} />
        </div>
      </header>

      {/* Mobile sidebar sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[200px] p-0">
          <SheetTitle className="sr-only">Menu de navega\u00e7\u00e3o</SheetTitle>
          <MobileSidebarContent
            onNavigate={() => setMobileMenuOpen(false)}
            clinicName={clinicName}
            userName={userName}
            tenants={tenants}
            activeTenantId={activeTenantId}
            isPlatformAdmin={isPlatformAdmin}
            impersonatingTenantName={impersonatingTenantName}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}

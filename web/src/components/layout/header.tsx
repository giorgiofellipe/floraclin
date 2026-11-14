'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { UserMenu } from './user-menu'
import { HelpMenu } from './help-menu'
import { MobileSidebarContent, type TenantOption } from './sidebar'
import { ReadOnlyBadge } from '@/components/layout/expired-paywall'
import { getPageTitle } from './page-title'
import { PatientSearch } from './patient-search'
import { QuickCreateMenu } from './quick-create'
import { BottomNav } from './bottom-nav'

interface HeaderProps {
  userName: string
  userEmail: string
  userId?: string
  userRole?: string
  clinicName?: string
  tenants?: TenantOption[]
  activeTenantId?: string
  isPlatformAdmin?: boolean
  impersonatingTenantName?: string
  whatsappEnabled?: boolean
}

export function Header({ userName, userEmail, userId, userRole, clinicName, tenants, activeTenantId, isPlatformAdmin, impersonatingTenantName, whatsappEnabled }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const { title, subtitle } = getPageTitle(pathname, new Date())

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
        // Bar height comes from --app-header-h (globals.css), shared with
        // full-height pages; the top padding keeps it clear of the notch.
        className="sticky top-0 z-10 flex h-[calc(var(--app-header-h)+env(safe-area-inset-top))] items-center justify-between border-b border-topbar-border bg-white px-4 pt-[env(safe-area-inset-top)] md:px-6"
        data-testid="header"
      >
        {/* Left: hamburger (mobile) + page title */}
        <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 size-11 md:hidden"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
            data-testid="header-mobile-menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="hidden min-w-0 md:block">
            <h2 className="font-sans text-base font-medium leading-tight text-charcoal">
              {title}
            </h2>
            {/* The date can differ between server render and hydration across BR midnight. */}
            {subtitle && (
              <p className="text-xs leading-tight text-mid-dark" suppressHydrationWarning>{subtitle}</p>
            )}
          </div>
          <div className="min-w-0 md:hidden">
            <h2 className="truncate text-[15px] font-medium text-charcoal" data-testid="header-title-mobile">{title}</h2>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <PatientSearch />
          <div className="hidden md:block">
            <QuickCreateMenu />
          </div>
          <ReadOnlyBadge />
          <HelpMenu />
          <UserMenu userName={userName} userEmail={userEmail} />
        </div>
      </header>

      {/* Mobile sidebar sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-(--app-sidebar-w) p-0">
          <SheetTitle className="sr-only">Menu de navega\u00e7\u00e3o</SheetTitle>
          <MobileSidebarContent
            onNavigate={() => setMobileMenuOpen(false)}
            clinicName={clinicName}
            userName={userName}
            userRole={userRole}
            tenants={tenants}
            activeTenantId={activeTenantId}
            isPlatformAdmin={isPlatformAdmin}
            impersonatingTenantName={impersonatingTenantName}
            whatsappEnabled={whatsappEnabled}
          />
        </SheetContent>
      </Sheet>

      <BottomNav onOpenMenu={() => setMobileMenuOpen(true)} menuOpen={mobileMenuOpen} />
    </>
  )
}

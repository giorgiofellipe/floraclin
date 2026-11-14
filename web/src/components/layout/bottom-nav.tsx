'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Banknote, Calendar, Menu, Plus, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { QuickCreateMenuItems, useQuickCreate } from './quick-create'

// Routes with their own fixed bottom bar or a full-height layout: the
// atendimento wizard, the procedure form, the face diagram editor and the
// WhatsApp inbox (composer at the bottom).
const HIDDEN_ON = [
  /^\/pacientes\/[^/]+\/atendimento(\/|$)/,
  /^\/pacientes\/[^/]+\/procedimentos\//,
  /^\/pacientes\/[^/]+\/diagramas\//,
  /^\/whatsapp(\/|$)/,
]

function hasBottomNav(pathname: string) {
  return !HIDDEN_ON.some((re) => re.test(pathname))
}

const TABS = [
  { href: '/agenda', label: 'Agenda', icon: Calendar },
  { href: '/pacientes', label: 'Pacientes', icon: Users },
  { href: '/financeiro', label: 'Financeiro', icon: Banknote },
]

const ITEM_CLASS =
  'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-[color,transform] duration-150 ease-out active:scale-[0.97]'

export function BottomNav({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const pathname = usePathname()
  const { items, open } = useQuickCreate()
  if (!hasBottomNav(pathname)) return null

  const activeHref = TABS.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href
  const moreActive = !activeHref || menuOpen
  const tabLink = (tab: (typeof TABS)[number]) => {
    const Icon = tab.icon
    const active = tab.href === activeHref
    return (
      <Link
        key={tab.href}
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        className={cn(ITEM_CLASS, active ? 'text-forest' : 'text-mid-dark')}
        data-testid={`bottom-nav-${tab.href.slice(1)}`}
      >
        <Icon className={cn('size-5.5', active && 'text-sage')} />
        {tab.label}
      </Link>
    )
  }

  return (
    <nav
      aria-label="Navegação principal"
      data-bottom-nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-topbar-border bg-white pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-1px_4px_rgba(0,0,0,0.04)] md:hidden"
    >
      <div className="flex h-(--bottom-nav-bar-h) items-stretch">
        {tabLink(TABS[0])}
        {tabLink(TABS[1])}
        <div className="flex flex-1 items-center justify-center">
          {items.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Criar novo"
                className="flex size-12 items-center justify-center rounded-full bg-forest text-cream shadow-md transition-transform duration-150 ease-out active:scale-[0.97] data-popup-open:bg-sage"
                data-testid="bottom-nav-create"
              >
                <Plus className="size-6" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" sideOffset={10} className="w-56">
                <QuickCreateMenuItems items={items} onPick={open} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {tabLink(TABS[2])}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className={cn(ITEM_CLASS, moreActive ? 'text-forest' : 'text-mid-dark')}
          data-testid="bottom-nav-more"
        >
          <Menu className={cn('size-5.5', moreActive && 'text-sage')} />
          Mais
        </button>
      </div>
    </nav>
  )
}

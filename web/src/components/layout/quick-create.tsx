'use client'

import { Fragment, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Banknote, CalendarPlus, Plus, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSubscriptionAccess, useWriteGuard } from '@/components/layout/subscription-access'
import { NEW_APPOINTMENT_PATH, NEW_CHARGE_PATH, NEW_PATIENT_PATH } from '@/lib/deep-links'
import { APPOINTMENT_CREATE_ROLES, CHARGE_CREATE_ROLES, PATIENT_CREATE_ROLES } from '@/lib/create-roles'

const QUICK_CREATE_ITEMS = [
  { key: 'appointment', label: 'Novo agendamento', href: NEW_APPOINTMENT_PATH, icon: CalendarPlus, roles: APPOINTMENT_CREATE_ROLES },
  { key: 'patient', label: 'Novo paciente', href: NEW_PATIENT_PATH, icon: UserPlus, roles: PATIENT_CREATE_ROLES },
  { key: 'charge', label: 'Nova cobrança', href: NEW_CHARGE_PATH, icon: Banknote, roles: CHARGE_CREATE_ROLES },
]

type QuickCreateItem = (typeof QUICK_CREATE_ITEMS)[number]

// The target pages open their form from the URL only on mount. A fresh `qc`
// on every pick remounts the page (QuickCreateBoundary), so the form also
// opens when the user is already on that page; the page clears it on close
// (useClearCreateParams).
const NONCE_PARAM = 'qc'

export function useQuickCreate() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const guardWrite = useWriteGuard()
  const { role } = useSubscriptionAccess()
  const items = QUICK_CREATE_ITEMS.filter((item) => item.roles.includes(role))
  const open = (item: QuickCreateItem) =>
    guardWrite(() => {
      const [targetPath, targetQuery] = item.href.split('?')
      // On the target page already: keep its date, view and filters.
      const params = new URLSearchParams(targetPath === pathname ? searchParams.toString() : '')
      new URLSearchParams(targetQuery).forEach((value, key) => params.set(key, value))
      params.set(NONCE_PARAM, String(Date.now()))
      router.push(`${targetPath}?${params}`)
    })()
  return { items, open }
}

export function QuickCreateBoundary({ children }: { children: React.ReactNode }) {
  const nonce = useSearchParams().get(NONCE_PARAM)
  // Latched: pages that later rewrite their URL without `qc` must not remount.
  const [key, setKey] = useState(nonce ?? '')
  if (nonce && nonce !== key) setKey(nonce)
  return <Fragment key={key}>{children}</Fragment>
}

export function QuickCreateMenuItems({ items, onPick }: { items: QuickCreateItem[]; onPick: (item: QuickCreateItem) => void }) {
  return items.map((item) => {
    const Icon = item.icon
    return (
      <DropdownMenuItem
        key={item.key}
        className="min-h-11 gap-2.5 px-3 text-sm md:min-h-9 md:text-[13px]"
        onClick={() => onPick(item)}
        data-testid={`quick-create-${item.key}`}
      >
        <Icon className="size-4 text-sage" />
        {item.label}
      </DropdownMenuItem>
    )
  })
}

export function QuickCreateMenu() {
  const { items, open } = useQuickCreate()
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button data-testid="header-quick-create">
            <Plus data-icon="inline-start" />
            Novo
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <QuickCreateMenuItems items={items} onPick={open} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

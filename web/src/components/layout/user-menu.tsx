'use client'

import Link from 'next/link'
import { logout } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut, UserIcon } from 'lucide-react'

interface UserMenuProps {
  userName: string
  userEmail: string
}

/**
 * Avatar dropdown in the top bar. "Meu Perfil" navigates to
 * `/configuracoes?tab=perfil` — the canonical profile surface that holds
 * account info, password, professional signature, and Google Calendar.
 *
 * (Until 2026-05-28 this opened an inline modal with name/phone/password +
 * Google Calendar; clinical signature/registry lived on the page. The two
 * surfaces were merged into the page so the signature pad has full
 * breathing room and there's one source of truth.)
 */
export function UserMenu({ userName, userEmail }: UserMenuProps) {
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative h-10 w-10 rounded-full focus:outline-none"
        render={
          <Button variant="ghost" className="relative h-10 w-10 rounded-full">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-sage text-cream">{initials}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent className="min-w-56" align="end">
        <div className="px-1.5 py-1">
          <p className="text-sm font-medium">{userName}</p>
          <p className="text-xs text-muted-foreground">{userEmail}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/configuracoes?tab=perfil" />}>
          <UserIcon className="mr-2 h-4 w-4" />
          Meu Perfil
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

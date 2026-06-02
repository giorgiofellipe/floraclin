'use client'

import { logout } from '@/actions/auth'
import { Button } from '@/components/ui/button'

export function LogoutButton() {
  return (
    <form action={logout} className="mt-6">
      <Button type="submit" variant="outline" className="text-mid">
        Sair
      </Button>
    </form>
  )
}

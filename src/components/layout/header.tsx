import { UserMenu } from './user-menu'

interface HeaderProps {
  userName: string
  userEmail: string
}

export function Header({ userName, userEmail }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-end border-b border-petal bg-cream px-6">
      <UserMenu userName={userName} userEmail={userEmail} />
    </header>
  )
}

'use client'

import { useState } from 'react'
import { logout } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut, UserIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

interface UserMenuProps {
  userName: string
  userEmail: string
}

export function UserMenu({ userName, userEmail }: UserMenuProps) {
  const [profileOpen, setProfileOpen] = useState(false)

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <>
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
          <DropdownMenuItem onClick={() => setProfileOpen(true)}>
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

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        userName={userName}
        userEmail={userEmail}
      />
    </>
  )
}

function ProfileDialog({
  open,
  onOpenChange,
  userName,
  userEmail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userName: string
  userEmail: string
}) {
  const [fullName, setFullName] = useState(userName)
  const [phone, setPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  async function handleSaveProfile() {
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, phone: phone || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao salvar')
      }
      toast.success('Perfil atualizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetPassword() {
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não conferem')
      return
    }
    if (newPassword.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPassword || undefined,
          newPassword,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao alterar senha')
      }
      toast.success('Senha atualizada')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar senha')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-charcoal">Meu Perfil</DialogTitle>
          <DialogDescription className="text-mid">
            {userEmail}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Profile info */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Nome</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Seu nome completo"
              />
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </div>
            <Button
              onClick={handleSaveProfile}
              disabled={saving || !fullName.trim()}
              className="w-full bg-forest text-cream hover:bg-sage transition-colors"
            >
              {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </div>

          <div className="h-px bg-sage/15" />

          {/* Password section */}
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-mid">
              Definir / Alterar Senha
            </p>
            <div className="space-y-2">
              <Label className="text-xs text-mid">Senha atual (deixe em branco se nunca definiu)</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Senha atual"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-mid">Nova senha</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-mid">Confirmar nova senha</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
              />
            </div>
            <Button
              onClick={handleSetPassword}
              disabled={savingPassword || !newPassword}
              variant="outline"
              className="w-full border-sage/20"
            >
              {savingPassword ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Atualizar Senha'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
